import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { FinishResult, FrameworkInfo, LanguagePlugin, LanguageSession, RawImport, RepoView } from "cartograph-lang-api";
import { Language, Parser } from "web-tree-sitter";
import { extract, type FileFacts } from "./extract";
import { applyFrameworks } from "./frameworks";
import { findProjects, type Project } from "./project";
import { isTestFile, PythonResolver } from "./resolve";

const ROLES: Record<string, string> = {
  "package-entry": "Package entry points",
  "main-script": "Run as scripts",
  test: "Tests",
};
const ENTRY_ROLES = Object.keys(ROLES);

/** Non-code files the resolver reads. */
const CONFIG = /(^|\/)(pyproject\.toml|setup\.cfg|pytest\.ini|tox\.ini|requirements[^/]*\.txt)$/;

/** Both packages are also root dependencies so the app server can resolve them (see next.config.ts). */
const WASM = { runtime: "web-tree-sitter/tree-sitter.wasm", grammar: "tree-sitter-python/tree-sitter-python.wasm" };

let parser: Parser | null = null;

/** Load tree-sitter and the Python grammar (WASM: no native build, runs anywhere Node runs). */
async function init(): Promise<void> {
  if (parser) return;
  // Resolved at runtime by Node, not by the bundler (which would try to compile the WASM).
  // From this file first (pnpm parse, tests), then from the app root (bundled server).
  const requires = [createRequire(import.meta.url), createRequire(path.join(process.cwd(), "package.json"))];
  const wasm = (spec: string) => {
    for (const req of requires) {
      try {
        return new Uint8Array(readFileSync(req.resolve(/* turbopackIgnore: true */ /* webpackIgnore: true */ spec)));
      } catch {
        // try the next location
      }
    }
    throw new Error(`Python plug-in: cannot find ${spec}. Is ${spec.split("/")[0]} installed?`);
  };
  await Parser.init({ wasmBinary: wasm(WASM.runtime) } as object);
  const lang = await Language.load(wasm(WASM.grammar));
  const p = new Parser();
  p.setLanguage(lang);
  parser = p;
}

export const pythonPlugin: LanguagePlugin = {
  apiVersion: 1,
  id: "python",
  name: "Python",
  claims: (rel) => rel.endsWith(".py") || rel.endsWith(".pyi"),
  needsFile: (rel) => CONFIG.test(rel),
  init,
  open: (repo) => new PythonSession(repo),
};

export default pythonPlugin;

class PythonSession implements LanguageSession {
  private readonly projects: Project[];
  private readonly resolver: PythonResolver;
  private readonly facts = new Map<string, FileFacts>();

  constructor(private readonly repo: RepoView) {
    if (!parser) throw new Error("Python plug-in used before init()");
    this.projects = findProjects(repo).projects;
    this.resolver = new PythonResolver(repo, this.projects, pytestInUse(repo, this.projects));
  }

  skipReason(rel: string): string | null {
    return rel.endsWith(".pyi") ? "type stub file (.pyi): describes types, contains no imports that run" : null;
  }

  parse(rel: string, text: string): RawImport[] {
    const tree = parser!.parse(text);
    if (!tree) return [];
    try {
      const { imports, facts } = extract(tree);
      this.facts.set(rel, facts);
      return imports;
    } finally {
      tree.delete();
    }
  }

  resolve(fromRel: string, specifier: string) {
    return this.resolver.resolve(fromRel, specifier);
  }

  finish(parsed: string[]): FinishResult {
    const parsedSet = new Set(parsed);
    const rolesByFile = new Map<string, string[]>();
    const add = (f: string, role: string) => {
      const r = rolesByFile.get(f) ?? [];
      if (!r.includes(role)) r.push(role);
      rolesByFile.set(f, r);
    };
    // [project.scripts] "pkg.mod:func": the module is what the installed command runs
    for (const p of this.projects) {
      for (const target of p.scripts) {
        const mod = target.split(":")[0].trim();
        if (!mod) continue;
        const anchor = p.dir === "." ? "pyproject.toml" : `${p.dir}/pyproject.toml`;
        const res = this.resolver.resolve(anchor, mod);
        if (res.status === "resolved" && res.to && parsedSet.has(res.to)) add(res.to, "package-entry");
      }
    }
    for (const f of parsed) {
      if (this.facts.get(f)?.mainGuard || path.posix.basename(f) === "__main__.py") add(f, "main-script");
      if (isTestFile(f)) add(f, "test");
    }
    const fw = applyFrameworks(this.repo, this.projects, this.resolver, parsed, this.facts);
    for (const [f, roles] of fw.rolesByFile) for (const r of roles) add(f, r);
    const used = new Set([...rolesByFile.values()].flat());
    const common = Object.fromEntries(Object.entries(ROLES).filter(([id]) => used.has(id)));
    const framework: FrameworkInfo = fw.framework
      ? { ...fw.framework, roles: { ...fw.framework.roles, ...common } }
      : { id: "none", name: "No framework detected", evidence: null, roles: common, routes: [], supportsRoutes: false, others: [] };
    return { framework, rolesByFile, entryRoles: new Set([...ENTRY_ROLES, ...fw.entryRoles]) };
  }
}

/** pytest's rules apply only when the repo uses pytest. */
function pytestInUse(repo: RepoView, projects: Project[]): boolean {
  if (projects.some((p) => p.pytest || p.deps.has("pytest"))) return true;
  for (const f of repo.files) {
    const b = path.posix.basename(f);
    if (b === "conftest.py" || b === "pytest.ini") return true;
    if (/^requirements[^/]*\.txt$/.test(b) && /^\s*pytest\b/m.test(repo.readText(f) ?? "")) return true;
  }
  return false;
}
