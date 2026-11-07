# Cartograph

Paste a public TypeScript, JavaScript or Python GitHub repository and get a map: folders
are boxes, imports are lines. Select a file to see what imports it and what
breaks two steps out. Ask for an explanation, or ask the repo a question.

Every connection on the map comes from parsing real code: the TypeScript
compiler for TS/JS, tree-sitter plus Python's import rules for Python. The AI only explains what the parser proved, and every explanation
is checked for paths it was not shown.

## Stack

Next.js 16 (App Router, Cache Components) · Clerk (teams) · Supabase (Postgres,
RLS, Realtime) · TypeScript compiler API parser · React Flow + ELK · Claude
(Anthropic API) · LangSmith (tracing, evals) · LangChain/LangGraph JS agent in
`cartograph-agent/`, run inside the app (or as a separate LangGraph server) · Vercel.

## Develop

```bash
pnpm install
pnpm env:setup        # prompts for keys (hidden input), writes .env.local
pnpm env:doctor       # what's missing, never prints values
pnpm env:check        # verifies each key with its service
pnpm dev              # http://localhost:3000 (Ask runs in-process)
pnpm dev:agent        # optional: agent as a LangGraph server on :2024
                      # (set AGENT_URL=http://localhost:2024 to use it, e.g. with LangGraph Studio)
```

| Command | What it does |
|---|---|
| `pnpm parse [dir] [--json out]` | Parse a directory; files found = parsed + skipped |
| `pnpm analyze <url> --org <org_id>` | Fetch, parse and store from the terminal |
| `pnpm eval paths \| paths splice \| roles \| prompts` | AI evals |
| `pnpm agent key` / `pnpm agent check` | Agent signing key; prove forged credentials read nothing |
| `pnpm test` / `pnpm test:rls` | Unit tests / RLS isolation tests (Docker or Podman) |

## Languages

Each language is a plug-in. TypeScript/JavaScript and Python are built in. The graph,
map, Explain and Ask don't know which language a file is in.

If you use the hosted app, there is nothing to install. This section is for
people hosting Cartograph themselves.

Turn languages on with one variable. Order matters: when two languages claim
the same file, the first one in the list gets it.

```bash
CARTOGRAPH_LANGUAGES=typescript,python     # the default
CARTOGRAPH_LANGUAGES=typescript            # TS/JS only
CARTOGRAPH_LANGUAGES=typescript,python,ruby  # plus a third-party language
```

Any id that isn't built in is loaded from the npm package
`cartograph-lang-<id>`. To add one, run `pnpm add cartograph-lang-ruby` and
add `ruby` to the list. If a listed package is missing or isn't a valid
plug-in, analysis fails and the error names the package. `pnpm env:doctor`
shows which languages load.

### How Python imports are resolved

`packages/lang-python` reads imports with tree-sitter. It resolves them only
through the folders the repo itself puts on the import path:

- **Package roots** come from `pyproject.toml` or `setup.cfg`. That means
  setuptools `package-dir` / `packages.find`, hatch `packages`, poetry
  `packages`, pdm `package-dir`, or uv_build `module-root`. If none of those
  is set, the build backend's own discovery rule applies: `src/` if it
  exists, otherwise the project folder.
- **Several projects in one repo** can import each other only when one lists
  the other as a dependency, or both are in the same uv workspace.
- **Test files** use pytest's rules: the first folder above a test file
  without an `__init__.py` is on the path, plus `pythonpath`. This is off
  under `--import-mode=importlib`.
- **Relative imports** follow the folder structure.

Everything else gets a reason and no line on the map:
- standard-library and third-party imports are external
- namespace packages have no file to link to
- `.pyi` stubs describe types and don't run
- `importlib` calls and `sys.path` changes only take effect at runtime
- a module that would only be found if its folder were on `sys.path` (a
  script run directly, say) is listed as failed, naming the folder

### Writing a language plug-in

The contract is in [`packages/lang-api/index.d.ts`](packages/lang-api/index.d.ts)
(types only). [`packages/lang-template`](packages/lang-template) is a complete
working plug-in to copy. Its parts:

| Part | What it does |
|---|---|
| `claims(path)` | Says whether the language owns this file |
| `needsFile(path)` | Optional: config files it reads (e.g. `pyproject.toml`), so the fetcher keeps them |
| `parse(path, text)` | Returns the imports in the file, with line numbers |
| `resolve(from, specifier)` | Returns `resolved` plus a real file, or `external` / `skipped` / `failed` plus a reason |
| `finish(parsed)` | Optional: framework, roles per file, and which roles are entry points |

The core handles everything else the same way for every language: it walks
the repo without following symlinks, skips large, binary and minified files
(with a reason), builds edges, and counts fan-in and fan-out. It also checks
the plug-in: a `resolved` import that points at a file not in the repo turns
into `failed`. Plug-ins read the repo only through `RepoView`, which can't
see anything outside the repo.

The core loads packages with Node's own `import()`, so publish JavaScript
(the template builds with `tsc`), not raw TypeScript.

See [docs/DEPLOY.md](docs/DEPLOY.md) for deployment and [docs/SECURITY.md](docs/SECURITY.md)
for the security model.
