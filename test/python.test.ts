import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pythonPlugin } from "cartograph-lang-python";
import { parseRepo, type ParseResult } from "@/parser";
import { typescriptPlugin } from "@/parser/languages/typescript";

const fx = (n: string) => path.join(__dirname, "fixtures", "python", n);
const parse = (dir: string) => parseRepo(dir, { languages: [typescriptPlugin, pythonPlugin] });
const edges = (r: ParseResult) => r.edges.map((e) => `${e.from} -> ${e.to}`);
const rec = (r: ParseResult, spec: string) => r.unresolved.find((u) => u.specifier === spec);

/** a throwaway repo from {path: contents} */
function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "carto-py-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

describe("python: flat layout (setuptools discovery)", async () => {
  const r = await parse(fx("flat"));

  it("tags files as python and skips type stubs with a reason", () => {
    expect(r.files.every((f) => f.language === "python")).toBe(true);
    expect(r.skipped).toEqual([{ path: "flatpkg/typed.pyi", reason: expect.stringContaining("type stub") }]);
  });

  it("resolves relative, absolute and from-imports of submodules", () => {
    expect(edges(r)).toEqual([
      "cli.py -> flatpkg/__init__.py",
      "flatpkg/__init__.py -> flatpkg/core.py",
      "flatpkg/core.py -> flatpkg/__init__.py",
      "flatpkg/core.py -> flatpkg/util.py",
      "tests/test_core.py -> flatpkg/core.py",
      "tests/test_core.py -> tests/helpers.py",
    ]);
  });

  it("classifies stdlib and third-party as external", () => {
    expect(rec(r, "os")).toMatchObject({ status: "external", pkg: "os" });
    expect(rec(r, "requests")).toMatchObject({ status: "external", pkg: "requests" });
    expect(rec(r, "from __future__ import annotations")).toMatchObject({ status: "external", pkg: "__future__" });
  });

  it("explains every import it cannot link", () => {
    expect(rec(r, "flatpkg.nope")).toMatchObject({ status: "failed", reason: expect.stringContaining("flatpkg is in the repository") });
    expect(rec(r, "from ... import too_far")).toMatchObject({ status: "failed", reason: expect.stringContaining("above the repository root") });
    expect(rec(r, "from .typed import Shape")).toMatchObject({ status: "skipped", to: "flatpkg/typed.pyi" });
    expect(rec(r, 'importlib.import_module("flatpkg.util")')).toMatchObject({ status: "skipped", reason: expect.stringContaining("runtime import") });
    expect(rec(r, "importlib.import_module(name)")).toMatchObject({ status: "skipped", reason: expect.stringContaining("computed specifier") });
    for (const u of r.unresolved) if (u.status !== "external") expect(u.reason).toBeTruthy();
  });

  it("marks scripts and tests as entry points", () => {
    expect(r.files.find((f) => f.path === "cli.py")).toMatchObject({ roles: ["main-script"], entry: true });
    expect(r.files.find((f) => f.path === "tests/test_core.py")).toMatchObject({ roles: ["test"], entry: true });
    expect(r.framework.roles).toMatchObject({ "main-script": "Run as scripts", test: "Tests" });
  });
});

describe("python: src layout (uv_build, pytest, namespace packages)", async () => {
  const r = await parse(fx("srclayout"));

  it("uses uv_build's default module root and pytest's rootdir insertion", () => {
    expect(edges(r)).toEqual(["src/app/main.py -> src/app/plugins/a.py", "tests/test_main.py -> src/app/main.py", "tests/test_main.py -> tests/conftest.py"]);
  });

  it("never links to a namespace package folder", () => {
    expect(rec(r, "app.plugins")).toMatchObject({ status: "skipped", reason: expect.stringContaining("namespace package") });
    expect(rec(r, "from app.plugins import missing")).toMatchObject({ status: "failed", reason: expect.stringContaining("no module named missing") });
  });

  it("lists sys.path changes, and does not guess the imports they enable", () => {
    expect(rec(r, 'sys.path.insert(0, "scripts")')).toMatchObject({ status: "skipped", reason: expect.stringContaining("changes sys.path") });
    expect(rec(r, "helper")).toMatchObject({ status: "failed", reason: expect.stringContaining("matches scripts/helper.py only if scripts/ is on sys.path") });
  });

  it("marks [project.scripts] targets as package entry points", () => {
    expect(r.files.find((f) => f.path === "src/app/main.py")).toMatchObject({ roles: ["package-entry"], entry: true });
  });
});

describe("python: several packages in one repo", async () => {
  const r = await parse(fx("multi"));

  it("links packages only through a declared dependency or a uv workspace", () => {
    expect(edges(r)).toEqual([
      "packages/api/acme_api/server.py -> packages/api/acme_api/routes.py",
      "packages/api/acme_api/server.py -> packages/core/src/acme_core/__init__.py",
      "packages/cli/lib/acme_cli/main.py -> packages/api/acme_api/server.py",
      "packages/cli/lib/acme_cli/main.py -> packages/core/src/acme_core/__init__.py",
    ]);
  });

  it("says why an unlinked project cannot see another project's package", () => {
    expect(rec(r, "acme_core")).toMatchObject({
      from: "tools/standalone/standalone.py",
      status: "failed",
      reason: expect.stringContaining("does not list it as a dependency or share a uv workspace"),
    });
  });
});

describe("python: syntax details", () => {
  it("imports under `if TYPE_CHECKING:` are type-only; the else branch is not", async () => {
    const dir = repo({
      "pyproject.toml": '[project]\nname = "p"\n',
      "p/__init__.py": "",
      "p/a.py": "from typing import TYPE_CHECKING\nif TYPE_CHECKING:\n    from p import b\nelse:\n    from p import c\n",
      "p/b.py": "",
      "p/c.py": "",
    });
    const r = await parse(dir);
    expect(r.edges.find((e) => e.to === "p/b.py")?.typeOnly).toBe(true);
    expect(r.edges.find((e) => e.to === "p/c.py")?.typeOnly).toBe(false);
  });

  it("with no packaging config, absolute imports are not guessed from file names", async () => {
    const dir = repo({ "main.py": "import util\nfrom . import util as u2\n", "util.py": "" });
    const r = await parse(dir);
    expect(rec(r, "util")).toMatchObject({ status: "failed", reason: expect.stringContaining("only if the repo root is on sys.path") });
    expect(edges(r)).toEqual(["main.py -> util.py"]); // the relative import is real
  });

  it("a module named like a package it imports is not importing itself", async () => {
    const dir = repo({ "pyproject.toml": '[project]\nname = "p"\n', "p/__init__.py": "", "p/backends/jinja2.py": "import jinja2\n" });
    const r = await parse(dir);
    expect(rec(r, "jinja2")).toMatchObject({ status: "external", pkg: "jinja2" });
  });

  it("reads setup.cfg package_dir and pytest's importlib mode", async () => {
    const dir = repo({
      "setup.cfg": "[metadata]\nname = q\n\n[options]\npackage_dir =\n    =lib\n\n[tool:pytest]\naddopts = --import-mode=importlib\n",
      "lib/q/__init__.py": "",
      "tests/helpers.py": "",
      "tests/test_q.py": "import q\nimport helpers\n",
    });
    const r = await parse(dir);
    expect(edges(r)).toEqual(["tests/test_q.py -> lib/q/__init__.py"]);
    expect(rec(r, "helpers")?.status).toBe("failed");
  });
});

describe("python frameworks: FastAPI", async () => {
  const r = await parse(fx("fastapi"));

  it("is detected from a declared dependency (requirements.txt counts)", () => {
    expect(r.framework).toMatchObject({ id: "fastapi", evidence: "requirements.txt depends on fastapi", supportsRoutes: true });
  });

  it("shows a route only when every prefix from the app down is a plain string", () => {
    expect(r.framework.routes.map((x) => `${x.method} ${x.path}`)).toEqual([
      "GET /api/items/", // FastAPI concatenates: "/api" + "/items" + "/"
      "GET /api/items/{item_id}",
      "POST /api/items/{item_id}",
      "GET /health",
    ]);
    expect(r.framework.routes.find((x) => x.path === "/health")).toMatchObject({ file: "app/main.py", line: 11 });
  });

  it("only counts FastAPI/APIRouter imported from fastapi", () => {
    expect(r.files.find((f) => f.path === "app/fake.py")?.roles).toEqual([]);
    expect(r.files.find((f) => f.path === "app/main.py")).toMatchObject({ roles: ["fastapi-app", "endpoints"], entry: true });
  });
});

describe("python frameworks: Flask", async () => {
  const r = await parse(fx("flask"));

  it("follows blueprints from an app factory, with Flask's prefix rules and GET by default", () => {
    expect(r.framework.id).toBe("flask");
    expect(r.framework.routes.map((x) => `${x.method} ${x.path}`)).toEqual([
      "GET /",
      "GET /auth/login",
      "POST /auth/login",
      "POST /auth/logout",
      "GET /staff/dashboard", // register_blueprint(url_prefix=) replaces the blueprint's own
    ]);
  });

  it("drops every route when an app may be mounted under another prefix", async () => {
    const dir = repo({
      "pyproject.toml": '[project]\nname = "m"\ndependencies = ["flask"]\n',
      "m/__init__.py": 'from flask import Flask\nfrom werkzeug.middleware.dispatcher import DispatcherMiddleware\napp = Flask(__name__)\n@app.route("/x")\ndef x():\n    return 1\napplication = DispatcherMiddleware(app, {})\n',
    });
    const m = await parse(dir);
    expect(m.framework.id).toBe("flask");
    expect(m.framework.routes).toEqual([]);
  });
});

describe("python frameworks: Django", async () => {
  const r = await parse(fx("django"));

  it("gives roles to the files Django loads by name, and shows no routes (path() names no method)", () => {
    expect(r.framework).toMatchObject({ id: "django", supportsRoutes: false, routes: [] });
    const roles = Object.fromEntries(r.files.filter((f) => f.roles.length).map((f) => [f.path, f.roles]));
    expect(roles).toMatchObject({
      "manage.py": expect.arrayContaining(["django-entry", "main-script"]),
      "site_cfg/settings.py": ["django-settings"],
      "site_cfg/urls.py": ["url-config"],
      "site_cfg/wsgi.py": ["django-entry"],
      "blog/models.py": ["models"],
      "blog/admin.py": ["admin"],
      "blog/apps.py": ["app-config"],
      "blog/migrations/0001_initial.py": ["migration"],
      "blog/management/commands/publish.py": ["management-command"],
      "blog/templatetags/blog_tags.py": ["template-tags"],
    });
    expect(r.files.find((f) => f.path === "blog/migrations/0001_initial.py")?.entry).toBe(true);
    expect(r.files.find((f) => f.path === "blog/views.py")?.entry).toBe(false);
  });
});
