# Next: Rust language plug-in

Handoff for the next working session (updated 2026-11-07). Read `CLAUDE.md`
first; its rules apply to everything below.

## Where things stand

- Deployed on Vercel and working end to end: sign-in, analyze, map, Explain,
  Ask, Re-analyze. The Ask agent runs inside the app (`cartograph-agent/` is a
  pnpm workspace package; `AGENT_URL` is optional). LangSmith is used for
  tracing and evals only.
- Languages are plug-ins (`packages/lang-api` is the contract). TypeScript/
  JavaScript and Python are built in and on by default
  (`CARTOGRAPH_LANGUAGES=typescript,python`). `PARSER_VERSION` is 6.
- Python on Vercel was checked in production. rupa matched the local run
  exactly: 28 files, 150 resolved, 51 connections.
- `main` is green: lint, typecheck, 78 tests, RLS tests, secret scan, audit.

## Working in a cloud session

- Setup: Node 22, then `corepack enable && pnpm install`.
- No keys are available, and none are needed for parser work. These run
  without any environment: `pnpm test`, `pnpm lint`, `pnpm typecheck`,
  `pnpm parse <dir> [--json out.json]`.
- Don't run `pnpm dev`, `pnpm analyze`, `pnpm eval` or `pnpm agent` (they need
  keys), and never ask for keys in chat.
- Branch per piece of work, open a PR, let CI run. The owner merges; never
  merge your own PR. Check each PR's Vercel preview for anything that runs
  only on the server.
- How to talk to the owner: one specific question at a time, plain English,
  say which way you'd go and why.
- Regression check for parser changes: `pnpm parse --json` on Excalidraw and
  Express before and after. TS/JS output should change only on purpose.

## Next steps

1. **Rust language plug-in** (cloud session). Full spec:
   [docs/specs/lang-rust.md](specs/lang-rust.md), approved by the owner;
   don't re-open its "Decisions already made" table. Work in three PRs:
   - **PR 1, the plug-in:** `packages/lang-rust`, built in and on by default.
     It covers the Cargo crates, the module tree, path resolution, roles,
     fixtures and tests, and bumps `PARSER_VERSION` to 7. Check before
     anything else that the Rust grammar's WASM loads in `web-tree-sitter`
     0.25.10.
   - **PR 2, frameworks:** Axum, Actix Web and Rocket routes, exact or absent.
   - **PR 3, docs and copy:** everywhere that lists the supported languages,
     plus a CHANGELOG entry.
   - Phase 2 (`#[cfg]` condition tags on lines) changes the contract. Ask
     the owner before starting it.
   - Test on ripgrep, axum, bat and tokio with `pnpm parse --json`, and put
     the counts in each PR.
2. **Verify Python frameworks in production** (owner, from a browser).
   Analyze `https://github.com/pallets/flask`. Expect "Flask" with routes
   like `GET /auth/login` and `POST /auth/register` (the tutorial app).
3. **Evals.** The Explain and Ask prompts changed ("code repository" instead
   of "TypeScript/JavaScript repository") and evals have never been run
   against Claude. Ask the owner first: they spend API credit.
4. **Production Clerk instance.** Clerk is a development instance; production
   needs a custom domain and its own GitHub OAuth app.

## Done (for context)

- **v0.1.0 released** (2026-11-07): `CHANGELOG.md`, tag `v0.1.0`, GitHub
  Release. CodeRabbit config in `.coderabbit.yaml`, which encodes the
  CLAUDE.md rules as review instructions.

- **Plug-in interface.** Contract in `packages/lang-api/index.d.ts`, TS/JS
  plug-in in `src/parser/languages/typescript/`, loader in
  `src/parser/languages/index.ts`, template in `packages/lang-template`. The
  refactor was byte-identical on Excalidraw, Express and the fixtures.
  Third-party plug-ins (`cartograph-lang-<id>`) load by name. That path has
  not been checked on Vercel; built-ins use static imports.
- **Python** (`packages/lang-python`). Imports are read with tree-sitter
  WASM, which is also a root dependency so the server can resolve it (see
  `next.config.ts`). The resolver uses only import paths the repo declares:
  - package roots from pyproject.toml / setup.cfg, or the build backend's
    own discovery rule
  - pytest's rules for test files
  - run commands (Procfile, Dockerfile, …), which was the owner's choice
  Tested on rupa, slack-kb (private: none of its code is in this repo),
  requests, flask and django.
- **Python frameworks** (`src/frameworks.ts`). Django gets roles but no
  routes, because `path()` names no method. FastAPI and Flask get roles and
  routes through include/register prefixes, shown only when every prefix is
  a plain string. Checked on djangoproject.com, Flask's tutorial and the
  FastAPI full-stack template.

## Done by the owner (2026-11-07)

- GitHub About text and topics set; Clerk application renamed to
  "CartographAI". Product name and tagline: **CartographAI**, "Every
  connection, proven." The repo was renamed to `VajraSarpa/CartographAI` (2026-11-07); old
  `VajraSarpa/cartograph` links redirect.
