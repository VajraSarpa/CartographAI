# Spec: Rust language plug-in (`cartograph-lang-rust`)

Status: approved by the owner (2026-11-07), not started.
Read `CLAUDE.md` first. Its "Never" rules are the acceptance criteria.

## Goal

Rust repositories get the same map as TypeScript and Python: every line is a
real import resolved to a real file, and every other import is listed with
its reason. Rust suits this well. The module system is defined by files, and
the compiler decides which file each module lives in, so resolution rarely
has to guess.

## Decisions already made (don't re-open)

| Decision | Choice |
|---|---|
| Package | `packages/lang-rust`, id `rust`, name "Rust", built in like Python |
| Parser | tree-sitter WASM (`web-tree-sitter` 0.25.10, already a dependency) plus the Rust grammar |
| `mod foo;` declarations | Build the module tree only. **They are not drawn as lines.** Folder boxes already show the hierarchy. |
| Lines come from | `use` declarations, inline paths (`crate::db::connect()`), `pub use` re-exports, and `include!("literal.rs")` |
| Re-exports | Same as TS barrels: `use crate::prelude::Foo` → `prelude.rs`, and `prelude.rs` has its own re-export line to the real file. No chain-following past the named module. |
| `#[cfg(...)]` modules | Keep the line. Tagging it with the condition is phase 2 (it needs a contract change, below). |
| Macro- and build-generated code | `skipped` with a reason, never guessed |
| Routes | Axum, Actix Web, Rocket, only when the method and full path are both literal in code |
| Go | Not next: Go imports name a folder (a package), not a file |

## Contract fit (`packages/lang-api/index.d.ts`)

No breaking change is needed for phase 1.

- `claims`: `.rs`.
- `needsFile`: `Cargo.toml` (every one in the tree). `Cargo.lock` is not needed.
- `init`: load `web-tree-sitter` plus the Rust grammar, the same way as
  `packages/lang-python/src/index.ts`. That means `createRequire` from the
  file and from the cwd, and `turbopackIgnore`.
- `open(repo)`: read every `Cargo.toml` and **build the whole module tree up
  front**. Crate roots and their `mod` declarations are read via
  `repo.readText` and parsed with tree-sitter here, because `resolve()` needs
  every file's module path, not just the file being parsed.
- `parse`: returns `RawImport[]`, mapped as follows:

  | Source | `kind` | `typeOnly` | `literal` |
  |---|---|---|---|
  | `use a::b::C;` (each leaf of a use tree `use a::{b, c::{d, e}}` is one import) | `import` | false | true |
  | `pub use ...` / `pub(crate) use ...` | `reexport` | false | true |
  | Inline path `crate::x::y()` / `super::x::T` / `self::x::f` / `<local mod>::f` / `<dep crate>::f` | `import` | false | true |
  | `include!("x.rs")` with a literal path (`include_str!`/`include_bytes!` are data, not code: not emitted) | `import` | false | true |
  | `include!(concat!(env!("OUT_DIR"), ...))` or any non-literal argument | `import` | false | **false** (skipped) |
  | `extern crate foo;` (2015 edition) | `import` | false | true |

  Specifier: the path as written, with use trees expanded
  (`use a::{b, c}` → `a::b`, `a::c`). Groups and `as` renames are flattened.
  `*` globs keep the `::*`.

  Inline paths: emit **only** paths whose first segment is `crate`, `self`,
  `super`, a module declared in scope, or a crate from the dependencies.
  `Vec::new()`, `Self::x` and `MyType::new()` are type paths, not imports;
  don't emit them. Deduplicate per file by specifier, keeping the first line.

- `resolve`: see below. `finish`: roles and framework.

**Phase 2 contract change (ask the owner first):** add an optional
`condition?: string` to `RawImport`, carried through `ImportRecord` and
`Edge` (`conditions?: string[]`), and shown on the line's tooltip. Optional
fields mean no `apiVersion` bump. It does need a `PARSER_VERSION` bump and a
UI change.

## Cargo: crates and roots

Read with `smol-toml` (already a dependency).

- **Workspace:** `[workspace] members` (globs) and `exclude`. A root
  `Cargo.toml` with `[package]` is a crate too.
- **Per crate:**
  - **Name:** `[package] name`, with hyphens turned into underscores for
    paths. `[lib] name` overrides it.
  - **Edition:** `edition`, default 2015. Inherit `edition.workspace = true`.
  - **Library root:** `[lib] path`, default `src/lib.rs` if it exists.
  - **Binaries:**
    - `[[bin]] path`
    - `src/main.rs`
    - `src/bin/*.rs`
    - `src/bin/*/main.rs`
    - turned off by `autobins = false`
  - **Integration tests, benches and examples:** `tests/*.rs`,
    `tests/*/main.rs`, `benches/`, `examples/`, plus explicit
    `[[test]]`/`[[bench]]`/`[[example]]` (with `autotests` and so on).
  - **Build script:** `build.rs`, or the `build` key.
  - **Dependencies:** `[dependencies]`, `[dev-dependencies]` and
    `[build-dependencies]`, including target-specific tables, `package =`
    renames and `workspace = true`, which resolves via
    `[workspace.dependencies]`.
- A dependency with `path = "..."` that points at a crate in this repo links
  to that crate's **library root**. Every other dependency is `external` (pkg =
  crate name).
- Each root file starts its own module tree. Tests, benches, examples and
  binaries are separate crates that can `use <this_crate>::...`.

## The module tree

From each crate root, follow `mod name;` declarations:

- **Root or `mod.rs` file:** `mod foo;` → `<dir>/foo.rs` or `<dir>/foo/mod.rs`.
- **Non-`mod.rs` file `a.rs`:** `mod foo;` → `a/foo.rs` or `a/foo/mod.rs`
  (2018+ layout; the 2015 rules are the same for `mod.rs` files).
- **`#[path = "x.rs"] mod foo;`:** relative to the declaring file's
  directory. Inside an inline module, the inline module's path counts.
- **Both candidates exist:** `failed`, "ambiguous: both foo.rs and foo/mod.rs
  exist" (rustc refuses this too).
- **Neither exists:** record a `failed` import on the declaring file,
  "mod foo: no foo.rs or foo/mod.rs (tried: ...)". This is the one case where a
  `mod` declaration appears in the output, as an unresolved import, never as
  a line.
- **Inline `mod foo { ... }`:** a module living inside its parent file.
  Children declared inside it with `mod bar;` look in `<parent dir>/foo/bar.rs`.
- **`#[cfg(...)] mod foo;`:** include it in the tree (the file is real).
- **A module inside a macro invocation** (`cfg_if! { mod x; }`, etc.):
  tree-sitter sees a token tree, not a `mod` item. If the file `x.rs` exists
  but is in no tree, list it as skipped: "not reached from any crate root (may
  be declared inside a macro)". Never attach it by guessing.
- A `.rs` file that no crate root reaches gets the same skipped reason, so
  orphan files are listed, not dropped.

The result is two maps: module path → file, and file → the list of module
paths it hosts (a file hosts its own module and any inline modules).

## Resolving a path

Inputs are the importing file, its module path (from the tree) and the
specifier.

1. **First segment:**
   - `crate` → this crate's root module.
   - `self` / `super` → the current or parent module. Each `super` steps up
     once; going above the root is `failed`.
   - `std`, `core`, `alloc`, `proc_macro`, `test` → `external`, pkg is that
     name.
   - A dependency name (after renames, hyphens as underscores) → a workspace
     path dependency resolves into that crate's tree; anything else is
     `external`.
   - The name of a module declared in the current module (2018 "uniform
     paths"), or in the crate root for 2015 `use` paths → that module.
   - `::name` → crate names only (2018).
   - Otherwise, check whether it's a `use`-imported name in this file (for
     example `use crate::db; db::pool::get()`). If so, resolve through that
     use's target.
   - Otherwise `failed`: "`name` is not a module in scope, a dependency, or a
     standard crate".
2. **Walk** the remaining segments while each one is a child module, through
   files or inline modules.
3. At the first segment that is not a module, **check the item exists**: the
   current module must declare an item with that name. Items are fn, struct,
   enum, union, trait, type, const, static, macro_rules (with
   `#[macro_export]` the macro sits at the crate root), a `use`/`pub use`
   binding of that name, or an `extern crate`.
   - Found → `resolved` to the module's file.
   - Not found but the module has `pub use x::*` globs → follow each glob
     once, only within the same repo. Found → resolved to **the module named
     in the path** (barrel semantics, not the glob target).
   - Still not found → `failed`: "no item `C` in `crate::a::b` (src/a/b.rs)".
4. **Path ends exactly on a module** (`use crate::a::b;`, `use crate::a::b::*`,
   `use crate::a::b::{self}`) → `resolved` to that module's file.
5. **Same file:** a path that lands in the importing file itself (e.g.
   `use super::*` inside `mod tests {}`) is not an import between files.
   Return `skipped`, "refers to the same file", so it is counted, never
   drawn. Imports to other files from inside inline modules count normally.

Collect item names per file during `parse` and the tree build (top-level and
per inline module). Lean on tree-sitter node types, not regexes.

## Roles and entry points (`finish`)

| Role id | Label | Entry |
|---|---|---|
| `crate-lib` | Library roots | yes |
| `crate-bin` | Binaries | yes |
| `test` | Integration tests (`tests/`) | yes |
| `bench` | Benchmarks | yes |
| `example` | Examples | yes |
| `build-script` | Build scripts | yes |

Files reached only through `mod` (the normal case) have no role. Unit test
modules (`#[cfg(test)] mod tests`) are inline, so they have no file of their
own and no role.

## Frameworks (`frameworks.ts` in the package)

Detect each framework by a dependency in the crate's `Cargo.toml`. Monorepos
use `others`, as in Python. Use the same route rule throughout: **method and
full path both literal**, and every prefix a plain string literal. If anything
is computed, that route is left out. Never invent a route.

- **Axum** (`axum`):
  - `.route("/p", get(h).post(h2))` gives one route per method.
  - `routing::any`/`on` gives no route (no single method).
  - `.nest("/api", <router>)` adds a prefix when `<router>` is either built in
    place or is a call to a function whose body (in a resolved file) returns a
    `Router` built from `Router::new()...`.
  - `.merge(<router>)` keeps the path as is.
  - `nest_service`, a `.route` with a non-literal path, or an untraceable
    router → those routes are left out.
- **Actix Web** (`actix-web`):
  - Attribute routes `#[get("/x")]`, and so on.
  - Builder routes `.route("/x", web::get().to(h))` and
    `web::resource("/x").route(web::post().to(h))`.
  - `web::scope("/api")` adds a prefix.
  - An attribute route counts only when its registration
    (`.service(handler)`) is traced to an `App::new()` chain, including inside
    `configure(fn)` functions in resolved files.
- **Rocket** (`rocket`):
  - `#[get("/x")]` and its siblings.
  - The full path needs `.mount("/base", routes![a, b])`. Match handlers by
    name, through `use` resolution when they live in other files.
  - `#[route(GET, uri = "...")]` works the same way.
- **Roles:**
  - Axum: `axum-router` (files that build routers), `handler` (files with
    route targets).
  - Actix and Rocket: the same, plus Rocket `launch` (`#[launch]`).

Ship the plug-in with **no frameworks first**, then the frameworks in a second
PR.

## Wiring outside the package

- Root `package.json`: add the Rust grammar package as a dependency (as with
  Python, so the server can resolve its WASM).
  - **Check first** that the npm `tree-sitter-rust` version you pin ships a
    prebuilt `.wasm` compatible with `web-tree-sitter` 0.25.10 (ABI).
  - If it doesn't, build the WASM in CI with `tree-sitter build --wasm` and
    commit it. Ask the owner before doing that.
- `next.config.ts`: add it to `serverExternalPackages` and its `.wasm` to
  `outputFileTracingIncludes`.
- `src/parser/languages/index.ts`: register `rust`. Add `"rust"` to
  `DEFAULT_LANGUAGES` (on by default, like Python).
- `PARSER_VERSION` 6 → 7 (repos with `.rs` files map differently).
- **Copy that says "TypeScript, JavaScript or Python":** `README.md`,
  `CLAUDE.md`, `docs/USING.md` (then re-render `docs/using.html` the same way
  it was made), `src/app/page.tsx`, `src/app/layout.tsx`, the install skill,
  the Explain and Ask prompts (check `cartograph-agent/` and `src/server`).
  Also grep for "Python" for any other place that lists languages.
- `CHANGELOG.md`: an `[Unreleased]` entry. Release as 0.2.0, and bump the
  plugin version with it.

## Tests

- **Fixtures** in `test/fixtures/rust/` and `test/rust.test.ts`, in the style
  of `test/python.test.ts` (exact edge lists, plus `rec()` for reasons):
  - `basic`: lib and bin, `mod` in `foo.rs`, `foo/mod.rs` and 2018 layouts,
    `#[path]`, inline modules, `self`/`super`/`crate`, use trees, globs,
    renames.
  - `workspace`: two members, a path dependency, a `package =` rename,
    `workspace = true`, and a crates.io dependency (external).
  - `reexport`: a prelude barrel and `pub use` chains (edges stop at the
    barrel).
  - `failed`: a missing `mod`, ambiguous `foo.rs` + `foo/mod.rs`, a missing
    item, too many `super`s, an unknown first segment.
  - `skipped`: `include!(concat!(env!("OUT_DIR")...))`, a file reached by no
    root, and a module inside a macro.
  - `cfg`: `#[cfg(test)] mod tests;` and a platform-specific module (both kept
    as edges).
  - `edition2015`: `extern crate`, crate-relative `use`.
  - Frameworks (second PR): `axum` (nest, merge, a computed path left out),
    `actix` (scope, configure), `rocket` (mount).
- **Real repos** via `pnpm parse <dir> --json`. Record the counts in the PR
  and spot-check 10 edges by hand in each:
  - `BurntSushi/ripgrep` (workspace)
  - `tokio-rs/axum` (routes, nest; its `examples/` are many small crates)
  - `sharkdp/bat` (a normal binary crate)
  - `tokio-rs/tokio` (heavy `cfg` and macros, which stress the skipped path)
- **Regression:** Excalidraw, Express and the Python fixtures must be
  byte-identical apart from `parserVersion`.

## Acceptance

- `pnpm test`, `pnpm lint` and `pnpm typecheck` pass, and CI is green.
- No edge exists without a `mod`-tree path and an item check behind it. Every
  non-edge carries a reason a person can read.
- **On ripgrep and bat:** zero `failed` imports that rustc would accept. Any
  that remain are bugs to fix, not reasons to show.
- **Vercel preview:** analyzing a Rust repo works on the server (WASM found).
  The owner checks this in the browser.

## Out of scope

- Procedural macros, `macro_rules!` expansion, `build.rs` output: skipped
  with a reason.
- Trait-method resolution, type inference, "which `impl` is called". These are
  not imports.
- Cargo features (`#[cfg(feature = "x")]`): kept as edges, tagged in phase 2.
- Private repos and other languages.
