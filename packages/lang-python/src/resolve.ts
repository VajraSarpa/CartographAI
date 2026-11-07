import path from "node:path";
import type { RepoView, Resolution } from "cartograph-lang-api";
import { matchesMember, type Project, type Root } from "./project";
import { STDLIB } from "./stdlib";

/** What a dotted name points at, within some import path. */
type Found =
  | { kind: "module"; file: string; root: Root }
  | { kind: "stub"; file: string; root: Root }
  | { kind: "namespace"; dir: string; root: Root };

export const isTestFile = (rel: string) => {
  const b = path.posix.basename(rel);
  return /^test_.*\.py$/.test(b) || /_test\.py$/.test(b) || b === "conftest.py";
};

/**
 * Resolves Python imports the way the import system does, over the folders
 * the repo itself puts on the import path: package roots declared in
 * pyproject.toml / setup.cfg (or the build backend's documented discovery
 * rule), pytest's rootdir insertion and `pythonpath` for test files, and
 * relative imports by package structure. A name found nowhere on those paths
 * is external; a name that only matches a file in some other folder is a
 * failure that says which folder would have to be on the path.
 */
export class PythonResolver {
  private readonly dirs = new Set<string>();
  private readonly codeDirs = new Set<string>();
  private readonly projectOf = new Map<string, Project | null>();

  constructor(
    private readonly repo: RepoView,
    private readonly projects: Project[],
    private readonly pytestInUse: boolean,
  ) {
    for (const f of repo.files) {
      let d = path.posix.dirname(f);
      const code = f.endsWith(".py") || f.endsWith(".pyi");
      while (true) {
        this.dirs.add(d);
        if (code) this.codeDirs.add(d);
        if (d === ".") break;
        d = path.posix.dirname(d);
      }
    }
  }

  /** nearest enclosing project */
  project(rel: string): Project | null {
    const dir = path.posix.dirname(rel);
    if (this.projectOf.has(dir)) return this.projectOf.get(dir)!;
    const p = this.projects
      .filter((x) => x.dir === "." || dir === x.dir || dir.startsWith(x.dir + "/"))
      .sort((a, b) => b.dir.length - a.dir.length)[0] ?? null;
    this.projectOf.set(dir, p);
    return p;
  }

  /** The import path for one file, in sys.path order. */
  rootsFor(rel: string): Root[] {
    const roots: Root[] = [];
    const add = (r: Root) => roots.some((x) => x.dir === r.dir) || roots.push(r);
    const own = this.project(rel);
    if (this.pytestInUse && isTestFile(rel)) {
      const cfg = own?.pytest ?? this.projects.find((p) => p.dir === "." && p.pytest)?.pytest ?? null;
      // pytest's default "prepend" mode puts the first folder above the test
      // file that is not a package (has no __init__.py) at the front of sys.path
      if (!cfg || cfg.importMode === "prepend") {
        let d = path.posix.dirname(rel);
        while (d !== "." && this.repo.files.has(`${d}/__init__.py`)) d = path.posix.dirname(d);
        add({ dir: d, source: `pytest rootdir insertion for test files (${d === "." ? "repo root" : d + "/"} has no __init__.py)` });
      }
      for (const p of cfg?.pythonpath ?? []) add({ dir: p, source: `${cfg!.file} pytest pythonpath` });
    }
    if (own) for (const r of own.roots) add(r);
    for (const other of this.projects) {
      if (other === own || other.roots.length === 0) continue;
      const why = own ? this.link(own, other) : null;
      if (why) for (const r of other.roots) add({ dir: r.dir, source: `${r.source}, via ${why}` });
    }
    return roots;
  }

  /** Is `other` installed alongside `own`? Only when the repo says so. */
  private link(own: Project, other: Project): string | null {
    if (other.name && own.deps.has(other.name)) return `${own.dir === "." ? "" : own.dir + "/"}pyproject dependency ${other.name}`;
    const ws = this.projects.find((w) => w.workspaceMembers.length && w.workspaceMembers.some((g) => matchesMember(own.dir, w.dir, g) || own.dir === w.dir) && w.workspaceMembers.some((g) => matchesMember(other.dir, w.dir, g) || other.dir === w.dir));
    if (ws) return `uv workspace in ${ws.dir === "." ? "" : ws.dir + "/"}pyproject.toml`;
    return null;
  }

  resolve(fromRel: string, spec: string): Resolution {
    if (spec.startsWith("sys.path") || spec.startsWith("site.addsitedir")) {
      return { status: "skipped", reason: "changes sys.path at runtime: imports in this file may resolve differently than shown" };
    }
    if (/^(importlib\.)?import_module\(|^__import__\(/.test(spec)) {
      const m = /\(\s*[rRbBuU]?["']([^"']*)["']/.exec(spec);
      return { status: "skipped", reason: `runtime import${m ? ` of "${m[1]}"` : ""}: the module is only chosen when the code runs, so it is not an edge` };
    }
    const from = /^from (\S+) import (\S+)$/.exec(spec);
    if (!from) return this.absolute(fromRel, spec, null);
    const [, mod, name] = from;
    if (mod.startsWith(".")) return this.relative(fromRel, mod, name);
    return this.absolute(fromRel, mod, name);
  }

  private relative(fromRel: string, mod: string, name: string): Resolution {
    const level = /^\.*/.exec(mod)![0].length;
    const rest = mod.slice(level);
    let base = path.posix.dirname(fromRel);
    for (let i = 1; i < level; i++) {
      if (base === ".") return { status: "failed", reason: `relative import goes above the repository root (${level} dots from ${fromRel})` };
      base = path.posix.dirname(base);
    }
    const target = rest ? joinDotted(base, rest) : base;
    const root: Root = { dir: ".", source: "relative import" };
    const found = this.at(target, root);
    return this.finish(found, name, `${".".repeat(level)}${rest}`, () => ({
      status: "failed",
      reason: `no module at ${target === "." ? "the repo root" : target} (relative import ${".".repeat(level)}${rest} from ${fromRel})`,
    }));
  }

  private absolute(fromRel: string, mod: string, name: string | null): Resolution {
    const top = mod.split(".")[0];
    if (top === "__future__") return { status: "external", pkg: "__future__" };
    const roots = this.rootsFor(fromRel);
    const found = this.find(mod, roots);
    if (!found && STDLIB.has(top)) return { status: "external", pkg: top };
    return this.finish(found, name, mod, () => this.notFound(fromRel, mod, roots));
  }

  /**
   * Python's search over sys.path: a regular package or module for the
   * top-level name wins wherever it is; otherwise a namespace package spans
   * every root that has the folder.
   */
  private find(mod: string, roots: Root[]): Found | null {
    const parts = mod.split(".");
    let regular: Found | null = null;
    const ns: Root[] = [];
    for (const r of roots) {
      const f = this.at(path.posix.join(r.dir, parts[0]), r);
      if (!f) continue;
      if (f.kind !== "namespace") {
        regular = f;
        break;
      }
      ns.push(r);
    }
    if (parts.length === 1) return regular ?? (ns.length ? { kind: "namespace", dir: path.posix.join(ns[0].dir, parts[0]), root: ns[0] } : null);
    let nsHit: Found | null = null;
    for (const r of regular ? [regular.root] : ns) {
      const f = this.at(joinDotted(r.dir, mod), r);
      if (!f) continue;
      if (f.kind !== "namespace") return f;
      nsHit ??= f;
    }
    return nsHit;
  }

  /** What lives at a path (no extension): package, module, stub or namespace folder. */
  private at(p: string, root: Root): Found | null {
    const f = (x: string) => this.repo.files.has(x);
    const pre = p === "." ? "" : `${p}/`;
    if (f(`${pre}__init__.py`)) return { kind: "module", file: `${pre}__init__.py`, root };
    if (p !== "." && f(`${p}.py`)) return { kind: "module", file: `${p}.py`, root };
    if (f(`${pre}__init__.pyi`)) return { kind: "stub", file: `${pre}__init__.pyi`, root };
    if (p !== "." && f(`${p}.pyi`)) return { kind: "stub", file: `${p}.pyi`, root };
    if (this.codeDirs.has(p)) return { kind: "namespace", dir: p, root };
    return null;
  }

  /** Turn a found module (plus the name imported from it) into a resolution. */
  private finish(found: Found | null, name: string | null, shown: string, missing: () => Resolution): Resolution {
    if (!found) return missing();
    const dir = found.kind === "namespace" ? found.dir : path.posix.basename(found.file).startsWith("__init__.") ? path.posix.dirname(found.file) : null;
    // `from pkg import sub`: sub is a submodule when pkg is a package and pkg/sub exists
    if (name && name !== "*" && dir !== null) {
      const sub = this.at(joinDotted(dir, name), found.root);
      if (sub && sub.kind !== "namespace") return this.toFile(sub, `${shown}.${name}`);
      if (sub && found.kind === "namespace") return this.namespaceOnly(`${shown}.${name}`, sub.kind === "namespace" ? sub.dir : dir);
    }
    if (found.kind === "namespace") {
      if (name && name !== "*") return { status: "failed", reason: `${shown} is a namespace package (folder ${found.dir}, no __init__.py) and has no module named ${name}` };
      return this.namespaceOnly(shown, found.dir);
    }
    return this.toFile(found, shown);
  }

  private toFile(f: Found, shown: string): Resolution {
    if (f.kind === "stub") return { status: "skipped", to: f.file, reason: `resolves to a type stub (${f.file}): describes types, does not run` };
    if (f.kind === "namespace") return this.namespaceOnly(shown, f.dir);
    return { status: "resolved", to: f.file };
  }

  private namespaceOnly(shown: string, dir: string): Resolution {
    return { status: "skipped", reason: `${shown} is a namespace package (folder ${dir}, no __init__.py): there is no file to link to` };
  }

  private notFound(fromRel: string, mod: string, roots: Root[]): Resolution {
    const parts = mod.split(".");
    const top = parts[0];
    for (const r of roots) {
      const t = this.at(path.posix.join(r.dir, top), r);
      if (t) {
        const where = t.kind === "namespace" ? t.dir : t.file;
        return { status: "failed", reason: `${top} is in the repository (${where}, on the path via ${r.source}) but ${mod} was not found there` };
      }
    }
    for (const other of this.projects) {
      for (const r of other.roots) {
        if (roots.some((x) => x.dir === r.dir)) continue;
        const t = this.find(mod, [r]);
        if (t) {
          const where = t.kind === "namespace" ? t.dir : t.file;
          const own = this.project(fromRel);
          const ownName = own ? `${own.dir === "." ? "the root project" : own.dir}` : "this file (in no project)";
          return { status: "failed", reason: `${mod} is ${where} in the project at ${other.dir === "." ? "the repo root" : other.dir}, but ${ownName} does not list it as a dependency or share a uv workspace with it` };
        }
      }
    }
    const here = path.posix.dirname(fromRel);
    const elsewhere = [here, "."]
      .filter((d, i, a) => a.indexOf(d) === i && !roots.some((r) => r.dir === d))
      .map((d) => ({ d, f: this.at(joinDotted(d, mod), { dir: d, source: "" }) }))
      // a module named like the package it imports (backends/jinja2.py: `import jinja2`) is not importing itself
      .find((x) => x.f && !(x.f.kind !== "namespace" && x.f.file === fromRel));
    if (elsewhere) {
      const where = elsewhere.f!.kind === "namespace" ? (elsewhere.f as { dir: string }).dir : (elsewhere.f as { file: string }).file;
      const folder = elsewhere.d === "." ? "the repo root" : `${elsewhere.d}/`;
      const how = elsewhere.d === here ? "e.g. when this file is run as a script" : "e.g. when run from the repo root";
      const known = roots.length ? `the import path the repo declares for this file is ${roots.map((r) => (r.dir === "." ? "the repo root" : r.dir + "/")).join(", ")}` : "the repo declares no import path for this file (no pyproject.toml or setup.cfg package settings cover it)";
      return { status: "failed", reason: `matches ${where} only if ${folder} is on sys.path (${how}); ${known}` };
    }
    return { status: "external", pkg: top };
  }
}

function joinDotted(dir: string, dotted: string): string {
  const j = path.posix.join(dir, ...dotted.split("."));
  return j === "" ? "." : j;
}
