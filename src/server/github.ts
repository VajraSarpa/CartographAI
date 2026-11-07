import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { Parser, type ReadEntry } from "tar";
import { CODE_EXTENSIONS, MAX_FILE_BYTES } from "@/parser/walk";
import { serverEnv } from "@/lib/env";

export { parseRepoUrl, type RepoRef } from "@/lib/repo-url";

/** Limits for untrusted downloads. */
export const LIMITS = {
  /** GitHub's reported repository size (KB, includes history) */
  maxRepoKb: 400_000,
  /** compressed archive bytes */
  maxArchiveBytes: 150_000_000,
  /** bytes actually written to disk */
  maxWrittenBytes: 300_000_000,
  maxEntries: 60_000,
  metaTimeoutMs: 15_000,
  downloadTimeoutMs: 120_000,
};

export class PipelineError extends Error {
  constructor(
    message: string,
    readonly userMessage: string = message,
  ) {
    super(message);
  }
}

function ghHeaders(accept = "application/vnd.github+json"): HeadersInit {
  const token = serverEnv().GITHUB_TOKEN;
  return {
    Accept: accept,
    "User-Agent": "cartograph",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export interface RepoMeta {
  owner: string;
  name: string;
  defaultBranch: string;
  sha: string;
  ref: string;
}

/** Public repositories only. Resolves the ref to an exact commit. */
export async function fetchRepoMeta(owner: string, name: string, ref: string | null): Promise<RepoMeta> {
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  let res: Response;
  try {
    res = await fetch(base, { headers: ghHeaders(), signal: AbortSignal.timeout(LIMITS.metaTimeoutMs), cache: "no-store" });
  } catch (e) {
    throw new PipelineError(`GitHub metadata request failed: ${(e as Error).message}`, "GitHub did not respond in time. Try again.");
  }
  if (res.status === 404) throw new PipelineError("repo not found", "Repository not found, or it is not public.");
  if (res.status === 403 || res.status === 429) {
    throw new PipelineError(`GitHub rate limit (${res.status})`, "GitHub rate limit reached. Try again later.");
  }
  if (!res.ok) throw new PipelineError(`GitHub returned ${res.status}`, `GitHub returned an error (${res.status}).`);
  const meta = (await res.json()) as { private?: boolean; size?: number; default_branch?: string; owner?: { login?: string }; name?: string };
  if (meta.private) throw new PipelineError("private repo", "Only public repositories can be analyzed.");
  if ((meta.size ?? 0) > LIMITS.maxRepoKb) {
    throw new PipelineError(`repo too large: ${meta.size} KB`, `Repository is too large (${Math.round((meta.size ?? 0) / 1000)} MB; limit ${LIMITS.maxRepoKb / 1000} MB).`);
  }
  const useRef = ref ?? meta.default_branch ?? "HEAD";
  let shaRes: Response;
  try {
    shaRes = await fetch(`${base}/commits/${encodeURIComponent(useRef)}`, {
      headers: ghHeaders("application/vnd.github.sha"),
      signal: AbortSignal.timeout(LIMITS.metaTimeoutMs),
      cache: "no-store",
    });
  } catch (e) {
    throw new PipelineError(`GitHub commit request failed: ${(e as Error).message}`, "GitHub did not respond in time. Try again.");
  }
  if (shaRes.status === 404 || shaRes.status === 422) throw new PipelineError("ref not found", `Branch or tag "${useRef}" not found.`);
  if (!shaRes.ok) throw new PipelineError(`GitHub returned ${shaRes.status} for commit`, `GitHub returned an error (${shaRes.status}).`);
  const sha = (await shaRes.text()).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new PipelineError("unexpected commit response", "GitHub returned an unexpected response.");
  return { owner: meta.owner?.login ?? owner, name: meta.name ?? name, defaultBranch: meta.default_branch ?? useRef, sha, ref: useRef };
}

const KEEP_CONTENT = (rel: string) =>
  CODE_EXTENSIONS.some((e) => rel.endsWith(e)) || rel.endsWith(".json") || rel.endsWith(".html");

export interface ExtractStats {
  entries: number;
  written: number;
  archiveBytes: number;
  /** code files written as placeholders because of size: path -> real size */
  oversized: Map<string, number>;
}

/**
 * Stream the archive straight into a hand-checked extractor:
 * - only regular files and directories (no symlinks, hard links, devices)
 * - every path must stay inside `dest` after normalisation
 * - only code, JSON and HTML get their content written; every other file is a
 *   zero-byte placeholder so imports of assets still resolve as "asset"
 * - hard caps on archive size, entry count and bytes written
 */
export async function downloadAndExtract(meta: RepoMeta, dest: string): Promise<ExtractStats> {
  const url = `https://codeload.github.com/${encodeURIComponent(meta.owner)}/${encodeURIComponent(meta.name)}/tar.gz/${meta.sha}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": "cartograph" }, signal: AbortSignal.timeout(LIMITS.downloadTimeoutMs), cache: "no-store" });
  } catch (e) {
    throw new PipelineError(`archive download failed: ${(e as Error).message}`, "Downloading the repository timed out.");
  }
  if (!res.ok || !res.body) throw new PipelineError(`archive returned ${res.status}`, `Could not download the repository (${res.status}).`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > LIMITS.maxArchiveBytes) throw new PipelineError("archive too large", "Repository archive is too large.");

  const root = path.resolve(dest);
  const stats: ExtractStats = { entries: 0, written: 0, archiveBytes: 0, oversized: new Map() };
  const writes: Promise<void>[] = [];
  const dirs = new Set<string>();

  const ensureDir = async (d: string) => {
    if (dirs.has(d)) return;
    await mkdir(d, { recursive: true });
    dirs.add(d);
  };

  await new Promise<void>((resolve, reject) => {
    let failed = false;
    const fail = (err: Error) => {
      if (failed) return;
      failed = true;
      parser.abort(err);
      reject(err);
    };
    const parser = new Parser({
      strict: false,
      onReadEntry: (entry: ReadEntry) => {
        stats.entries++;
        if (stats.entries > LIMITS.maxEntries) return fail(new PipelineError("too many entries", `Repository has more than ${LIMITS.maxEntries} files.`));
        // GitHub archives wrap everything in "<owner>-<repo>-<sha>/"
        const parts = entry.path.split("/").slice(1);
        const rel = path.posix.normalize(parts.join("/"));
        const isSafe = rel !== "." && rel !== "" && !rel.startsWith("..") && !path.posix.isAbsolute(rel) && !rel.includes("\0");
        const target = path.resolve(root, rel);
        if (!isSafe || !(target === root || target.startsWith(root + path.sep))) {
          entry.resume();
          return;
        }
        if (entry.type === "Directory") {
          writes.push(ensureDir(target));
          entry.resume();
          return;
        }
        if (entry.type !== "File" && entry.type !== "OldFile" && entry.type !== "ContiguousFile") {
          entry.resume(); // symlinks, links, devices, fifos: never materialised
          return;
        }
        const keep = KEEP_CONTENT(rel) && entry.size <= MAX_FILE_BYTES;
        if (!keep) {
          if (KEEP_CONTENT(rel)) stats.oversized.set(rel, entry.size);
          entry.resume();
          writes.push(ensureDir(path.dirname(target)).then(() => writeFile(target, "")));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        entry.on("data", (c: Buffer) => {
          size += c.length;
          chunks.push(c);
        });
        entry.on("end", () => {
          stats.written += size;
          if (stats.written > LIMITS.maxWrittenBytes) return fail(new PipelineError("too much data", "Repository source is too large."));
          writes.push(ensureDir(path.dirname(target)).then(() => writeFile(target, Buffer.concat(chunks, size), { flag: "wx" }).catch(() => undefined)));
        });
      },
    });
    parser.on("error", (e: Error) => fail(e));
    parser.on("end", () => !failed && resolve());

    const body = Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>);
    body.on("data", (c: Buffer) => {
      stats.archiveBytes += c.length;
      if (stats.archiveBytes > LIMITS.maxArchiveBytes) {
        body.destroy();
        fail(new PipelineError("archive too large", "Repository archive is too large."));
      }
    });
    body.on("error", (e) => fail(new PipelineError(`download interrupted: ${e.message}`, "The download was interrupted.")));
    body.pipe(parser);
  });
  await Promise.all(writes);
  return stats;
}
