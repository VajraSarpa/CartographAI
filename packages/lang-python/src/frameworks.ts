import path from "node:path";
import type { FrameworkInfo, RepoView, Route } from "cartograph-lang-api";
import type { Arg, Binding, FileFacts } from "./extract";
import { normaliseName, type Project } from "./project";
import type { PythonResolver } from "./resolve";

/**
 * Python framework rules. Detection needs a declared dependency. Roles come
 * from Django's own file conventions (files Django loads by name) or from
 * syntax (the file creates a FastAPI/Flask app or router). Routes are shown
 * only when the HTTP method and the full path are both readable: every
 * prefix on the way from the app to the route must be a plain string, and a
 * router that is never included, or an app that may be mounted elsewhere,
 * shows no routes.
 */

export type FrameworkId = "django" | "fastapi" | "flask";

interface Framework {
  id: FrameworkId;
  name: string;
  dependency: string;
  roles: Record<string, string>;
  entryRoles: string[];
  supportsRoutes: boolean;
}

export const FRAMEWORKS: Framework[] = [
  {
    id: "django",
    name: "Django",
    dependency: "django",
    roles: {
      "django-settings": "Settings",
      "url-config": "URL configs (urls.py)",
      models: "Models",
      views: "Views",
      admin: "Admin",
      "app-config": "App configs (apps.py)",
      migration: "Migrations",
      "management-command": "Management commands",
      "template-tags": "Template tags",
      "django-entry": "Entry points (manage.py, wsgi, asgi)",
    },
    // Django loads these by name or by setting, not by import
    entryRoles: ["django-settings", "url-config", "admin", "app-config", "migration", "management-command", "template-tags", "django-entry"],
    // Django's path() does not say which HTTP methods a view accepts
    supportsRoutes: false,
  },
  {
    id: "fastapi",
    name: "FastAPI",
    dependency: "fastapi",
    roles: { "fastapi-app": "Apps (FastAPI())", router: "Routers (APIRouter())", endpoints: "Files with endpoints" },
    entryRoles: ["fastapi-app"],
    supportsRoutes: true,
  },
  {
    id: "flask",
    name: "Flask",
    dependency: "flask",
    roles: { "flask-app": "Apps (Flask())", blueprint: "Blueprints", endpoints: "Files with endpoints" },
    entryRoles: ["flask-app"],
    supportsRoutes: true,
  },
];

/** Where each framework's classes come from. */
const CTORS: Record<string, { fw: FrameworkId; kind: "app" | "router"; modules: string[] }> = {
  FastAPI: { fw: "fastapi", kind: "app", modules: ["fastapi", "fastapi.applications"] },
  APIRouter: { fw: "fastapi", kind: "router", modules: ["fastapi", "fastapi.routing"] },
  Flask: { fw: "flask", kind: "app", modules: ["flask", "flask.app"] },
  Blueprint: { fw: "flask", kind: "router", modules: ["flask", "flask.blueprints"] },
};
const FASTAPI_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];
const FLASK_METHODS = ["get", "post", "put", "patch", "delete"];

interface DepSource {
  dir: string;
  file: string;
  deps: Set<string>;
}

/** Dependency lists: every project, plus requirements*.txt files. */
export function depSources(repo: RepoView, projects: Project[]): DepSource[] {
  const out: DepSource[] = projects.map((p) => ({ dir: p.dir, file: p.file, deps: p.deps }));
  for (const f of repo.files) {
    if (!/(^|\/)requirements[^/]*\.txt$/.test(f)) continue;
    const deps = new Set<string>();
    for (const line of (repo.readText(f) ?? "").split(/\r?\n/)) {
      const t = line.replace(/#.*/, "").trim();
      if (!t || t.startsWith("-")) continue;
      deps.add(normaliseName(t.split(/[\s<>=!~;[(@]/)[0]));
    }
    out.push({ dir: path.posix.dirname(f), file: f, deps });
  }
  return out;
}

interface Obj {
  key: string;
  file: string;
  name: string;
  fw: FrameworkId;
  kind: "app" | "router";
  /** own prefix: undefined = none, null = not readable */
  prefix: string | null | undefined;
  line: number;
}

export function applyFrameworks(
  repo: RepoView,
  projects: Project[],
  resolver: PythonResolver,
  parsed: string[],
  facts: Map<string, FileFacts>,
): { framework: FrameworkInfo | null; rolesByFile: Map<string, string[]>; entryRoles: Set<string> } {
  const sources = depSources(repo, projects);
  // each file is governed by the nearest dependency list that names a framework
  const governing = (file: string): { fw: Framework; src: DepSource } | null => {
    const dir = path.posix.dirname(file);
    const hits = sources
      .filter((s) => s.dir === "." || dir === s.dir || dir.startsWith(s.dir + "/"))
      .sort((a, b) => b.dir.length - a.dir.length);
    for (const s of hits) {
      const fw = FRAMEWORKS.find((f) => s.deps.has(f.dependency));
      if (fw) return { fw, src: s };
    }
    return null;
  };

  const rolesByFile = new Map<string, string[]>();
  const add = (f: string, role: string) => {
    const r = rolesByFile.get(f) ?? [];
    if (!r.includes(role)) r.push(role);
    rolesByFile.set(f, r);
  };
  const filesBy = new Map<FrameworkId, { files: string[]; perSrc: Map<string, number> }>();
  const fwOf = new Map<string, FrameworkId>();
  for (const f of parsed) {
    const g = governing(f);
    if (!g) continue;
    fwOf.set(f, g.fw.id);
    const cur = filesBy.get(g.fw.id) ?? { files: [], perSrc: new Map<string, number>() };
    cur.files.push(f);
    cur.perSrc.set(g.src.file, (cur.perSrc.get(g.src.file) ?? 0) + 1);
    filesBy.set(g.fw.id, cur);
    if (g.fw.id === "django") for (const r of djangoRoles(f)) add(f, r);
  }

  // FastAPI / Flask objects, by syntax, only where that framework governs the file
  const objects = new Map<string, Obj>();
  for (const f of parsed) {
    const fw = fwOf.get(f);
    if (fw !== "fastapi" && fw !== "flask") continue;
    const ff = facts.get(f);
    if (!ff) continue;
    const seen = new Map<string, number>();
    for (const a of ff.assigns) seen.set(a.name, (seen.get(a.name) ?? 0) + 1);
    for (const a of ff.assigns) {
      const ctor = ctorOf(a.callee, ff.bindings);
      if (!ctor || ctor.fw !== fw) continue;
      // a name assigned more than once in a file is ambiguous: no routes through it
      if (seen.get(a.name)! > 1) continue;
      const prefixKw = ctor.fw === "fastapi" ? "prefix" : "url_prefix";
      objects.set(`${f}#${a.name}`, { key: `${f}#${a.name}`, file: f, name: a.name, fw: ctor.fw, kind: ctor.kind, prefix: kwString(a.args, prefixKw), line: a.line });
      add(f, ctor.kind === "app" ? (fw === "fastapi" ? "fastapi-app" : "flask-app") : fw === "fastapi" ? "router" : "blueprint");
    }
  }

  // Follow a reference like `items.router` from a file to the object it names.
  const lookup = (file: string, ref: string, depth = 0): Obj | null => {
    if (depth > 5) return null;
    const parts = ref.split(".");
    if (parts.length === 1 && objects.has(`${file}#${ref}`)) return objects.get(`${file}#${ref}`)!;
    const ff = facts.get(file);
    if (!ff) return null;
    const b = [...ff.bindings].reverse().find((x) => x.local === parts[0]);
    if (!b) return null;
    if ("module" in b) {
      // `import pkg.mod` then `pkg.mod.router`: the longest module prefix that resolves
      // the module is everything but the last part; the last part is the object
      const dotted = b.local !== b.module.split(".")[0] ? [...b.module.split("."), ...parts.slice(1)] : parts;
      if (dotted.length < 2) return null;
      const res = resolver.resolve(file, dotted.slice(0, -1).join("."));
      return res.status === "resolved" && res.to ? lookup(res.to, dotted[dotted.length - 1], depth + 1) : null;
    }
    const res = resolver.resolve(file, b.spec);
    if (res.status !== "resolved" || !res.to) return null;
    const isSubmodule = path.posix.basename(res.to) === `${b.name}.py` || res.to.endsWith(`/${b.name}/__init__.py`);
    if (isSubmodule) return parts.length === 2 ? lookup(res.to, parts[1], depth + 1) : null;
    return parts.length === 1 ? lookup(res.to, b.name, depth + 1) : null;
  };

  // include_router / register_blueprint edges: child object <- (parent object, prefix)
  const includedBy = new Map<string, { parent: Obj; prefix: string | null | undefined }[]>();
  let mounted: Record<"fastapi" | "flask", boolean> = { fastapi: false, flask: false };
  for (const f of parsed) {
    const fw = fwOf.get(f);
    if (fw !== "fastapi" && fw !== "flask") continue;
    for (const c of facts.get(f)?.calls ?? []) {
      if (c.callee === "DispatcherMiddleware") mounted.flask = true;
      const m = /^(.*)\.(include_router|register_blueprint|mount)$/.exec(c.callee);
      if (!m) continue;
      const parent = lookup(f, m[1]);
      if (m[2] === "mount") {
        // a mounted sub-application serves its routes under a prefix we do not trace; static files are fine
        const app = c.args.filter((a) => a.kw === null)[1] ?? c.args.find((a) => a.kw === "app");
        if (!app?.call || !/(^|\.)StaticFiles$/.test(app.call)) mounted = { ...mounted, [fw]: true };
        continue;
      }
      const childRef = c.args.find((a) => a.kw === null)?.ref ?? c.args.find((a) => a.kw === "router" || a.kw === "blueprint")?.ref;
      if (!parent || !childRef) continue;
      const child = lookup(f, childRef);
      if (!child) continue;
      const kw = m[2] === "include_router" ? "prefix" : "url_prefix";
      const list = includedBy.get(child.key) ?? [];
      list.push({ parent, prefix: kwString(c.args, kw) });
      includedBy.set(child.key, list);
    }
  }

  /** every full prefix an object is served under; null entries mean "not readable" */
  const prefixes = (o: Obj, depth = 0): (string | null)[] => {
    if (depth > 8) return [null];
    if (o.kind === "app") return [""];
    const inc = includedBy.get(o.key) ?? [];
    const out: (string | null)[] = [];
    for (const { parent, prefix } of inc) {
      for (const p of prefixes(parent, depth + 1)) {
        if (p === null) {
          out.push(null);
          continue;
        }
        if (o.fw === "flask") {
          // register_blueprint(url_prefix=...) replaces the blueprint's own url_prefix
          const own = prefix !== undefined ? prefix : o.prefix;
          out.push(own === null ? null : flaskJoin(p, own ?? ""));
        } else {
          // FastAPI concatenates: include prefix + router prefix (+ route path later)
          out.push(prefix === null || o.prefix === null ? null : p + (prefix ?? "") + (o.prefix ?? ""));
        }
      }
    }
    return out;
  };

  const routes: Route[] = [];
  for (const f of parsed) {
    const fw = fwOf.get(f);
    if (fw !== "fastapi" && fw !== "flask") continue;
    if (mounted[fw]) continue;
    for (const d of facts.get(f)?.decorators ?? []) {
      const m = /^(.*)\.(\w+)$/.exec(d.callee);
      if (!m) continue;
      const obj = lookup(f, m[1]);
      if (!obj || obj.fw !== fw) continue;
      const methods = routeMethods(fw, m[2], d.args);
      if (!methods) continue;
      add(f, "endpoints");
      const sub = d.args.find((a) => a.kw === null) ?? d.args.find((a) => a.kw === (fw === "fastapi" ? "path" : "rule"));
      if (!sub || sub.str === undefined) continue;
      for (const p of prefixes(obj)) {
        if (p === null) continue;
        const full = fw === "fastapi" ? p + sub.str : flaskJoin(p, sub.str);
        for (const method of methods) routes.push({ method, path: full, file: f, line: d.line });
      }
    }
  }
  const unique = new Map(routes.map((r) => [`${r.method} ${r.path} ${r.file} ${r.line}`, r]));
  const sorted = [...unique.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method) || a.file.localeCompare(b.file));

  const ranked = [...filesBy.entries()].sort((a, b) => b[1].files.length - a[1].files.length || FRAMEWORKS.findIndex((x) => x.id === a[0]) - FRAMEWORKS.findIndex((x) => x.id === b[0]));
  const entryRoles = new Set(FRAMEWORKS.flatMap((f) => f.entryRoles));
  if (ranked.length === 0) return { framework: null, rolesByFile, entryRoles };
  const fwById = (id: FrameworkId) => FRAMEWORKS.find((f) => f.id === id)!;
  const evidence = (id: FrameworkId, perSrc: Map<string, number>) => {
    const top = [...perSrc.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
    return `${top} depends on ${fwById(id).dependency}`;
  };
  const used = new Set([...rolesByFile.values()].flat());
  const roles: Record<string, string> = {};
  for (const [id] of ranked) for (const [r, label] of Object.entries(fwById(id).roles)) if (used.has(r) && !(r in roles)) roles[r] = label;
  const [leadId, lead] = ranked[0];
  return {
    framework: {
      id: leadId,
      name: fwById(leadId).name,
      evidence: evidence(leadId, lead.perSrc),
      roles,
      routes: sorted,
      supportsRoutes: ranked.some(([id]) => fwById(id).supportsRoutes),
      others: ranked.slice(1).map(([id, v]) => ({ id, name: fwById(id).name, evidence: evidence(id, v.perSrc), files: v.files.length })),
    },
    rolesByFile,
    entryRoles,
  };
}

/** Django loads these files by name (app registry, autodiscovery) or by setting. */
function djangoRoles(f: string): string[] {
  const r: string[] = [];
  const base = path.posix.basename(f);
  const dir = path.posix.dirname(f);
  const segs = f.split("/");
  const inPkg = (name: string) => segs.slice(0, -1).includes(name);
  if (base === "settings.py" || inPkg("settings")) r.push("django-settings");
  if (base === "urls.py") r.push("url-config");
  if (base === "models.py" || (inPkg("models") && base.endsWith(".py"))) r.push("models");
  if (base === "views.py" || inPkg("views")) r.push("views");
  if (base === "admin.py") r.push("admin");
  if (base === "apps.py") r.push("app-config");
  if (inPkg("migrations") && base !== "__init__.py") r.push("migration");
  if (/(^|\/)management\/commands$/.test(dir) && base !== "__init__.py") r.push("management-command");
  if (inPkg("templatetags") && base !== "__init__.py") r.push("template-tags");
  if (base === "manage.py" || base === "wsgi.py" || base === "asgi.py") r.push("django-entry");
  return r;
}

/** Is `callee` one of the framework classes, imported from that framework? */
function ctorOf(callee: string, bindings: Binding[]): (typeof CTORS)[string] | null {
  const parts = callee.split(".");
  const cls = parts[parts.length - 1];
  const c = CTORS[cls];
  if (!c) return null;
  if (parts.length === 1) {
    const b = [...bindings].reverse().find((x) => x.local === cls);
    return b && "spec" in b && c.modules.some((m) => b.spec === `from ${m} import ${b.name}`) && b.name === cls ? c : null;
  }
  const mod = parts.slice(0, -1).join(".");
  const b = [...bindings].reverse().find((x) => x.local === parts[0]);
  if (!b || !("module" in b)) return null;
  const full = b.local === b.module.split(".")[0] ? mod : [b.module, ...parts.slice(1, -1)].join(".");
  return c.modules.includes(full) ? c : null;
}

function kwString(args: Arg[], kw: string): string | null | undefined {
  const a = args.find((x) => x.kw === kw);
  if (!a) return undefined;
  return a.str ?? null;
}

function routeMethods(fw: FrameworkId, attr: string, args: Arg[]): string[] | null {
  if (fw === "fastapi") {
    if (FASTAPI_METHODS.includes(attr)) return [attr.toUpperCase()];
    if (attr !== "api_route") return null;
  } else {
    if (FLASK_METHODS.includes(attr)) return [attr.toUpperCase()];
    if (attr !== "route") return null;
  }
  const m = args.find((a) => a.kw === "methods");
  // without methods=, both frameworks answer GET only (documented default)
  if (!m) return ["GET"];
  return m.list ? [...new Set(m.list.map((x) => x.toUpperCase()))] : null;
}

/** Flask: `prefix.rstrip("/") + "/" + rule.lstrip("/")`, or the rule alone without a prefix */
function flaskJoin(prefix: string, rule: string): string {
  if (!prefix) return rule;
  return rule ? `${prefix.replace(/\/+$/, "")}/${rule.replace(/^\/+/, "")}` : prefix;
}
