# Security model

**Tenancy.** Every row carries an organization id. Row-level security on all
eight tables decides what a member can read; app code never filters by org.
Members have SELECT only; all writes go through server code using the secret
key, with the organization taken from the verified Clerk session token.
`pnpm test:rls` (also in CI) proves isolation with 20 checks.

**Identity.** Clerk session tokens carry the active organization. Nothing
downstream calls Clerk at request time (except first-landing team creation).

**Agent credential.** The Ask agent gets a 10-minute ES256 JWT naming one
analysis and its organization with scope `agent:read`. The app verifies it,
then reads *as* that token so RLS checks it again; Supabase trusts the key as
a standby signing key. The credential never reaches the browser.
`pnpm agent check` proves cross-org, made-up, tampered and garbage credentials
read nothing.

**Untrusted repositories.** Archives are pinned to a commit, streamed through a
hand-checked extractor (regular files and directories only; no symlinks or
hard links; no path escapes; caps on archive size, entries and bytes written);
only code/JSON/HTML content is written. The parser never follows symlinks,
resolves modules through a host that cannot read outside the repository, and
never executes repository code. Repository source shown to the agent is
labelled untrusted; the agent's tools are read-only and scoped to one analysis.

**Web.** Strict per-request nonce CSP (`strict-dynamic`, `frame-ancestors
'none'`, `object-src 'none'`), HSTS preload, nosniff, DENY framing, strict
referrer and permissions policies, no `X-Powered-By`. Model output is rendered
as React nodes, never HTML.

**Abuse and cost.** Per-team daily quotas and per-user per-minute limits for
analyze / explain / ask (`LIMIT_*` env vars); explanation cache keyed by the
exact model input; agent tool-call cap per run; server-side refusal fallback.

**Secrets.** `.env*` is git-ignored (except `.env.example`); `env:setup` writes
files with mode 600; CI runs gitleaks on full history and `pnpm audit`.
