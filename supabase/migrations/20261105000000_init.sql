-- Cartograph schema. Every row belongs to an organization; authorization is
-- enforced here (RLS), never by app code remembering to filter.
--
-- Identity: a Clerk session token (Supabase third-party auth) carries the
-- organization as `o.id` (session token v2) or `org_id` (custom claim).
-- Agent credentials are minted by the app and additionally carry
-- `analysis_id` and `scope = 'agent:read'`: they can read exactly one analysis.
-- Writes happen only through the server-side pipeline using the secret key.

create extension if not exists pgcrypto;

-- ---------- identity helpers ----------

create or replace function public.requesting_org_id() returns text
language sql stable
set search_path = ''
as $$
  select nullif(coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id'), '')
$$;

-- null for normal sessions; the single analysis an agent credential names
create or replace function public.requesting_analysis_scope() returns uuid
language plpgsql stable
set search_path = ''
as $$
declare v text := auth.jwt() ->> 'analysis_id';
begin
  if v is null then
    -- a token that claims the agent scope but names no analysis reads nothing
    if auth.jwt() ->> 'scope' = 'agent:read' then
      return '00000000-0000-0000-0000-000000000000'::uuid;
    end if;
    return null;
  end if;
  return v::uuid;
exception when invalid_text_representation then
  return '00000000-0000-0000-0000-000000000000'::uuid;
end
$$;

create or replace function public.can_read_analysis(p_org text, p_analysis uuid) returns boolean
language sql stable
set search_path = ''
as $$
  select p_org = public.requesting_org_id()
     and (public.requesting_analysis_scope() is null or p_analysis = public.requesting_analysis_scope())
$$;

-- ---------- tables ----------

create table public.organizations (
  id text primary key,                      -- Clerk organization id
  name text not null,
  created_at timestamptz not null default now()
);

create table public.repositories (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations(id) on delete cascade,
  host text not null default 'github.com' check (host = 'github.com'),
  owner text not null check (owner ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$'),
  name text not null check (name ~ '^[A-Za-z0-9._-]{1,100}$'),
  created_at timestamptz not null default now(),
  unique (org_id, host, owner, name)
);

create type public.analysis_status as enum ('queued', 'running', 'succeeded', 'failed');
create type public.pipeline_step as enum ('fetch', 'select', 'parse', 'store');

-- one analysis per repository (per organization)
create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations(id) on delete cascade,
  repository_id uuid not null unique references public.repositories(id) on delete cascade,
  status public.analysis_status not null default 'queued',
  current_run_id uuid,
  commit_sha text,
  ref text,
  parser_version int,
  framework text,
  stats jsonb,
  created_by text,                          -- Clerk user id
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations(id) on delete cascade,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  status public.analysis_status not null default 'running',
  step public.pipeline_step not null default 'fetch',
  progress jsonb not null default '{}'::jsonb,
  error text,
  created_by text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.analyses
  add constraint analyses_current_run_fk foreign key (current_run_id) references public.analysis_runs(id) on delete set null;

-- the parsed map (files, edges, unresolved imports, framework), stored once per analysis
create table public.analysis_maps (
  analysis_id uuid primary key references public.analyses(id) on delete cascade,
  org_id text not null references public.organizations(id) on delete cascade,
  parser_version int not null,
  map jsonb not null,
  bytes int not null,
  created_at timestamptz not null default now()
);

-- cached explanations, keyed by exactly what the model was shown
create table public.explanations (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations(id) on delete cascade,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  target_kind text not null check (target_kind in ('file', 'module')),
  target text not null,
  input_hash text not null,
  prompt_version text not null,
  model text not null,
  content text not null,
  shown_paths text[] not null default '{}',
  invented_paths text[] not null default '{}',
  trace_id text,
  created_at timestamptz not null default now(),
  unique (analysis_id, target_kind, target, input_hash, prompt_version)
);

-- roles suggested by the model for files no framework rule classified (labelled as AI-suggested)
create table public.file_roles (
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  org_id text not null references public.organizations(id) on delete cascade,
  path text not null,
  role text not null,
  input_hash text not null,
  model text not null,
  created_at timestamptz not null default now(),
  primary key (analysis_id, path)
);

-- metering for rate limits and cost visibility
create table public.usage_events (
  id bigint generated always as identity primary key,
  org_id text not null references public.organizations(id) on delete cascade,
  user_id text,
  kind text not null check (kind in ('analyze', 'explain', 'ask')),
  analysis_id uuid references public.analyses(id) on delete set null,
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now()
);

create index on public.repositories (org_id);
create index on public.analyses (org_id, updated_at desc);
create index on public.analysis_runs (analysis_id, started_at desc);
create index on public.analysis_runs (org_id);
create index on public.analysis_maps (org_id);
create index on public.explanations (analysis_id, target_kind, target);
create index on public.explanations (org_id);
create index on public.file_roles (org_id);
create index on public.usage_events (org_id, kind, created_at desc);
create index on public.usage_events (user_id, kind, created_at desc);

-- ---------- row-level security ----------

alter table public.organizations enable row level security;
alter table public.repositories enable row level security;
alter table public.analyses enable row level security;
alter table public.analysis_runs enable row level security;
alter table public.analysis_maps enable row level security;
alter table public.explanations enable row level security;
alter table public.file_roles enable row level security;
alter table public.usage_events enable row level security;

-- Browsers and agents only ever read. Least privilege at the grant level too.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.organizations, public.repositories, public.analyses, public.analysis_runs,
  public.analysis_maps, public.explanations, public.file_roles to authenticated;

create policy "members read their organization" on public.organizations
  for select to authenticated using (id = (select public.requesting_org_id()));

create policy "members read their repositories" on public.repositories
  for select to authenticated using (
    org_id = (select public.requesting_org_id())
    and ((select public.requesting_analysis_scope()) is null
         or id = (select a.repository_id from public.analyses a where a.id = (select public.requesting_analysis_scope())))
  );

create policy "members read their analyses" on public.analyses
  for select to authenticated using (public.can_read_analysis(org_id, id));

create policy "members read their runs" on public.analysis_runs
  for select to authenticated using (public.can_read_analysis(org_id, analysis_id));

create policy "members read their maps" on public.analysis_maps
  for select to authenticated using (public.can_read_analysis(org_id, analysis_id));

create policy "members read their explanations" on public.explanations
  for select to authenticated using (public.can_read_analysis(org_id, analysis_id));

create policy "members read their file roles" on public.file_roles
  for select to authenticated using (public.can_read_analysis(org_id, analysis_id));
-- usage_events: no policies, no grants: server only.

-- keep updated_at honest
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger analyses_touch before update on public.analyses
  for each row execute function public.touch_updated_at();

-- progress page subscribes to run updates (Realtime honours RLS)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.analysis_runs, public.analyses;
  end if;
end $$;
