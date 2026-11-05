-- RLS isolation tests. Run against a database with the migrations applied.
-- Every check raises on failure.
\set ON_ERROR_STOP on
begin;

-- seed as owner (bypasses RLS like the server's secret key)
insert into public.organizations (id, name) values ('org_A', 'Team A'), ('org_B', 'Team B');
insert into public.repositories (id, org_id, owner, name) values
  ('11111111-1111-1111-1111-111111111111', 'org_A', 'acme', 'app'),
  ('22222222-2222-2222-2222-222222222222', 'org_B', 'beta', 'svc'),
  ('33333333-3333-3333-3333-333333333333', 'org_A', 'acme', 'other');
insert into public.analyses (id, org_id, repository_id, status) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'org_A', '11111111-1111-1111-1111-111111111111', 'succeeded'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'org_B', '22222222-2222-2222-2222-222222222222', 'succeeded'),
  ('cccccccc-0000-0000-0000-00000000000c', 'org_A', '33333333-3333-3333-3333-333333333333', 'succeeded');
insert into public.analysis_maps (analysis_id, org_id, parser_version, map, bytes) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'org_A', 3, '{"files":[]}', 12),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'org_B', 3, '{"files":[]}', 12),
  ('cccccccc-0000-0000-0000-00000000000c', 'org_A', 3, '{"files":[]}', 12);
insert into public.usage_events (org_id, kind) values ('org_A', 'explain');

create function pg_temp.expect(label text, got bigint, want bigint) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL %: got %, want %', label, got, want; end if;
  raise notice 'ok  %', label;
end $$;

-- helper: act as a role with given claims
create function pg_temp.as_user(claims jsonb) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', claims::text, true);
end $$;

set local role authenticated;

-- Clerk v2 session token for Team A
select pg_temp.as_user('{"sub":"user_1","role":"authenticated","o":{"id":"org_A"}}');
select pg_temp.expect('A sees own analyses', (select count(*) from public.analyses), 2);
select pg_temp.expect('A sees own maps', (select count(*) from public.analysis_maps), 2);
select pg_temp.expect('A sees none of B', (select count(*) from public.analyses where org_id = 'org_B'), 0);
select pg_temp.expect('A sees one org', (select count(*) from public.organizations), 1);
do $$ begin
  begin
    perform count(*) from public.usage_events;
    raise exception 'FAIL usage readable';
  exception when insufficient_privilege then raise notice 'ok  usage_events not readable';
  end;
end $$;

-- custom org_id claim for Team B
select pg_temp.as_user('{"sub":"user_2","role":"authenticated","org_id":"org_B"}');
select pg_temp.expect('B sees own analysis only', (select count(*) from public.analyses), 1);
select pg_temp.expect('B sees own repo only', (select count(*) from public.repositories), 1);

-- signed in, no organization
select pg_temp.as_user('{"sub":"user_3","role":"authenticated"}');
select pg_temp.expect('no org sees nothing', (select count(*) from public.analyses), 0);

-- agent credential scoped to one analysis
select pg_temp.as_user('{"sub":"agent","role":"authenticated","org_id":"org_A","analysis_id":"aaaaaaaa-0000-0000-0000-00000000000a","scope":"agent:read"}');
select pg_temp.expect('agent sees its analysis', (select count(*) from public.analyses), 1);
select pg_temp.expect('agent sees its map', (select count(*) from public.analysis_maps), 1);
select pg_temp.expect('agent sees only its repo', (select count(*) from public.repositories), 1);

-- agent credential for another org's analysis id (forged pairing)
select pg_temp.as_user('{"sub":"agent","role":"authenticated","org_id":"org_A","analysis_id":"bbbbbbbb-0000-0000-0000-00000000000b","scope":"agent:read"}');
select pg_temp.expect('cross-org agent reads nothing', (select count(*) from public.analysis_maps), 0);

-- made-up analysis id, garbage id, missing id
select pg_temp.as_user('{"role":"authenticated","org_id":"org_A","analysis_id":"99999999-0000-0000-0000-000000000000","scope":"agent:read"}');
select pg_temp.expect('made-up analysis reads nothing', (select count(*) from public.analyses), 0);
select pg_temp.as_user('{"role":"authenticated","org_id":"org_A","analysis_id":"not-a-uuid","scope":"agent:read"}');
select pg_temp.expect('garbage analysis id reads nothing', (select count(*) from public.analyses), 0);
select pg_temp.as_user('{"role":"authenticated","org_id":"org_A","scope":"agent:read"}');
select pg_temp.expect('agent scope without id reads nothing', (select count(*) from public.analyses), 0);

-- writes are denied to signed-in users
select pg_temp.as_user('{"sub":"user_1","role":"authenticated","o":{"id":"org_A"}}');
do $$ begin
  begin
    insert into public.organizations (id, name) values ('org_X', 'x');
    raise exception 'FAIL insert allowed';
  exception when insufficient_privilege then raise notice 'ok  insert denied';
  end;
  begin
    update public.analyses set status = 'failed';
    raise exception 'FAIL update allowed';
  exception when insufficient_privilege then raise notice 'ok  update denied';
  end;
  begin
    delete from public.analysis_maps;
    raise exception 'FAIL delete allowed';
  exception when insufficient_privilege then raise notice 'ok  delete denied';
  end;
end $$;

-- anonymous reads nothing (no grants at all)
reset role;
set local role anon;
do $$ begin
  begin
    perform count(*) from public.analyses;
    raise exception 'FAIL anon can select';
  exception when insufficient_privilege then raise notice 'ok  anon denied';
  end;
end $$;

reset role;
-- every table in public has RLS enabled
select pg_temp.expect('all tables have RLS',
  (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity), 0);

rollback;
