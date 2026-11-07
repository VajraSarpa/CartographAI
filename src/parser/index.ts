import { createHash } from "node:crypto";
import { promises as fs, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { FinishResult, LanguagePlugin, LanguageSession, RepoView, Resolution } from "cartograph-lang-api";
import { typescriptPlugin } from "./languages/typescript";
import {
  PARSER_VERSION,
  type Edge,
  type FileNode,
  type FrameworkInfo,
  type ImportKind,
  type ImportRecord,
  type ParseResult,
  type SkippedFile,
} from "./types";
import { MAX_FILE_BYTES, walk } from "./walk";

export * from "./types";

export interface ParseOptions {
  /** enabled languages, in priority order (first to claim a file owns it); default TypeScript/JavaScript only (the app passes CARTOGRAPH_LANGUAGES) */
  languages?: readonly LanguagePlugin[];
  maxFiles?: number;
  /** real sizes of files the fetcher wrote as empty placeholders (too large to keep) */
  sizeOverrides?: Map<string, number>;
  /** called after each file so long runs can report progress */
  onProgress?: (done: number, total: number) => void;
}

const DEFAULT_READ_BYTES = 512_000;

/**
 * Parse a directory into a map. Takes a path, returns data.
 * Every code file found is either parsed or listed in `skipped` with a reason;
 * every import is either an edge or listed in `unresolved` with a status.
 * What counts as code, and how imports resolve, is up to the language plug-ins.
 */
export async function parseRepo(root: string, opts: ParseOptions = {}): Promise<ParseResult> {
  root = path.resolve(root);
  const languages = opts.languages ?? [typescriptPlugin];
  if (languages.length === 0) throw new Error("parseRepo: no languages enabled");
  for (const l of languages) await l.init?.();
  const owner = (rel: string) => languages.find((l) => l.claims(rel));
  const { code, allFiles } = await walk(root, (rel) => owner(rel) !== undefined, opts.maxFiles, opts.sizeOverrides);
  const repo = repoView(root, allFiles);
  const sessions = new Map<LanguagePlugin, LanguageSession>(languages.map((l) => [l, l.open(repo)]));

  const skipped: SkippedFile[] = [];
  const nodes = new Map<string, Omit<FileNode, "fanIn" | "fanOut" | "roles" | "entry">>();
  const parsedBy = new Map<LanguagePlugin, string[]>();
  const records: ImportRecord[] = [];

  let done = 0;
  for (const f of code) {
    done++;
    const lang = owner(f.rel)!;
    const session = sessions.get(lang)!;
    const early = session.skipReason?.(f.rel);
    if (early) {
      skipped.push({ path: f.rel, reason: early });
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
    const imports = session.parse(f.rel, text);
    nodes.set(f.rel, {
      path: f.rel,
      module: path.posix.dirname(f.rel),
      ext: path.posix.extname(f.rel),
      language: lang.id,
      lines,
      bytes: f.bytes,
      hash: createHash("sha256").update(buf).digest("hex").slice(0, 16),
    });
    const list = parsedBy.get(lang);
    if (list) list.push(f.rel);
    else parsedBy.set(lang, [f.rel]);
    for (const imp of imports) {
      const base = { from: f.rel, specifier: imp.specifier, kind: imp.kind, typeOnly: imp.typeOnly, line: imp.line };
      if (!imp.literal) {
        records.push({ ...base, status: "skipped", reason: "computed specifier: the target is only known at runtime" });
        continue;
      }
      records.push({ ...base, ...checked(session.resolve(f.rel, imp.specifier), allFiles, lang) });
    }
    opts.onProgress?.(done, code.length);
  }

  // A resolved target that was itself skipped (e.g. too large), or that no
  // language parsed, cannot be an edge.
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

  const finished = languages.map((l) => ({ lang: l, files: parsedBy.get(l) ?? [], ...finish(sessions.get(l)!, parsedBy.get(l) ?? []) }));
  const framework = mergeFrameworks(finished);

  const fileList = [...nodes.keys()];
  const files: FileNode[] = fileList.map((p) => {
    const lang = owner(p)!;
    const fin = finished.find((x) => x.lang === lang)!;
    const roles = fin.rolesByFile.get(p) ?? [];
    return {
      ...nodes.get(p)!,
      fanIn: fanIn.get(p) ?? 0,
      fanOut: fanOut.get(p) ?? 0,
      roles,
      entry: roles.some((r) => fin.entryRoles.has(r)),
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

/** The only way a plug-in can read the repository: files inside it, size-capped. */
function repoView(root: string, files: ReadonlySet<string>): RepoView {
  return {
    files,
    readText(rel, maxBytes = DEFAULT_READ_BYTES) {
      if (!files.has(rel)) return null;
      const abs = path.join(root, rel);
      try {
        if (statSync(abs).size > maxBytes) return null;
        return readFileSync(abs).toString("utf8");
      } catch {
        return null;
      }
    },
  };
}

/** A plug-in may only claim an edge to a file that exists in the repository. */
function checked(res: Resolution, files: ReadonlySet<string>, lang: LanguagePlugin): Resolution {
  if (res.status === "resolved" && (!res.to || !files.has(res.to))) {
    return { status: "failed", reason: `${lang.name} resolver returned a file that is not in the repository (${res.to ?? "none"})` };
  }
  if ((res.status === "skipped" || res.status === "failed") && !res.reason) {
    return { ...res, reason: `${lang.name} resolver gave no reason` };
  }
  return res;
}

function finish(session: LanguageSession, parsed: string[]): FinishResult {
  return session.finish?.(parsed) ?? { framework: null, rolesByFile: new Map(), entryRoles: new Set() };
}

const NONE: FrameworkInfo = {
  id: "none",
  name: "No framework detected",
  evidence: null,
  roles: {},
  routes: [],
  supportsRoutes: false,
  others: [],
};

/**
 * One framework for the map. The language parsing the most files leads; a
 * framework another language found is listed under `others`, and its roles
 * and routes are kept.
 */
function mergeFrameworks(fins: { lang: LanguagePlugin; files: string[]; framework: FrameworkInfo | null }[]): FrameworkInfo {
  const found = fins.filter((f) => f.framework).sort((a, b) => b.files.length - a.files.length);
  if (found.length === 0) return NONE;
  if (found.length === 1) return found[0].framework!;
  const named = found.filter((f) => f.framework!.id !== "none");
  const lead = (named[0] ?? found[0]).framework!;
  const merged: FrameworkInfo = { ...lead, roles: { ...lead.roles }, routes: [...lead.routes], others: [...lead.others] };
  for (const f of found) {
    const fw = f.framework!;
    if (fw === lead) continue;
    for (const [id, label] of Object.entries(fw.roles)) merged.roles[id] ??= label;
    merged.routes.push(...fw.routes);
    merged.supportsRoutes ||= fw.supportsRoutes;
    if (fw.id !== "none" && fw.evidence) merged.others.push({ id: fw.id, name: fw.name, evidence: fw.evidence, files: f.files.length });
    merged.others.push(...fw.others);
  }
  merged.routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method) || a.file.localeCompare(b.file));
  return merged;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
