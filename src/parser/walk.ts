import { promises as fs } from "node:fs";
import path from "node:path";

export const CODE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const IGNORED_DIRS = new Set(["node_modules", ".git"]);
/** Files bigger than this are listed as skipped, never silently dropped. */
export const MAX_FILE_BYTES = 1_000_000;

export interface WalkedFile {
  rel: string; // posix, relative to root
  abs: string;
  bytes: number;
}

export interface WalkResult {
  code: WalkedFile[];
  /** every non-ignored file path (posix rel), used to explain asset imports */
  allFiles: Set<string>;
}

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

export function isCodeFile(rel: string): boolean {
  return CODE_EXTENSIONS.some((e) => rel.endsWith(e));
}

export function isDeclarationFile(rel: string): boolean {
  return /\.d\.[cm]?ts$/.test(rel) || /\.d\.[^.]+\.ts$/.test(rel);
}

/**
 * Walk a directory without following symlinks (untrusted input: a symlink
 * could point anywhere on the host). Symlinks are not code files we can read.
 */
export async function walk(
  root: string,
  maxFiles = 50_000,
  /** real sizes for files that were written as placeholders */
  sizeOverrides?: Map<string, number>,
): Promise<WalkResult> {
  const code: WalkedFile[] = [];
  const allFiles = new Set<string>();
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        if (!IGNORED_DIRS.has(ent.name)) stack.push(abs);
        continue;
      }
      if (!ent.isFile()) continue;
      const rel = toPosix(path.relative(root, abs));
      allFiles.add(rel);
      if (allFiles.size > maxFiles) {
        throw new Error(`Repository has more than ${maxFiles} files; refusing to parse.`);
      }
      if (isCodeFile(rel)) {
        const st = await fs.lstat(abs);
        code.push({ rel, abs, bytes: sizeOverrides?.get(rel) ?? st.size });
      }
    }
  }
  code.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return { code, allFiles };
}
