# cartograph-lang-python

Python for CartographAI, built in and on by default. Imports are read with
tree-sitter (WASM, so there is no native build) and resolved the way
Python's import system would, over the folders the repo declares. See
"How Python imports are resolved" in the main README.

- `src/extract.ts`: imports, `TYPE_CHECKING` blocks, runtime imports, `sys.path` changes
- `src/project.ts`: projects and package roots from pyproject.toml / setup.cfg, pytest settings
- `src/resolve.ts`: dotted names to files, or a reason
- Tests: `test/python.test.ts`, fixtures in `test/fixtures/python/`
