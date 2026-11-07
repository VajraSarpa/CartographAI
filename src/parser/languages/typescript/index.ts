import path from "node:path";
import type { FinishResult, LanguagePlugin, LanguageSession, RepoView } from "cartograph-lang-api";
import { applyAdapter, ENTRY_ROLES } from "./adapters";
import { extractFacts, extractImports, parseSource, type FileFacts } from "./extract";
import { isCodeFile, isDeclarationFile } from "./files";
import { Resolver } from "./resolve";

const MAX_HTML_BYTES = 200_000;
const MAX_SOURCE_BYTES = 1_000_000;

/** TypeScript and JavaScript, read with the TypeScript compiler API. */
export const typescriptPlugin: LanguagePlugin = {
  apiVersion: 1,
  id: "typescript",
  name: "TypeScript / JavaScript",
  claims: isCodeFile,
  needsFile: (rel) => rel.endsWith(".json") || rel.endsWith(".html"),
  open: (repo) => new TypeScriptSession(repo),
};

class TypeScriptSession implements LanguageSession {
  private readonly resolver: Resolver;
  private readonly facts = new Map<string, FileFacts>();

  constructor(private readonly repo: RepoView) {
    this.resolver = new Resolver(repo);
    configureWorkspaces(repo, this.resolver);
  }

  skipReason(rel: string): string | null {
    return isDeclarationFile(rel) ? "type declaration file (.d.ts): describes types, contains no imports that run" : null;
  }

  parse(rel: string, text: string) {
    const sf = parseSource(rel, text);
    this.facts.set(rel, extractFacts(sf));
    return extractImports(sf);
  }

  resolve(fromRel: string, specifier: string) {
    return this.resolver.resolve(fromRel, specifier);
  }

  finish(parsed: string[]): FinishResult {
    const { repo, resolver } = this;
    const packages = new Map<string, Set<string>>();
    const packageEntries = new Set<string>();
    for (const f of repo.files) {
      if (path.posix.basename(f) !== "package.json") continue;
      const pkg = readJson(repo, f);
      if (!pkg) continue;
      const deps = new Set<string>();
      for (const k of ["dependencies", "devDependencies", "peerDependencies"]) {
        const v = pkg[k];
        if (v && typeof v === "object") Object.keys(v).forEach((d) => deps.add(d));
      }
      packages.set(f, deps);
      for (const spec of entrySpecifiers(pkg)) {
        const rel = spec.startsWith(".") ? spec : `./${spec}`;
        const res = resolver.resolve(f, rel);
        if (res.status === "resolved" && res.to) packageEntries.add(res.to);
      }
    }
    const htmlEntries = new Set<string>();
    for (const f of repo.files) {
      if (!f.endsWith(".html")) continue;
      const html = repo.readText(f, MAX_HTML_BYTES);
      if (html === null) continue;
      for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"'?#]+)["']/gi)) {
        const src = m[1];
        if (/^[a-z]+:\/\//i.test(src)) continue;
        const fromFile = src.startsWith("/") ? path.posix.join(path.posix.dirname(f), "__html__") : f;
        const spec = src.startsWith("/") ? `.${src}` : src.startsWith(".") ? src : `./${src}`;
        const res = resolver.resolve(fromFile, spec);
        if (res.status === "resolved" && res.to) htmlEntries.add(res.to);
      }
    }

    const { framework, rolesByFile } = applyAdapter({
      files: parsed,
      facts: this.facts,
      packages,
      packageEntries,
      htmlEntries,
      readSource: (file) => {
        const text = repo.readText(file, MAX_SOURCE_BYTES);
        return text === null ? null : parseSource(file, text);
      },
    });
    return { framework, rolesByFile, entryRoles: ENTRY_ROLES };
  }
}

/**
 * Workspace packages resolve to their folder only when the repo declares
 * workspaces (package.json "workspaces", pnpm-workspace.yaml or lerna.json):
 * that declaration is what makes the package manager link them.
 */
function configureWorkspaces(repo: RepoView, resolver: Resolver) {
  const pkgFiles = [...repo.files].filter((f) => path.posix.basename(f) === "package.json");
  const declared =
    repo.files.has("pnpm-workspace.yaml") ||
    repo.files.has("lerna.json") ||
    pkgFiles.some((f) => {
      const j = readJson(repo, f);
      return !!j && (Array.isArray(j.workspaces) || (!!j.workspaces && typeof j.workspaces === "object"));
    });
  const ws = new Map<string, string>();
  const withExports = new Set<string>();
  for (const f of pkgFiles) {
    const j = readJson(repo, f);
    if (!j) continue;
    const dir = path.posix.dirname(f);
    const deps = { ...(j.dependencies as object), ...(j.devDependencies as object) };
    if ("@docusaurus/core" in deps) resolver.addAlias("@site/", dir, "Docusaurus");
    if (declared && typeof j.name === "string" && dir !== "." && !ws.has(j.name)) {
      ws.set(j.name, dir);
      if (j.exports) withExports.add(j.name);
    }
  }
  resolver.setWorkspaces(ws, withExports);
}

function readJson(repo: RepoView, rel: string): Record<string, unknown> | null {
  const text = repo.readText(rel, 512_000);
  if (text === null) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

function entrySpecifiers(pkg: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of ["main", "module", "browser"]) if (typeof pkg[k] === "string") out.push(pkg[k] as string);
  const bin = pkg.bin;
  if (typeof bin === "string") out.push(bin);
  else if (bin && typeof bin === "object") Object.values(bin).forEach((v) => typeof v === "string" && out.push(v));
  const walkExports = (v: unknown, depth = 0) => {
    if (depth > 5) return;
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach((x) => walkExports(x, depth + 1));
  };
  walkExports(pkg.exports);
  return out.filter((s) => !s.includes("*"));
}
