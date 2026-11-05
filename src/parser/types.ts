// Pure data types shared by the parser, graph math, storage and UI.
// This module must stay free of runtime imports.

export const PARSER_VERSION = 3;

export type ImportKind = "import" | "reexport" | "dynamic" | "require" | "import-equals";

export type ImportStatus = "resolved" | "external" | "skipped" | "failed";

export interface ImportRecord {
  /** importing file, posix path relative to repo root */
  from: string;
  /** raw specifier as written, or the expression text for non-literal dynamic imports */
  specifier: string;
  kind: ImportKind;
  typeOnly: boolean;
  line: number;
  status: ImportStatus;
  /** resolved target file (status === "resolved") */
  to?: string;
  /** external package name (status === "external") */
  pkg?: string;
  /** why it is not an edge (status skipped | failed) */
  reason?: string;
}

export interface Edge {
  from: string;
  to: string;
  kinds: ImportKind[];
  typeOnly: boolean;
}

export interface FileNode {
  path: string;
  /** folder the file lives in ("." for the root) */
  module: string;
  ext: string;
  lines: number;
  bytes: number;
  hash: string;
  fanIn: number;
  fanOut: number;
  /** roles assigned by the framework adapter (by rule, never guessed) */
  roles: string[];
  /** reached by the framework without being imported (pages, layouts, tests, configs) */
  entry: boolean;
}

export interface SkippedFile {
  path: string;
  reason: string;
}

export interface Route {
  method: string;
  path: string;
  file: string;
  line: number;
}

export interface FrameworkInfo {
  id: "nextjs" | "nestjs" | "docusaurus" | "react" | "express" | "none";
  name: string;
  /** what in the repo proved it, e.g. "package.json dependency next" */
  evidence: string | null;
  /** role id -> human label, in display order */
  roles: Record<string, string>;
  routes: Route[];
  /** true if this framework has an exact-or-absent route rule */
  supportsRoutes: boolean;
  /** other frameworks governing parts of a monorepo */
  others: { id: FrameworkInfo["id"]; name: string; evidence: string; files: number }[];
}

export interface ParseStats {
  filesFound: number;
  filesParsed: number;
  filesSkipped: number;
  imports: Record<ImportStatus, number>;
  edges: number;
  lines: number;
}

export interface ParseResult {
  parserVersion: number;
  stats: ParseStats;
  files: FileNode[];
  edges: Edge[];
  /** every import that did not become an edge (external, skipped, failed) */
  unresolved: ImportRecord[];
  skipped: SkippedFile[];
  framework: FrameworkInfo;
}
