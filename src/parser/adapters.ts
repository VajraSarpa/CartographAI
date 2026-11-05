import path from "node:path";
import ts from "typescript";
import { decoratorName, type FileFacts } from "./extract";
import type { FrameworkInfo, Route } from "./types";

/**
 * Framework adapters. Each one is a set of rules: detection evidence from a
 * package.json, role rules over paths and syntax facts, and (optionally) an
 * exact-or-absent route rule. Nothing here guesses a connection.
 */

export interface AdapterInput {
  files: string[];
  facts: Map<string, FileFacts>;
  /** package.json path -> dependency names (deps, devDeps, peerDeps) */
  packages: Map<string, Set<string>>;
  /** package.json path -> entry files it names (main/module/bin/exports), already relative to root */
  packageEntries: Set<string>;
  /** entry files named by <script src> in index.html files */
  htmlEntries: Set<string>;
  readSource: (file: string) => ts.SourceFile | null;
}

interface Adapter {
  id: FrameworkInfo["id"];
  name: string;
  dependency: string | null;
  roles: Record<string, string>;
  supportsRoutes: boolean;
  rolesFor(file: string, facts: FileFacts | undefined, input: AdapterInput): string[];
  routes?(input: AdapterInput): Route[];
}

const COMMON_ROLES: Record<string, string> = {
  test: "Tests",
  config: "Config files",
  "package-entry": "Package entry points",
  "html-entry": "HTML script entries",
};

const ENTRY_ROLES = new Set([
  "test",
  "config",
  "package-entry",
  "html-entry",
  "page",
  "layout",
  "route-handler",
  "api-route",
  "middleware",
  "boundary",
  "instrumentation",
  "metadata",
  "nest-bootstrap",
  "theme",
  "docs-page",
]);

export function isEntryRole(role: string): boolean {
  return ENTRY_ROLES.has(role);
}

function commonRoles(file: string, input: AdapterInput): string[] {
  const r: string[] = [];
  const base = path.posix.basename(file);
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(base) || /(^|\/)(__tests__|__mocks__)\//.test(file)) r.push("test");
  if (/\.config\.[cm]?[jt]s$/.test(base) || /^\.?[\w-]+rc\.[cm]?js$/.test(base)) r.push("config");
  if (input.packageEntries.has(file)) r.push("package-entry");
  if (input.htmlEntries.has(file)) r.push("html-entry");
  return r;
}

// ---------- Next.js ----------

const NEXT_SPECIAL: Record<string, string> = {
  page: "page",
  layout: "layout",
  template: "layout",
  route: "route-handler",
  loading: "boundary",
  error: "boundary",
  "global-error": "boundary",
  "not-found": "boundary",
  forbidden: "boundary",
  unauthorized: "boundary",
  default: "boundary",
  sitemap: "metadata",
  robots: "metadata",
  manifest: "metadata",
  "opengraph-image": "metadata",
  "twitter-image": "metadata",
  icon: "metadata",
  "apple-icon": "metadata",
};

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** Locates the app/ or pages/ root a file sits under: "<prefix>app/" etc. */
function nextRouterRoot(file: string, dir: "app" | "pages"): { prefix: string; rest: string } | null {
  const m = file.match(new RegExp(`^((?:.*/)?(?:src/)?)${dir}/(.*)$`));
  if (!m) return null;
  // ignore nested node packages' own app folders only when they have no next dep; keep simple: accept
  return { prefix: m[1], rest: m[2] };
}

function nextAppRoutePath(rest: string): string {
  const segs = rest.split("/").slice(0, -1);
  const kept = segs.filter((s) => !(s.startsWith("(") && s.endsWith(")")) && !s.startsWith("@"));
  return "/" + kept.join("/");
}

const nextAdapter: Adapter = {
  id: "nextjs",
  name: "Next.js",
  dependency: "next",
  supportsRoutes: true,
  roles: {
    page: "Pages",
    layout: "Layouts",
    "route-handler": "Route handlers",
    "api-route": "API routes (pages)",
    "server-action": "Server actions",
    "client-component": "Client components",
    middleware: "Middleware / proxy",
    boundary: "Loading & error boundaries",
    metadata: "Metadata files",
    instrumentation: "Instrumentation",
  },
  rolesFor(file, facts) {
    const r: string[] = [];
    const base = path.posix.basename(file).replace(/\.[cm]?[jt]sx?$/, "");
    const app = nextRouterRoot(file, "app");
    if (app && NEXT_SPECIAL[base]) r.push(NEXT_SPECIAL[base]);
    const pages = nextRouterRoot(file, "pages");
    if (pages && !app) {
      if (pages.rest.startsWith("api/")) r.push("api-route");
      else if (!base.startsWith("_")) r.push("page");
      else r.push("layout");
    }
    if (/^(src\/)?(middleware|proxy)\.[jt]s$/.test(file)) r.push("middleware");
    if (/^(src\/)?instrumentation(-client)?\.[jt]s$/.test(file)) r.push("instrumentation");
    if (facts?.directive === "use server") r.push("server-action");
    if (facts?.directive === "use client") r.push("client-component");
    return r;
  },
  routes(input) {
    const out: Route[] = [];
    for (const file of input.files) {
      const app = nextRouterRoot(file, "app");
      if (!app || !/(^|\/)route\.[cm]?[jt]s$/.test(app.rest)) continue;
      const facts = input.facts.get(file);
      const methods = (facts?.exports ?? []).filter((e) => HTTP_METHODS.includes(e));
      if (!methods.length) continue;
      const sf = input.readSource(file);
      for (const m of methods) {
        out.push({ method: m, path: nextAppRoutePath(app.rest), file, line: sf ? exportLine(sf, m) : 1 });
      }
    }
    return out;
  },
};

function exportLine(sf: ts.SourceFile, name: string): number {
  for (const st of sf.statements) {
    const hit =
      ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name?.text === name) ||
      (ts.isVariableStatement(st) && st.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name));
    if (hit) return sf.getLineAndCharacterOfPosition(st.getStart(sf)).line + 1;
  }
  return 1;
}

// ---------- Nest.js ----------

const NEST_DECORATOR_ROLES: Record<string, string> = {
  Controller: "controller",
  Module: "module",
  Injectable: "provider",
  Resolver: "resolver",
  Entity: "entity",
  WebSocketGateway: "gateway",
  Catch: "filter",
};

const NEST_METHODS: Record<string, string> = {
  Get: "GET",
  Post: "POST",
  Put: "PUT",
  Patch: "PATCH",
  Delete: "DELETE",
  Head: "HEAD",
  Options: "OPTIONS",
  All: "ALL",
};

/** undefined = no argument, string = literal path, null = not readable */
function literalPathArg(call: ts.CallExpression): string | undefined | null {
  const a = call.arguments[0];
  if (!a) return undefined;
  if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) return a.text;
  if (ts.isObjectLiteralExpression(a)) {
    for (const p of a.properties) {
      if (ts.isPropertyAssignment(p) && p.name.getText() === "path") {
        return ts.isStringLiteral(p.initializer) ? p.initializer.text : null;
      }
    }
    return undefined;
  }
  return null;
}

function joinPath(...parts: (string | undefined)[]): string {
  const s = parts
    .filter((p): p is string => !!p)
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  return "/" + s;
}

const nestAdapter: Adapter = {
  id: "nestjs",
  name: "Nest.js",
  dependency: "@nestjs/core",
  supportsRoutes: true,
  roles: {
    controller: "Controllers",
    module: "Modules",
    provider: "Providers (@Injectable)",
    resolver: "GraphQL resolvers",
    entity: "Entities",
    gateway: "Gateways",
    filter: "Exception filters",
    dto: "DTOs",
    "nest-bootstrap": "Bootstrap (main)",
  },
  rolesFor(file, facts) {
    const r = new Set<string>();
    for (const d of facts?.classDecorators ?? []) if (NEST_DECORATOR_ROLES[d]) r.add(NEST_DECORATOR_ROLES[d]);
    if (/\.dto\.ts$/.test(file)) r.add("dto");
    if (/(^|\/)src\/main\.ts$/.test(file)) r.add("nest-bootstrap");
    return [...r];
  },
  routes(input) {
    // A global prefix or RouterModule changes every path. If either is present
    // and not a literal we can read, no route is shown (exact or absent).
    let globalPrefix: string | undefined;
    for (const file of input.files) {
      const facts = input.facts.get(file);
      if (!facts) continue;
      const sf = input.readSource(file);
      if (!sf) continue;
      const text = sf.getFullText();
      if (text.includes("RouterModule")) return [];
      if (!text.includes("setGlobalPrefix")) continue;
      let unreadable = false;
      const visit = (n: ts.Node) => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "setGlobalPrefix") {
          const v = literalPathArg(n);
          if (typeof v === "string") globalPrefix = v;
          else unreadable = true;
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
      if (unreadable) return [];
    }
    const out: Route[] = [];
    for (const file of input.files) {
      if (!input.facts.get(file)?.classDecorators.includes("Controller")) continue;
      const sf = input.readSource(file);
      if (!sf) continue;
      const visit = (n: ts.Node) => {
        if (ts.isClassDeclaration(n)) {
          const ctrl = (ts.getDecorators(n) ?? []).find((d) => decoratorName(d) === "Controller");
          if (ctrl) {
            const prefix = ts.isCallExpression(ctrl.expression) ? literalPathArg(ctrl.expression) : undefined;
            if (prefix === null) return;
            for (const m of n.members) {
              if (!ts.isMethodDeclaration(m)) continue;
              for (const d of ts.getDecorators(m) ?? []) {
                const name = decoratorName(d);
                if (!name || !NEST_METHODS[name] || !ts.isCallExpression(d.expression)) continue;
                const sub = literalPathArg(d.expression);
                if (sub === null) continue;
                out.push({
                  method: NEST_METHODS[name],
                  path: joinPath(globalPrefix, prefix, sub),
                  file,
                  line: sf.getLineAndCharacterOfPosition(m.getStart(sf)).line + 1,
                });
              }
            }
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    return out;
  },
};

// ---------- Docusaurus ----------

const docusaurusAdapter: Adapter = {
  id: "docusaurus",
  name: "Docusaurus",
  dependency: "@docusaurus/core",
  supportsRoutes: false,
  roles: {
    "docs-page": "Site pages",
    theme: "Theme overrides (swizzled)",
    component: "Components",
    plugin: "Plugins",
  },
  rolesFor(file) {
    const r: string[] = [];
    if (/(^|\/)src\/pages\//.test(file)) r.push("docs-page");
    if (/(^|\/)src\/theme\//.test(file)) r.push("theme");
    if (/(^|\/)src\/components\//.test(file)) r.push("component");
    if (/(^|\/)plugins?\//.test(file)) r.push("plugin");
    if (/(^|\/)(docusaurus\.config|sidebars)\.[cm]?[jt]s$/.test(file)) r.push("config");
    return r;
  },
};

// ---------- React ----------

const reactAdapter: Adapter = {
  id: "react",
  name: "React",
  dependency: "react",
  supportsRoutes: false,
  roles: {
    "jsx-file": "Files that render JSX",
    hook: "Hooks (export use*)",
    context: "Contexts (createContext)",
  },
  rolesFor(_file, facts) {
    const r: string[] = [];
    if (facts?.hasJsx) r.push("jsx-file");
    if (facts?.exports.some((e) => /^use[A-Z0-9]/.test(e))) r.push("hook");
    if (facts?.createsContext) r.push("context");
    return r;
  },
};

// ---------- Express ----------

const EXPRESS_FOLDERS: Record<string, string> = {
  routes: "routes",
  router: "routes",
  routers: "routes",
  controllers: "controller",
  controller: "controller",
  services: "service",
  service: "service",
  models: "model",
  model: "model",
  middleware: "middleware",
  middlewares: "middleware",
  config: "config",
  utils: "util",
  helpers: "util",
  validations: "validation",
  validators: "validation",
};

const expressAdapter: Adapter = {
  id: "express",
  name: "Express",
  dependency: "express",
  // Express mounts routers at runtime (app.use(prefix, router)); full paths are
  // spread across files, so routes stay empty by design.
  supportsRoutes: false,
  roles: {
    routes: "Routes (folder)",
    controller: "Controllers (folder)",
    service: "Services (folder)",
    model: "Models (folder)",
    middleware: "Middleware (folder)",
    validation: "Validation (folder)",
    util: "Utilities (folder)",
  },
  rolesFor(file) {
    const r = new Set<string>();
    for (const seg of file.split("/").slice(0, -1)) {
      const role = EXPRESS_FOLDERS[seg.toLowerCase()];
      if (role) r.add(role);
    }
    return [...r];
  },
};

const NONE: Adapter = {
  id: "none",
  name: "No framework detected",
  dependency: null,
  supportsRoutes: false,
  roles: {},
  rolesFor: () => [],
};

/** Detection order matters: the first framework whose package is depended on wins. */
export const ADAPTERS: Adapter[] = [nextAdapter, nestAdapter, docusaurusAdapter, reactAdapter, expressAdapter];

/** Which framework a single package.json names, by detection order. */
function adapterForDeps(deps: Set<string>): Adapter | null {
  return ADAPTERS.find((a) => a.dependency && deps.has(a.dependency)) ?? null;
}

/**
 * Each file is governed by its nearest package.json that names a framework
 * (a monorepo can hold a Next.js app and an Express API side by side).
 * The repo-level framework is the one governing the most parsed files.
 */
export function applyAdapter(input: AdapterInput): {
  framework: FrameworkInfo;
  rolesByFile: Map<string, string[]>;
} {
  const pkgDirs = [...input.packages.entries()]
    .map(([p, deps]) => ({ dir: path.posix.dirname(p), pkg: p, adapter: adapterForDeps(deps) }))
    .filter((x): x is { dir: string; pkg: string; adapter: Adapter } => x.adapter !== null)
    .sort((a, b) => b.dir.length - a.dir.length);
  const governing = (file: string) =>
    pkgDirs.find((p) => p.dir === "." || file.startsWith(p.dir + "/")) ?? null;

  const filesByAdapter = new Map<Adapter, { files: string[]; perPkg: Map<string, number> }>();
  const rolesByFile = new Map<string, string[]>();
  const used = new Set<string>();
  const labels: Record<string, string> = {};
  for (const f of input.files) {
    const g = governing(f);
    const adapter = g?.adapter ?? NONE;
    if (g) {
      const cur = filesByAdapter.get(adapter) ?? { files: [] as string[], perPkg: new Map<string, number>() };
      cur.files.push(f);
      cur.perPkg.set(g.pkg, (cur.perPkg.get(g.pkg) ?? 0) + 1);
      filesByAdapter.set(adapter, cur);
    }
    const roles = [...new Set([...commonRoles(f, input), ...adapter.rolesFor(f, input.facts.get(f), input)])];
    rolesByFile.set(f, roles);
    for (const r of roles) {
      used.add(r);
      labels[r] ??= adapter.roles[r] ?? COMMON_ROLES[r] ?? r;
    }
  }

  const ranked = [...filesByAdapter.entries()].sort(
    (a, b) => b[1].files.length - a[1].files.length || ADAPTERS.indexOf(a[0]) - ADAPTERS.indexOf(b[0]),
  );
  const primary = ranked[0];
  const evidenceOf = (a: Adapter, perPkg: Map<string, number>) => {
    const top = [...perPkg.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
    return `${top} depends on ${a.dependency}`;
  };
  const routes: Route[] = [];
  for (const [adapter, { files }] of ranked) {
    if (adapter.routes) routes.push(...adapter.routes({ ...input, files }));
  }
  routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method) || a.file.localeCompare(b.file));

  // Role display order: primary adapter's order, then others, then common roles.
  const order = [...ranked.flatMap(([a]) => Object.keys(a.roles)), ...Object.keys(COMMON_ROLES)];
  const roles: Record<string, string> = {};
  for (const id of order) if (used.has(id) && !(id in roles)) roles[id] = labels[id];

  const framework: FrameworkInfo = primary
    ? {
        id: primary[0].id,
        name: primary[0].name,
        evidence: evidenceOf(primary[0], primary[1].perPkg),
        roles,
        routes,
        supportsRoutes: ranked.some(([a]) => a.supportsRoutes),
        others: ranked.slice(1).map(([a, v]) => ({ id: a.id, name: a.name, evidence: evidenceOf(a, v.perPkg), files: v.files.length })),
      }
    : { ...NONE_INFO, roles };
  return { framework, rolesByFile };
}

const NONE_INFO: FrameworkInfo = {
  id: "none",
  name: "No framework detected",
  evidence: null,
  roles: {},
  routes: [],
  supportsRoutes: false,
  others: [],
};
