import path from "node:path";
import { parse as parseToml } from "smol-toml";
import type { RepoView } from "cartograph-lang-api";

/** A folder on the import path, and the config line that put it there. */
export interface Root {
  dir: string;
  source: string;
}

/** One Python project: a folder with pyproject.toml, setup.cfg or setup.py. */
export interface Project {
  dir: string;
  /** the config file that declares it (pyproject.toml, setup.cfg or setup.py) */
  file: string;
  /** normalised distribution name, if declared */
  name: string | null;
  roots: Root[];
  /** normalised names of everything it depends on (any dependency list) */
  deps: Set<string>;
  /** uv workspace member globs, relative to this project's folder */
  workspaceMembers: string[];
  /** `[project.scripts]` targets, "pkg.mod:func" */
  scripts: string[];
  /** pytest settings found in this folder */
  pytest: PytestConfig | null;
}

export interface PytestConfig {
  dir: string;
  file: string;
  /** `pythonpath` entries, relative to the repo root */
  pythonpath: string[];
  /** `--import-mode=importlib` or `append` turns off pytest's rootdir insertion */
  importMode: "prepend" | "append" | "importlib";
}

type Table = Record<string, unknown>;

export const normaliseName = (s: string) => s.toLowerCase().replace(/[-_.]+/g, "-");

const join = (dir: string, rel: string) => {
  const j = path.posix.normalize(path.posix.join(dir, rel)).replace(/\/$/, "");
  return j === "" ? "." : j;
};
const tbl = (v: unknown): Table | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Table) : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : []);
const get = (t: Table | null, ...keys: string[]): unknown => keys.reduce<unknown>((cur, k) => tbl(cur)?.[k], t);
/** "requests[socks]>=2" -> "requests" */
const depName = (spec: string) => normaliseName(spec.trim().split(/[\s<>=!~;[(@]/)[0] ?? "");

export function findProjects(repo: RepoView): { projects: Project[]; problems: string[] } {
  const problems: string[] = [];
  const dirs = new Set<string>();
  for (const f of repo.files) {
    const base = path.posix.basename(f);
    if (base === "pyproject.toml" || base === "setup.cfg" || base === "setup.py") dirs.add(path.posix.dirname(f));
  }
  const projects: Project[] = [];
  for (const dir of [...dirs].sort()) {
    const at = (n: string) => (dir === "." ? n : `${dir}/${n}`);
    let py: Table | null = null;
    if (repo.files.has(at("pyproject.toml"))) {
      const text = repo.readText(at("pyproject.toml"));
      if (text === null) problems.push(`${at("pyproject.toml")}: too large or unreadable`);
      else {
        try {
          py = parseToml(text) as Table;
        } catch (e) {
          problems.push(`${at("pyproject.toml")}: not valid TOML (${(e as Error).message.split("\n")[0]})`);
        }
      }
    }
    const cfg = repo.files.has(at("setup.cfg")) ? parseIni(repo.readText(at("setup.cfg")) ?? "") : null;
    const hasSetupPy = repo.files.has(at("setup.py"));
    const p = project(repo, dir, py, cfg, hasSetupPy);
    p.pytest = pytestConfig(repo, dir, py, cfg);
    // a pyproject.toml that only configures tools (ruff, black...) is not a package
    if (p.roots.length || p.pytest || p.workspaceMembers.length) projects.push(p);
  }
  return { projects, problems };
}

function project(repo: RepoView, dir: string, py: Table | null, cfg: Ini | null, hasSetupPy: boolean): Project {
  const roots: Root[] = [];
  const add = (rel: string, source: string) => {
    const d = join(dir, rel);
    if (!roots.some((r) => r.dir === d)) roots.push({ dir: d, source });
  };
  const file = dir === "." ? "pyproject.toml" : `${dir}/pyproject.toml`;
  const cfgFile = dir === "." ? "setup.cfg" : `${dir}/setup.cfg`;
  const backend = String(get(py, "build-system", "build-backend") ?? "");

  // Explicit declarations, per build backend.
  const pkgDir = tbl(get(py, "tool", "setuptools", "package-dir"));
  if (pkgDir && typeof pkgDir[""] === "string") add(pkgDir[""] as string, `${file} [tool.setuptools] package-dir`);
  for (const w of strs(get(py, "tool", "setuptools", "packages", "find", "where"))) add(w, `${file} [tool.setuptools.packages.find] where`);
  for (const p of strs(get(py, "tool", "hatch", "build", "targets", "wheel", "packages"))) add(path.posix.dirname(p), `${file} [tool.hatch.build.targets.wheel] packages`);
  const hatchSources = get(py, "tool", "hatch", "build", "targets", "wheel", "sources");
  for (const s of Array.isArray(hatchSources) ? strs(hatchSources) : Object.keys(tbl(hatchSources) ?? {})) add(s, `${file} [tool.hatch.build.targets.wheel] sources`);
  const poetry = get(py, "tool", "poetry", "packages");
  if (Array.isArray(poetry)) for (const e of poetry) if (tbl(e)?.include) add(typeof tbl(e)!.from === "string" ? (tbl(e)!.from as string) : ".", `${file} [tool.poetry] packages`);
  const pdm = get(py, "tool", "pdm", "build", "package-dir");
  if (typeof pdm === "string") add(pdm, `${file} [tool.pdm.build] package-dir`);
  if (backend.startsWith("uv_build")) {
    const mr = get(py, "tool", "uv", "build-backend", "module-root");
    add(typeof mr === "string" ? mr : "src", typeof mr === "string" ? `${file} [tool.uv.build-backend] module-root` : `${file} uv_build (default module-root "src")`);
  }
  const cfgPkgDir = cfg?.get("options")?.get("package_dir");
  if (cfgPkgDir) {
    const m = /(?:^|\n)\s*=\s*(\S+)/.exec(cfgPkgDir) ?? /^=\s*(\S+)/.exec(cfgPkgDir.trim());
    if (m) add(m[1], `${cfgFile} [options] package_dir`);
  }
  const cfgWhere = cfg?.get("options.packages.find")?.get("where");
  if (cfgWhere) for (const w of cfgWhere.split(/\s+/).filter(Boolean)) add(w, `${cfgFile} [options.packages.find] where`);

  // Nothing explicit: the backend's own discovery rule (setuptools, hatchling,
  // flit and poetry all use src/ when it exists, else the project folder).
  const isPackage = !!get(py, "project") || !!get(py, "tool", "poetry") || !!get(py, "build-system") || cfg !== null || hasSetupPy;
  if (roots.length === 0 && isPackage) {
    const how = backend ? backend.split(/[.:]/)[0] : "setuptools";
    const src = dir === "." ? "src" : `${dir}/src`;
    const srcHasCode = [...repo.files].some((f) => f.startsWith(src + "/") && f.endsWith(".py"));
    const declared = py ? file : cfg ? cfgFile : `${dir === "." ? "" : dir + "/"}setup.py`;
    if (srcHasCode) add("src", `${declared} (${how} discovery: src layout)`);
    else add(".", `${declared} (${how} discovery: flat layout)`);
  }

  const deps = new Set<string>();
  for (const d of strs(get(py, "project", "dependencies"))) deps.add(depName(d));
  for (const list of Object.values(tbl(get(py, "project", "optional-dependencies")) ?? {})) for (const d of strs(list)) deps.add(depName(d));
  for (const list of Object.values(tbl(get(py, "dependency-groups")) ?? {})) for (const d of strs(list)) deps.add(depName(d));
  for (const d of strs(get(py, "tool", "uv", "dev-dependencies"))) deps.add(depName(d));
  for (const k of Object.keys(tbl(get(py, "tool", "poetry", "dependencies")) ?? {})) deps.add(normaliseName(k));
  for (const g of Object.values(tbl(get(py, "tool", "poetry", "group")) ?? {})) for (const k of Object.keys(tbl(tbl(g)?.dependencies) ?? {})) deps.add(normaliseName(k));
  const cfgReq = cfg?.get("options")?.get("install_requires");
  if (cfgReq) for (const line of cfgReq.split("\n")) if (line.trim()) deps.add(depName(line));
  for (const k of Object.keys(tbl(get(py, "tool", "uv", "sources")) ?? {})) deps.add(normaliseName(k));

  const name = get(py, "project", "name") ?? get(py, "tool", "poetry", "name") ?? cfg?.get("metadata")?.get("name");
  const scripts = Object.values(tbl(get(py, "project", "scripts")) ?? {}).filter((v): v is string => typeof v === "string");
  for (const v of Object.values(tbl(get(py, "tool", "poetry", "scripts")) ?? {})) if (typeof v === "string") scripts.push(v);
  return {
    dir,
    file: py ? file : cfg ? cfgFile : `${dir === "." ? "" : dir + "/"}setup.py`,
    name: typeof name === "string" ? normaliseName(name) : null,
    roots,
    deps,
    workspaceMembers: strs(get(py, "tool", "uv", "workspace", "members")),
    scripts,
    pytest: null,
  };
}

function pytestConfig(repo: RepoView, dir: string, py: Table | null, cfg: Ini | null): PytestConfig | null {
  const at = (n: string) => (dir === "." ? n : `${dir}/${n}`);
  const fromIni = (file: string, section: string) => {
    const ini = parseIni(repo.readText(file) ?? "");
    return ini.get(section) ?? null;
  };
  // pytest's own precedence: pytest.ini, pyproject.toml, tox.ini, setup.cfg
  let file: string | null = null;
  let pythonpath: string[] = [];
  let addopts = "";
  if (repo.files.has(at("pytest.ini"))) {
    const s = fromIni(at("pytest.ini"), "pytest");
    if (s) {
      file = at("pytest.ini");
      pythonpath = (s.get("pythonpath") ?? "").split(/\s+/).filter(Boolean);
      addopts = s.get("addopts") ?? "";
    }
  }
  const ini = tbl(get(py, "tool", "pytest", "ini_options"));
  if (!file && ini) {
    file = at("pyproject.toml");
    pythonpath = strs(ini.pythonpath);
    addopts = strs(ini.addopts).join(" ");
  }
  if (!file && repo.files.has(at("tox.ini"))) {
    const s = fromIni(at("tox.ini"), "pytest");
    if (s) {
      file = at("tox.ini");
      pythonpath = (s.get("pythonpath") ?? "").split(/\s+/).filter(Boolean);
      addopts = s.get("addopts") ?? "";
    }
  }
  const cfgPytest = cfg?.get("tool:pytest");
  if (!file && cfgPytest) {
    file = at("setup.cfg");
    pythonpath = (cfgPytest.get("pythonpath") ?? "").split(/\s+/).filter(Boolean);
    addopts = cfgPytest.get("addopts") ?? "";
  }
  if (!file) return null;
  const mode = /--import-mode[= ](prepend|append|importlib)/.exec(addopts)?.[1] as PytestConfig["importMode"] | undefined;
  return { dir, file, pythonpath: pythonpath.map((p) => join(dir, p)), importMode: mode ?? "prepend" };
}

type Ini = Map<string, Map<string, string>>;

/** Enough of configparser for setup.cfg / tox.ini / pytest.ini: sections, keys, indented continuation lines. */
export function parseIni(text: string): Ini {
  const out: Ini = new Map();
  let section: Map<string, string> | null = null;
  let key: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*[#;]/.test(raw) || raw.trim() === "") continue;
    const sec = /^\[([^\]]+)\]\s*$/.exec(raw);
    if (sec) {
      section = new Map();
      out.set(sec[1].trim(), section);
      key = null;
      continue;
    }
    if (!section) continue;
    if (/^\s/.test(raw) && key) {
      section.set(key, `${section.get(key)}\n${raw.trim()}`);
      continue;
    }
    const kv = /^([^=:]+?)\s*[=:]\s*(.*)$/.exec(raw);
    if (kv) {
      key = kv[1].trim();
      section.set(key, kv[2].trim());
    }
  }
  return out;
}

/** uv workspace member globs: `*` matches one folder name. */
export function matchesMember(projectDir: string, workspaceDir: string, glob: string): boolean {
  const pattern = join(workspaceDir, glob);
  const re = new RegExp(`^${pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]+")}$`);
  return re.test(projectDir);
}
