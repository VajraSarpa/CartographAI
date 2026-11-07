# Changelog

All notable changes to CartographAI. Versions follow
[Semantic Versioning](https://semver.org/); while the version is 0.x, a minor
release may change behaviour.

Each release has a Git tag (`v0.1.0`) and a GitHub Release with these notes.
When the Claude Code installer plugin (`plugins/cartographai`) changes, its
`version` in `.claude-plugin/plugin.json` goes up with the release, so Claude
Code can tell there is an update.

## [0.1.0] - 2026-11-07

First release. **CartographAI: every connection, proven.**

### Map
- Paste a public GitHub repository (or a branch or tag URL) and get a map:
  folders are boxes, imports are lines. Every line is a real import resolved
  to a real file; every other import is listed with its reason (external,
  skipped or failed).
- Select a file to see what imports it (green) and what it imports (amber),
  its blast radius by distance, and its dependency chain.
- Insights: import cycles, heavy fan-in, large files, files nothing imports.
- Teams via Clerk organizations; data isolated by Supabase row-level security.

### Languages
- TypeScript and JavaScript, resolved with the TypeScript compiler and your
  tsconfig (aliases, workspaces, re-exports, dynamic imports) (#1, #2).
- Python, read with tree-sitter (WASM) and resolved only through import paths
  the repo declares: pyproject.toml / setup.cfg package settings, pytest's
  rules for test files, and run commands such as a Procfile or Dockerfile
  (#9, #10).
- Language plug-in interface (`cartograph-lang-api`), a template plug-in,
  and `CARTOGRAPH_LANGUAGES` for self-hosters (#8).

### Frameworks
- Roles for Next.js, Nest.js, Express, React and Docusaurus (#1).
- Roles for Django, FastAPI and Flask; FastAPI and Flask routes followed
  through `include_router` / `register_blueprint` prefixes (#10).
- A route is shown only when its method and full path are both in the code.

### AI
- Explain: a plain-English explanation of a file or folder from its real
  neighbours, cached; any path it was not shown is struck through (#3).
- Ask: an agent that answers questions about the repository using read-only
  tools on the map; it runs inside the app (#3, #6). Declines to grade code.

### Install and docs
- Claude Code plugin that installs a self-hosted copy:
  `/plugin marketplace add VajraSarpa/cartograph`,
  `/plugin install cartographai@cartographai`, `/cartographai:install`.
  Keys are typed into your own terminal; Claude never sees them (#14).
- Landing page, user guide, setup and deploy guides; animated README diagram
  (#4, #11, #12, #16).
- Renamed to CartographAI with the tagline "Every connection, proven." (#13).
- MIT license (#15).

### Security
- Repositories are never executed; downloads are capped and extracted without
  links; parsers read only inside the repository (#2).
- Strict per-request nonce Content Security Policy (#5).

[0.1.0]: https://github.com/VajraSarpa/cartograph/releases/tag/v0.1.0
