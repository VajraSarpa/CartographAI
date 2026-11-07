/**
 * The contract between Cartograph and a language plug-in.
 *
 * A plug-in says which files it owns, reads the imports out of each one, and
 * resolves every import to a real file in the repository or says why it could
 * not. Everything after that (graph, map, Explain, Ask) is language-neutral.
 *
 * The one rule: never decide two files are connected. Return `resolved` only
 * when a real import names a real file. Anything else is `external`,
 * `skipped` or `failed`, with a reason a person can read.
 *
 * This file is types only. Nothing in it runs.
 */

/** Bump only for a breaking change to this contract. */
export type LanguageApiVersion = 1;

export type ImportKind = "import" | "reexport" | "dynamic" | "require" | "import-equals";

export type ImportStatus = "resolved" | "external" | "skipped" | "failed";

/** One import statement as written in a file. */
export interface RawImport {
  /** the module as written, or the expression text when it is computed */
  specifier: string;
  kind: ImportKind;
  /** true when the import only brings in types and does nothing at runtime */
  typeOnly: boolean;
  /** 1-based line of the statement */
  line: number;
  /**
   * false when the target is only known at runtime (e.g. `import(name)`).
   * Cartograph lists it as skipped and never calls `resolve` for it.
   */
  literal: boolean;
}

/** What one import points at. */
export interface Resolution {
  status: ImportStatus;
  /** posix path relative to the repo root; required for "resolved" */
  to?: string;
  /** package name, for "external" */
  pkg?: string;
  /** why it is not an edge, for "skipped" and "failed" */
  reason?: string;
}

export interface Route {
  method: string;
  path: string;
  file: string;
  line: number;
}

export interface FrameworkInfo {
  /** short id, e.g. "nextjs", "django"; "none" when nothing was detected */
  id: string;
  name: string;
  /** what in the repo proved it, e.g. "package.json dependency next" */
  evidence: string | null;
  /** role id -> human label, in display order */
  roles: Record<string, string>;
  /** only routes whose method and full path are both readable from code */
  routes: Route[];
  /** true if this framework has an exact-or-absent route rule */
  supportsRoutes: boolean;
  /** other frameworks governing parts of a monorepo */
  others: { id: string; name: string; evidence: string; files: number }[];
}

/** Read-only view of the repository. Plug-ins must not touch the disk directly. */
export interface RepoView {
  /** every file in the repository, posix paths relative to the root */
  files: ReadonlySet<string>;
  /**
   * Read a file inside the repository as UTF-8. Returns null when it does not
   * exist, is larger than `maxBytes` (default 512 KB), or cannot be read.
   */
  readText(rel: string, maxBytes?: number): string | null;
}

export interface FinishResult {
  /** the framework this language found, or null for none */
  framework: FrameworkInfo | null;
  /** role ids per parsed file (files left out have no roles) */
  rolesByFile: Map<string, string[]>;
  /** role ids that make a file an entry point (reached without being imported) */
  entryRoles: ReadonlySet<string>;
}

/** State for one repository. Created by `LanguagePlugin.open`, thrown away after. */
export interface LanguageSession {
  /** A reason to skip a claimed file without reading it (e.g. type declarations), or null. */
  skipReason?(rel: string): string | null;
  /** The imports in one file, in source order. Called once per file. */
  parse(rel: string, text: string): RawImport[];
  /** Resolve one literal import. Called after `parse` for that file. */
  resolve(fromRel: string, specifier: string): Resolution;
  /** After every file is parsed: framework and roles. `parsed` lists the files that were parsed. */
  finish?(parsed: string[]): FinishResult;
}

export interface LanguagePlugin {
  apiVersion: LanguageApiVersion;
  /** id used in CARTOGRAPH_LANGUAGES, e.g. "python" for package cartograph-lang-python */
  id: string;
  /** human name, e.g. "Python" */
  name: string;
  /** Does this language own the file? First enabled language that says yes wins. */
  claims(rel: string): boolean;
  /**
   * Non-code files this language reads (e.g. "pyproject.toml"). The GitHub
   * fetcher keeps these alongside code files; everything else is dropped.
   */
  needsFile?(rel: string): boolean;
  open(repo: RepoView): LanguageSession;
}
