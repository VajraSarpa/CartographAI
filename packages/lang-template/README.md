# cartograph-lang-template

A complete, working Cartograph language plug-in for a toy language. Copy
this folder to start a new one.

1. Copy the folder and rename the package `cartograph-lang-<id>`. Set `id` in
   `src/index.ts` to the same `<id>`. Use lowercase letters, digits and
   dashes.
2. Replace the three marked parts in `src/index.ts`: which files the language
   claims, how imports are read out of a file, and how an import resolves to
   a file.
3. `pnpm build` (writes `dist/`), then in your Cartograph checkout run
   `pnpm add cartograph-lang-<id>` and add `<id>` to `CARTOGRAPH_LANGUAGES`.
4. `pnpm parse <some repo>` prints what your plug-in found, including every
   import it could not resolve and the reason.

The contract is `cartograph-lang-api` (`packages/lang-api/index.d.ts`). The
rule that matters: return `resolved` only when a real import names a real
file in `repo.files`. Never guess from file names or conventions. Anything
else gets `external`, `skipped` or `failed`, with a reason someone can read.

`test/languages.test.ts` in Cartograph runs this template against
`test/fixtures/lang-template/`.
