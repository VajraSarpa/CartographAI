# Cartograph

Sign in with GitHub, paste a public TypeScript/JavaScript repo URL, get a map:
folders are boxes, imports are lines. Select a file to see what imports it and
what breaks two levels out. Ask for an explanation. Ask the repo a question.

@AGENTS.md

## Never
- Never decide two files are connected. An edge exists only when the parser
  resolved a real import to a real file. Not from a file name, a convention,
  or a reasonable guess.
- Never show a route unless method and full path are both readable from code.
- Never silently drop something the parser could not resolve. Keep the reason.
- Never let the AI name a file or path it was not shown.
- Never add scores, grades or code-quality judgments. The graph can't know.
- Never commit a secret. The repo is public.

## Layout of the code (by behaviour, not folder names)
- Parsing code (`src/parser`, `src/graph`) takes data in and returns data. It
  cannot import Next.js, React or the database client (enforced by ESLint).
- Browser components must not pull in the parser or file-system code.
- Authorization lives in database policies (RLS), not in app code that must
  remember to filter.
- Identity is a token; the token carries the organization. Nothing downstream
  asks the identity provider at runtime.
- Missing environment variables fail loudly at startup (`src/lib/env.ts`).

## Stack
- Next.js 16 App Router (async request APIs, `proxy.ts` not `middleware.ts`),
  Clerk (orgs), Supabase (Postgres + RLS + realtime), TypeScript compiler-API parser,
  React Flow + ELK layout, Anthropic Claude for Explain and the agent,
  LangSmith for tracing/evals. The Ask agent (`cartograph-agent/`) runs
  in-process; AGENT_URL optionally points at a separate LangGraph server.
  Deployed on Vercel.

## Commands
- `pnpm dev` / `pnpm build` / `pnpm test` / `pnpm lint` / `pnpm typecheck`
- `pnpm parse [dir]` parse a directory and print counts
- `pnpm analyze <github-url>` fetch, parse, store
- `pnpm env:doctor` / `pnpm env:check` environment status

## How to talk to me
- Ask one specific question and say which way you'd go and why.
- Plain English, no walls of text.
- If you need a key, say exactly which and where, then stop.
