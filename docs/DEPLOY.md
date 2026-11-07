# Deploying Cartograph

One service: the Next.js app on **Vercel**. The Ask agent runs inside it.
Supabase, Clerk and LangSmith (tracing) are managed. Hosting the agent
separately on LangSmith Deployments is optional (step 4).

## 1. Supabase
1. Create a project (save the DB password; pick the region nearest your users).
2. SQL editor: run `supabase/migrations/*.sql` in order (or `supabase db push`).
3. Authentication → Third-party Auth → add **Clerk** with your Clerk domain.
4. After `pnpm agent key`: Project Settings → JWT Keys → **Create standby key**
   → Import existing private key (ES256) → paste `.agent-signing-key.jwk.json`,
   save, then delete that file.

## 2. Clerk
1. Application with **GitHub** sign-in; enable **Organizations**, membership **optional**.
2. Integrations → **Supabase** → activate.
3. Sessions → customize session token: `{ "org_name": "{{org.name}}" }`.
4. Paths: sign-in `/sign-in`, sign-up `/sign-up`.
5. For production, create a production instance on your domain and use its keys.

## 3. Vercel (app)
1. Import `VajraSarpa/cartograph`; framework Next.js; Node 22.
2. Set env vars (Production + Preview) from `.env.local`:
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
   `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
   `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`,
   `LANGSMITH_TRACING=true`, `GITHUB_TOKEN` (recommended: shared Vercel IPs hit
   GitHub's 60/hour anonymous limit), `AGENT_SIGNING_KEY`, `AGENT_SIGNING_KID`,
   and `ENABLE_EXPERIMENTAL_COREPACK=1` (uses the pinned pnpm version).
   Leave out `APP_URL` and `AGENT_URL` (both point at localhost in `.env.local`).
   Tip: paste the whole `.env.local` into the first Key field, then delete
   those two rows.
3. Functions region: same region as Supabase. Fluid compute on (the pipeline
   runs in `after()` with `maxDuration = 300`).

## 4. Optional: host the agent separately (LangSmith Deployments, paid plan)
By default Ask runs in-process: no `AGENT_URL`, nothing else to deploy. To run
the same agent as its own service instead:
1. Deployments → New → connect the GitHub repo, config path
   `cartograph-agent/langgraph.json`.
2. Env: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `CARTOGRAPH_APP_URL=https://<your-domain>`.
3. Copy the deployment URL into Vercel's `AGENT_URL`; redeploy the app. The
   app then relays questions to it, and the agent calls back through
   `/api/agent/<tool>` with the same credential.

## 5. Verify
`pnpm env:check`, `pnpm agent check`, then: sign in → analyze a repo → map →
blast radius → Explain (twice: second is a cache hit with no model call in
LangSmith) → Ask "Where is authentication handled?" → Ask "Is this code any
good?" (must refuse).
