import path from "node:path";

export const CODE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

export function isCodeFile(rel: string): boolean {
  return CODE_EXTENSIONS.some((e) => rel.endsWith(e));
}

export function isDeclarationFile(rel: string): boolean {
  return /\.d\.[cm]?ts$/.test(rel) || /\.d\.[^.]+\.ts$/.test(rel);
}

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
