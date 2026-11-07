# Next: language plug-ins, then Python

Handoff for the next working session (written 2026-11-07). Read `CLAUDE.md`
first; its rules apply to everything below.

## Where things stand

- Deployed on Vercel and working end to end: sign-in, analyze, map, Explain,
  Ask, Re-analyze. The Ask agent runs inside the app (`cartograph-agent/` is a
  pnpm workspace package; `AGENT_URL` is optional). LangSmith is used for
  tracing and evals only.
- `main` is green: lint, typecheck, 44 tests, RLS tests, secret scan.
- The parser only understands TypeScript/JavaScript. Most of the owner's own
  repos are Python, so Python support is the next feature.

## Working in a cloud session

- Setup: Node 22, then `corepack enable && pnpm install`.
- No keys are available, and none are needed for this work. These run without
  any environment: `pnpm test`, `pnpm lint`, `pnpm typecheck`,
  `pnpm parse <dir> [--json out.json]`.
- Don't run `pnpm dev`, `pnpm analyze`, `pnpm eval` or `pnpm agent` (they need
  keys), and never ask for keys in chat.
- Branch per piece of work, open a PR, let CI run. The owner merges; never
  merge your own PR.
- How to talk to the owner: one specific question at a time, plain English,
  say which way you'd go and why.

## Step 1: a language plug-in interface (no behaviour change)

Requirement from the owner: the repo is public, so adding a language must be
easy for people self-hosting it.

- A `LanguagePlugin` interface: which files it claims, extract imports, and
  resolve each import to a real file or a reason. Graph, map, Explain and Ask
  stay language-neutral.
- Move the existing TS/JS parser (`src/parser/`) behind it first. This proves
  the interface: outputs must stay byte-identical on Excalidraw and Express
  (`pnpm parse <dir> --json` before and after, then diff).
- Enable languages with one env var, e.g.
  `CARTOGRAPH_LANGUAGES=typescript,python`, validated in `src/lib/env.ts`.
  Third-party languages are npm packages named `cartograph-lang-<name>`:
  `pnpm add` it and add the name to the list.
- Store the language per file in the map; bump `PARSER_VERSION`.
- README section plus a template package documenting the interface. Hosted
  users install nothing; this is for self-hosters.

## Step 2: Python (`packages/lang-python`, in this pnpm workspace, on by default)

- Parse with `tree-sitter-python` (the WASM build works on Vercel). Model the
  resolver on grimp / import-linter.
- Resolve relative imports, regular and namespace packages, and flat, `src/`
  and multi-package layouts (read `pyproject.toml`, `setup.cfg`).
- Third-party imports are external. `importlib` calls and `sys.path` changes
  are listed as unresolved with a reason, never guessed (see CLAUDE.md:
  never decide two files are connected without a resolved import).
- Graph, map, Explain and Ask need no change. Django/FastAPI/Flask roles come
  later; routes only when method and full path are both in the code.
- Test cases: ask the owner for 2-3 of their Python repos with different
  layouts before building the resolver. Add small fixtures under
  `test/fixtures/` for each layout.

## Known follow-ups (small, not urgent)

- Clerk runs as a development instance; a production instance needs a custom
  domain and its own GitHub OAuth app.
- Evals have never been run against Claude. Ask the owner first: they spend
  API credit.
