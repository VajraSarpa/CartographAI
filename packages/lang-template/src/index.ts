/**
 * A complete, working language plug-in for a toy language, to copy from.
 *
 * The toy language: files end in `.tmpl`, and a line `use "./other.tmpl"`
 * imports another file by relative path; `use "name"` (no ./ or ../) names an
 * outside package. Replace the three marked parts with your language's rules.
 *
 * The rule you must keep: return "resolved" only when a real import names a
 * real file in `repo.files`. Everything else gets a status and a reason.
 */
import path from "node:path";
import type { LanguagePlugin, LanguageSession, RawImport, RepoView, Resolution } from "cartograph-lang-api";

// (1) Which files this language owns.
const EXTENSION = ".tmpl";

// (2) How to read imports out of one file. Use a real parser for a real
// language (tree-sitter, the language's own compiler API); a regex is only
// good enough for this toy grammar.
const USE = /^\s*use\s+(?:"([^"]*)"|(\S+))/;

function extract(text: string): RawImport[] {
  const out: RawImport[] = [];
  text.split("\n").forEach((line, i) => {
    const m = USE.exec(line);
    if (!m) return;
    const literal = m[1] !== undefined;
    out.push({ specifier: literal ? m[1] : m[2], kind: "import", typeOnly: false, line: i + 1, literal });
  });
  return out;
}

// (3) How to turn one import into a file, or say why not.
function resolveIn(repo: RepoView, fromRel: string, specifier: string): Resolution {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return { status: "external", pkg: specifier };
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), specifier));
  if (target.startsWith("..")) return { status: "failed", reason: `points outside the repository (${target})` };
  if (!repo.files.has(target)) return { status: "failed", reason: `no file found at ${target}` };
  if (!target.endsWith(EXTENSION)) return { status: "skipped", to: target, reason: `not a ${EXTENSION} file` };
  return { status: "resolved", to: target };
}

const plugin: LanguagePlugin = {
  apiVersion: 1,
  id: "template", // must match the package name: cartograph-lang-template
  name: "Template language",
  claims: (rel) => rel.endsWith(EXTENSION),
  // Config files your resolver reads (e.g. "pyproject.toml"); the GitHub fetcher keeps these.
  needsFile: () => false,
  open(repo): LanguageSession {
    return {
      parse: (_rel, text) => extract(text),
      resolve: (fromRel, specifier) => resolveIn(repo, fromRel, specifier),
      // Optional: framework detection and roles. Omit `finish` if you have none.
      finish: (parsed) => ({
        framework: null,
        rolesByFile: new Map(parsed.filter((f) => path.posix.basename(f) === `main${EXTENSION}`).map((f) => [f, ["entry-file"]])),
        entryRoles: new Set(["entry-file"]),
      }),
    };
  },
};

export default plugin;
