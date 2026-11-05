import { createHash } from "node:crypto";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { applyAdapter, isEntryRole } from "./adapters";
import { extractFacts, extractImports, parseSource, type FileFacts } from "./extract";
import { Resolver } from "./resolve";
import {
  PARSER_VERSION,
  type Edge,
  type FileNode,
  type ImportKind,
  type ImportRecord,
  type ParseResult,
  type SkippedFile,
} from "./types";
import { isDeclarationFile, MAX_FILE_BYTES, walk } from "./walk";

export * from "./types";

export interface ParseOptions {
  maxFiles?: number;
  /** called after each file so long runs can report progress */
  onProgress?: (done: number, total: number) => void;
}

const MAX_HTML_BYTES = 200_000;

/**
 * Parse a directory into a map. Takes a path, returns data.
 * Every code file found is either parsed or listed in `skipped` with a reason;
 * every import is either an edge or listed in `unresolved` with a status.
 */
export async function parseRepo(root: string, opts: ParseOptions = {}): Promise<ParseResult> {
  root = path.resolve(root);
  const { code, allFiles } = await walk(root, opts.maxFiles);
  const resolver = new Resolver(root, allFiles);
  configureWorkspaces(root, allFiles, resolver);

  const skipped: SkippedFile[] = [];
  const nodes = new Map<string, Omit<FileNode, "fanIn" | "fanOut" | "roles" | "entry">>();
  const facts = new Map<string, FileFacts>();
  const records: ImportRecord[] = [];

  let done = 0;
  for (const f of code) {
    done++;
    if (isDeclarationFile(f.rel)) {
      skipped.push({ path: f.rel, reason: "type declaration file (.d.ts): describes types, contains no imports that run" });
      continue;
    }
    if (f.bytes > MAX_FILE_BYTES) {
      skipped.push({ path: f.rel, reason: `larger than ${MAX_FILE_BYTES / 1_000_000} MB (${f.bytes} bytes)` });
      continue;
    }
    let buf: Buffer;
    try {
      buf = await fs.readFile(f.abs);
    } catch (e) {
      skipped.push({ path: f.rel, reason: `could not read file: ${(e as Error).message}` });
      continue;
    }
    if (buf.includes(0)) {
      skipped.push({ path: f.rel, reason: "binary content (contains NUL bytes)" });
      continue;
    }
    const text = buf.toString("utf8");
    const lines = text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    if (lines <= 3 && text.length > 20_000) {
      skipped.push({ path: f.rel, reason: `minified bundle (${text.length} characters on ${lines} line(s))` });
      continue;
    }
    const sf = parseSource(f.rel, text);
    facts.set(f.rel, extractFacts(sf));
    nodes.set(f.rel, {
      path: f.rel,
      module: path.posix.dirname(f.rel),
      ext: path.posix.extname(f.rel),
      lines,
      bytes: f.bytes,
      hash: createHash("sha256").update(buf).digest("hex").slice(0, 16),
    });
    for (const imp of extractImports(sf)) {
      const base = { from: f.rel, specifier: imp.specifier, kind: imp.kind, typeOnly: imp.typeOnly, line: imp.line };
      if (!imp.literal) {
        records.push({ ...base, status: "skipped", reason: "computed specifier: the target is only known at runtime" });
        continue;
      }
      records.push({ ...base, ...resolver.resolve(f.rel, imp.specifier) });
    }
    opts.onProgress?.(done, code.length);
  }

  // A resolved target that was itself skipped (e.g. too large) cannot be an edge.
  for (const r of records) {
    if (r.status === "resolved" && r.to && !nodes.has(r.to)) {
      const why = skipped.find((s) => s.path === r.to)?.reason ?? "not parsed";
      r.status = "skipped";
      r.reason = `target ${r.to} was skipped: ${why}`;
    }
  }

  // Edges: one per (from, to) pair, carrying every kind of import that made it.
  const edgeMap = new Map<string, { from: string; to: string; kinds: Set<ImportKind>; typeOnly: boolean }>();
  for (const r of records) {
    if (r.status !== "resolved" || !r.to) continue;
    const key = `${r.from}\u0000${r.to}`;
    const e = edgeMap.get(key);
    if (e) {
      e.kinds.add(r.kind);
      e.typeOnly = e.typeOnly && r.typeOnly;
    } else {
      edgeMap.set(key, { from: r.from, to: r.to, kinds: new Set([r.kind]), typeOnly: r.typeOnly });
    }
  }
  const edges: Edge[] = [...edgeMap.values()]
    .map((e) => ({ from: e.from, to: e.to, kinds: [...e.kinds].sort(), typeOnly: e.typeOnly }))
    .sort((a, b) => (a.from === b.from ? cmp(a.to, b.to) : cmp(a.from, b.from)));

  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  for (const e of edges) {
    if (e.from === e.to) continue; // a self-import connects nothing
    fanOut.set(e.from, (fanOut.get(e.from) ?? 0) + 1);
    fanIn.set(e.to, (fanIn.get(e.to) ?? 0) + 1);
  }

  // Inputs for framework adapters.
  const packages = new Map<string, Set<string>>();
  const packageEntries = new Set<string>();
  for (const f of allFiles) {
    if (path.posix.basename(f) !== "package.json") continue;
    const pkg = readJson(path.join(root, f));
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
  for (const f of allFiles) {
    if (!f.endsWith(".html")) continue;
    let html: string;
    try {
      const b = readFileSync(path.join(root, f));
      if (b.length > MAX_HTML_BYTES) continue;
      html = b.toString("utf8");
    } catch {
      continue;
    }
    for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"'?#]+)["']/gi)) {
      const src = m[1];
      if (/^[a-z]+:\/\//i.test(src)) continue;
      const fromFile = src.startsWith("/") ? path.posix.join(path.posix.dirname(f), "__html__") : f;
      const spec = src.startsWith("/") ? `.${src}` : src.startsWith(".") ? src : `./${src}`;
      const res = resolver.resolve(fromFile, spec);
      if (res.status === "resolved" && res.to) htmlEntries.add(res.to);
    }
  }

  const fileList = [...nodes.keys()];
  const { framework, rolesByFile } = applyAdapter({
    files: fileList,
    facts,
    packages,
    packageEntries,
    htmlEntries,
    readSource: (file) => {
      try {
        return parseSource(file, readFileSync(path.join(root, file), "utf8"));
      } catch {
        return null;
      }
    },
  });

  const files: FileNode[] = fileList.map((p) => {
    const roles = rolesByFile.get(p) ?? [];
    return {
      ...nodes.get(p)!,
      fanIn: fanIn.get(p) ?? 0,
      fanOut: fanOut.get(p) ?? 0,
      roles,
      entry: roles.some(isEntryRole),
    };
  });

  const unresolved = records
    .filter((r) => r.status !== "resolved")
    .sort((a, b) => (a.from === b.from ? a.line - b.line : cmp(a.from, b.from)));

  const count = { resolved: 0, external: 0, skipped: 0, failed: 0 };
  for (const r of records) count[r.status]++;

  return {
    parserVersion: PARSER_VERSION,
    stats: {
      filesFound: code.length,
      filesParsed: files.length,
      filesSkipped: skipped.length,
      imports: count,
      edges: edges.length,
      lines: files.reduce((s, f) => s + f.lines, 0),
    },
    files,
    edges,
    unresolved,
    skipped: skipped.sort((a, b) => cmp(a.path, b.path)),
    framework,
  };
}

/**
 * Workspace packages resolve to their folder only when the repo declares
 * workspaces (package.json "workspaces", pnpm-workspace.yaml or lerna.json):
 * that declaration is what makes the package manager link them.
 */
function configureWorkspaces(root: string, allFiles: Set<string>, resolver: Resolver) {
  const pkgFiles = [...allFiles].filter((f) => path.posix.basename(f) === "package.json");
  const declared =
    allFiles.has("pnpm-workspace.yaml") ||
    allFiles.has("lerna.json") ||
    pkgFiles.some((f) => {
      const j = readJson(path.join(root, f));
      return !!j && (Array.isArray(j.workspaces) || (!!j.workspaces && typeof j.workspaces === "object"));
    });
  const ws = new Map<string, string>();
  const withExports = new Set<string>();
  for (const f of pkgFiles) {
    const j = readJson(path.join(root, f));
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

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function readJson(abs: string): Record<string, unknown> | null {
  try {
    const b = readFileSync(abs);
    if (b.length > 512_000) return null;
    const v = JSON.parse(b.toString("utf8"));
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
