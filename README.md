# Cartograph

Paste a public TypeScript/JavaScript GitHub repository and get a map: folders
are boxes, imports are lines. Select a file to see what imports it and what
breaks two steps out. Ask for an explanation, or ask the repo a question.

Every connection on the map comes from parsing real code with the TypeScript
compiler. The AI only explains what the parser proved, and every explanation
is checked for paths it was not shown.

## Stack

Next.js 16 (App Router, Cache Components) · Clerk (teams) · Supabase (Postgres,
RLS, Realtime) · TypeScript compiler API parser · React Flow + ELK · Claude
(Anthropic API) · LangSmith (tracing, evals, agent hosting) · LangGraph JS agent
in `cartograph-agent/` · Vercel.

## Develop

```bash
pnpm install
pnpm env:setup        # prompts for keys (hidden input), writes .env.local
pnpm env:doctor       # what's missing, never prints values
pnpm env:check        # verifies each key with its service
pnpm dev              # http://localhost:3000
cd cartograph-agent && pnpm install && pnpm dev   # agent on :2024
```

| Command | What it does |
|---|---|
| `pnpm parse [dir] [--json out]` | Parse a directory; files found = parsed + skipped |
| `pnpm analyze <url> --org <org_id>` | Fetch, parse and store from the terminal |
| `pnpm eval paths \| paths splice \| roles \| prompts` | AI evals |
| `pnpm agent key` / `pnpm agent check` | Agent signing key; prove forged credentials read nothing |
| `pnpm test` / `pnpm test:rls` | Unit tests / RLS isolation tests (Docker or Podman) |

See [docs/DEPLOY.md](docs/DEPLOY.md) for deployment and [docs/SECURITY.md](docs/SECURITY.md)
for the security model.
