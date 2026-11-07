// Pure data types shared by the parser, graph math, storage and UI.
// This module must stay free of runtime imports.

import type { FrameworkInfo, ImportKind, ImportStatus } from "cartograph-lang-api";

export const PARSER_VERSION = 4;

// Shared with language plug-ins: defined once, in the plug-in contract.
export type { FrameworkInfo, ImportKind, ImportStatus, Route } from "cartograph-lang-api";

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
  /** id of the language plug-in that parsed it, e.g. "typescript" (maps from parser v3 and older lack it) */
  language: string;
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
