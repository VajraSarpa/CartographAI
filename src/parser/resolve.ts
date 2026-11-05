import path from "node:path";
import { readFileSync } from "node:fs";
import { ts } from "ts-morph";
import { isCodeFile, isDeclarationFile, toPosix } from "./walk";
import type { ImportStatus } from "./types";

export interface Resolution {
  status: ImportStatus;
  to?: string;
  pkg?: string;
  reason?: string;
}

interface ConfigEntry {
  options: ts.CompilerOptions;
  cache: ts.ModuleResolutionCache;
  aliasPatterns: string[];
  configPath: string | null;
}

const MAX_CONFIG_BYTES = 256_000;

/**
 * Resolves import specifiers the way TypeScript does, using the nearest
 * tsconfig.json / jsconfig.json, but through a host that can only see files
 * inside the repository root. Untrusted repos cannot make us read the host.
 */
export class Resolver {
  private readonly dirs = new Set<string>();
  private readonly configByDir = new Map<string, ConfigEntry>();
  private readonly host: ts.ModuleResolutionHost;
  private readonly parseHost: ts.ParseConfigHost;
  /** workspace package name -> its folder (only when the repo declares workspaces) */
  private workspaces = new Map<string, string>();
  private workspacesWithExports = new Set<string>();
  /** framework-defined aliases, e.g. Docusaurus "@site/" -> site folder */
  private aliases: { prefix: string; dir: string; source: string }[] = [];

  constructor(
    private readonly root: string,
    private readonly allFiles: Set<string>,
  ) {
    for (const f of allFiles) {
      let d = path.posix.dirname(f);
      while (d !== "." && !this.dirs.has(d)) {
        this.dirs.add(d);
        d = path.posix.dirname(d);
      }
    }
    this.dirs.add(".");
    const fileExists = (p: string) => {
      const rel = this.rel(p);
      return rel !== null && this.allFiles.has(rel);
    };
    const readFile = (p: string) => {
      const rel = this.rel(p);
      if (rel === null || !this.allFiles.has(rel)) return undefined;
      // Only JSON (package.json / tsconfig chains) is ever read through this host.
      if (!rel.endsWith(".json")) return undefined;
      try {
        const buf = readFileSync(path.join(this.root, rel));
        return buf.length > MAX_CONFIG_BYTES ? undefined : buf.toString("utf8");
      } catch {
        return undefined;
      }
    };
    this.host = {
      fileExists,
      readFile,
      directoryExists: (p) => {
        const rel = this.rel(p);
        return rel !== null && this.dirs.has(rel);
      },
      realpath: (p) => p,
      getCurrentDirectory: () => this.root,
      getDirectories: () => [],
    };
    this.parseHost = {
      useCaseSensitiveFileNames: true,
      readDirectory: () => [],
      fileExists,
      readFile,
    };
  }

  setWorkspaces(map: Map<string, string>, withExports: Set<string>) {
    this.workspaces = map;
    this.workspacesWithExports = withExports;
  }

  addAlias(prefix: string, dir: string, source: string) {
    this.aliases.push({ prefix, dir, source });
    this.aliases.sort((a, b) => b.dir.length - a.dir.length);
  }

  private resolvePathBased(fromRel: string, targetRel: string, cfg: ConfigEntry): ts.ResolvedModuleFull | undefined {
    const abs = path.join(this.root, targetRel);
    return ts.resolveModuleName(abs, path.join(this.root, fromRel), cfg.options, this.host, cfg.cache).resolvedModule;
  }

  /** posix path relative to root, or null if outside it */
  private rel(abs: string): string | null {
    const r = toPosix(path.relative(this.root, abs));
    if (r === "") return ".";
    if (r.startsWith("..") || path.isAbsolute(r)) return null;
    return r;
  }

  private configFor(relDir: string): ConfigEntry {
    const cached = this.configByDir.get(relDir);
    if (cached) return cached;
    let entry: ConfigEntry | undefined;
    for (const name of ["tsconfig.json", "jsconfig.json"]) {
      const cand = relDir === "." ? name : `${relDir}/${name}`;
      if (this.allFiles.has(cand)) {
        entry = this.loadConfig(cand);
        break;
      }
    }
    if (!entry) {
      entry = relDir === "." ? this.defaultConfig() : this.configFor(path.posix.dirname(relDir));
    }
    this.configByDir.set(relDir, entry);
    return entry;
  }

  private defaultConfig(): ConfigEntry {
    const options = this.normalise({});
    return { options, cache: ts.createModuleResolutionCache(this.root, (s) => s, options), aliasPatterns: [], configPath: null };
  }

  private loadConfig(rel: string): ConfigEntry {
    const abs = path.join(this.root, rel);
    const raw = ts.readConfigFile(abs, (p) => this.parseHost.readFile(p));
    let options: ts.CompilerOptions = {};
    if (!raw.error && raw.config) {
      // Errors (e.g. `extends` pointing at an uninstalled package) still yield
      // whatever options could be read; resolution then reports its own reasons.
      const parsed = ts.parseJsonConfigFileContent(raw.config, this.parseHost, path.dirname(abs), undefined, abs);
      options = parsed.options;
    }
    options = this.normalise(options);
    return {
      options,
      cache: ts.createModuleResolutionCache(path.dirname(abs), (s) => s, options),
      aliasPatterns: Object.keys(options.paths ?? {}),
      configPath: rel,
    };
  }

  private normalise(o: ts.CompilerOptions): ts.CompilerOptions {
    return {
      baseUrl: o.baseUrl,
      paths: o.paths,
      pathsBasePath: (o as { pathsBasePath?: string }).pathsBasePath,
      rootDirs: o.rootDirs,
      allowJs: true,
      resolveJsonModule: true,
      allowArbitraryExtensions: false,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      module: ts.ModuleKind.ESNext,
      noDtsResolution: false,
    } as ts.CompilerOptions;
  }

  resolve(fromRel: string, specifier: string): Resolution {
    if (specifier.startsWith("node:")) return { status: "external", pkg: specifier };
    const fromDir = path.posix.dirname(fromRel);
    const cfg = this.configFor(fromDir);
    const containing = path.join(this.root, fromRel);
    let res = ts.resolveModuleName(specifier, containing, cfg.options, this.host, cfg.cache).resolvedModule;
    let via: string | null = null;
    const isBare = !specifier.startsWith(".") && !specifier.startsWith("/");
    if (!res && isBare) {
      const alias = this.aliases.find((a) => specifier.startsWith(a.prefix) && (fromDir === a.dir || a.dir === "." || fromDir.startsWith(a.dir + "/")));
      const pkg = packageName(specifier);
      const wsDir = this.workspaces.get(pkg);
      if (alias) {
        via = alias.source;
        const target = path.posix.join(alias.dir, specifier.slice(alias.prefix.length));
        res = this.resolvePathBased(fromRel, target, cfg);
        if (!res && this.allFiles.has(target)) return { status: "skipped", to: target, reason: `non-code asset (${path.posix.extname(target) || "no extension"})` };
        if (!res) return { status: "failed", reason: `${alias.source} alias "${alias.prefix}" matched but no file was found` };
      } else if (wsDir !== undefined) {
        via = `workspace package ${pkg} (${wsDir})`;
        const target = path.posix.join(wsDir, specifier.slice(pkg.length));
        res = this.resolvePathBased(fromRel, target, cfg);
        if (!res && this.allFiles.has(target)) return { status: "skipped", to: target, reason: `non-code asset (${path.posix.extname(target) || "no extension"})` };
        if (!res) {
          const why = this.workspacesWithExports.has(pkg)
            ? "its package.json exports point at build output (not in the source)"
            : "no source file matches that path";
          return { status: "failed", reason: `${via} exists but "${specifier}" did not resolve: ${why}` };
        }
      }
    }
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../") || specifier === "." || specifier === "..";

    if (res) {
      const target = this.rel(res.resolvedFileName);
      if (target === null) return { status: "failed", reason: "resolved outside the repository" };
      if (res.isExternalLibraryImport && !via) return { status: "external", pkg: packageName(specifier) };
      if (isDeclarationFile(target)) return { status: "skipped", to: target, reason: `resolves to a type declaration file (${target})` };
      if (isCodeFile(target)) return { status: "resolved", to: target };
      return { status: "skipped", to: target, reason: `non-code file (${path.posix.extname(target) || "no extension"})` };
    }

    if (specifier.startsWith("/")) {
      return { status: "failed", reason: "absolute path import; no file inside the repository matches" };
    }
    if (isRelative) {
      const joined = path.posix.normalize(path.posix.join(fromDir, specifier));
      if (joined.startsWith("..")) return { status: "failed", reason: `points outside the repository (${joined})` };
      if (this.allFiles.has(joined)) {
        const ext = path.posix.extname(joined) || "no extension";
        return { status: "skipped", to: joined, reason: `non-code asset (${ext})` };
      }
      return { status: "failed", reason: `no file found at ${joined} (tried TypeScript/JavaScript extensions and index files)` };
    }
    const alias = cfg.aliasPatterns.find((p) => matchesPattern(p, specifier));
    if (alias) {
      return {
        status: "failed",
        reason: `matches path alias "${alias}" from ${cfg.configPath ?? "tsconfig"} but no file was found`,
      };
    }
    if (cfg.options.baseUrl) {
      const fromBase = toPosix(path.relative(this.root, path.join(cfg.options.baseUrl, specifier)));
      if (this.allFiles.has(fromBase)) {
        return { status: "skipped", to: fromBase, reason: `non-code asset (${path.posix.extname(fromBase) || "no extension"})` };
      }
    }
    return { status: "external", pkg: packageName(specifier) };
  }
}

function matchesPattern(pattern: string, spec: string): boolean {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === spec;
  return spec.startsWith(pattern.slice(0, star)) && spec.endsWith(pattern.slice(star + 1));
}

export function packageName(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") && parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0];
}
