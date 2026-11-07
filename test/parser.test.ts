import { mkdtempSync, symlinkSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseRepo, type ParseResult } from "@/parser";
import { buildIndex, findCycles, insights, reach } from "@/graph";

const fx = (n: string) => path.join(__dirname, "fixtures", n);
const edge = (r: ParseResult, from: string, to: string) => r.edges.find((e) => e.from === from && e.to === to);
const rec = (r: ParseResult, spec: string) => r.unresolved.find((u) => u.specifier === spec);

describe("parser: ESM", async () => {
  const r = await parseRepo(fx("esm"));

  it("accounts for every file: found = parsed + skipped", () => {
    expect(r.stats.filesFound).toBe(r.stats.filesParsed + r.stats.filesSkipped);
    expect(r.skipped).toEqual([{ path: "src/global.d.ts", reason: expect.stringContaining("type declaration") }]);
  });

  it("resolves index files, .js -> .ts, aliases, re-exports, literal dynamic imports", () => {
    expect(edge(r, "src/index.ts", "src/lib/index.ts")?.kinds).toEqual(["import"]);
    expect(edge(r, "src/index.ts", "src/lib/b.ts")).toBeTruthy();
    expect(edge(r, "src/index.ts", "src/util/types.ts")?.typeOnly).toBe(true);
    expect(edge(r, "src/index.ts", "src/lib/c.ts")?.kinds).toEqual(["reexport"]);
    expect(edge(r, "src/index.ts", "src/ui/button.tsx")?.kinds).toEqual(["reexport"]);
    expect(edge(r, "src/index.ts", "src/util/lazy.ts")?.kinds).toEqual(["dynamic"]);
  });

  it("classifies every non-edge import with a reason", () => {
    expect(rec(r, "zod")).toMatchObject({ status: "external", pkg: "zod" });
    expect(rec(r, "node:fs")).toMatchObject({ status: "external" });
    expect(rec(r, "./styles.css")).toMatchObject({ status: "skipped", reason: "non-code asset (.css)" });
    expect(rec(r, "./does-not-exist")).toMatchObject({ status: "failed", reason: expect.stringContaining("no file found at src/does-not-exist") });
    expect(rec(r, "#missing/x")).toMatchObject({ status: "failed", reason: expect.stringContaining('path alias "#missing/*"') });
    const computed = r.unresolved.find((u) => u.kind === "dynamic" && u.status === "skipped");
    expect(computed?.reason).toContain("computed specifier");
    for (const u of r.unresolved) if (u.status !== "external") expect(u.reason).toBeTruthy();
    const s = r.stats.imports;
    const total = r.edges.length; // sanity: there are edges
    expect(total).toBeGreaterThan(0);
    expect(s.resolved + s.external + s.skipped + s.failed).toBe(
      r.unresolved.length + s.resolved,
    );
  });

  it("never draws an edge to a file it did not resolve", () => {
    const paths = new Set(r.files.map((f) => f.path));
    for (const e of r.edges) {
      expect(paths.has(e.from)).toBe(true);
      expect(paths.has(e.to)).toBe(true);
    }
  });

  it("counts fan-in/out and marks entries", () => {
    const lib = r.files.find((f) => f.path === "src/lib/b.ts")!;
    expect(lib.fanIn).toBeGreaterThanOrEqual(2);
    expect(r.files.find((f) => f.path === "src/index.ts")!.roles).toContain("package-entry");
    expect(r.files.find((f) => f.path === "src/lib/a.test.ts")!.entry).toBe(true);
  });

  it("finds the b <-> c cycle and lists files nothing imports (not 'unused')", () => {
    const idx = buildIndex(r);
    expect(findCycles(idx)).toEqual([["src/lib/b.ts", "src/lib/c.ts"]]);
    const ins = insights(idx);
    expect(ins.notImported).toEqual(["src/util/orphan.ts"]);
    expect(JSON.stringify(ins)).not.toMatch(/unused/i);
  });

  it("groups blast radius by distance", () => {
    const idx = buildIndex(r);
    const br = reach(idx, "src/lib/c.ts", "dependents");
    expect(br.oneStep).toEqual(["src/index.ts", "src/lib/b.ts"]);
    expect(br.twoSteps).toEqual(["src/lib/index.ts"]);
    const chain = reach(idx, "src/lib/index.ts", "dependencies");
    expect(chain.oneStep).toEqual(["src/lib/b.ts"]);
    expect(chain.twoSteps).toEqual(["src/lib/c.ts"]);
  });

  it("is deterministic", async () => {
    const again = await parseRepo(fx("esm"));
    expect(again).toEqual(r);
  });
});

describe("parser: CommonJS + Express", async () => {
  const r = await parseRepo(fx("cjs"));
  it("turns literal require() into edges and keeps computed ones with a reason", () => {
    expect(edge(r, "src/index.js", "src/routes/index.js")?.kinds).toEqual(["require"]);
    expect(edge(r, "src/routes/index.js", "src/controllers/user.controller.js")).toBeTruthy();
    expect(r.unresolved.find((u) => u.kind === "require" && u.status === "skipped")?.reason).toContain("computed");
  });
  it("ignores require.resolve (not an import)", () => {
    expect(rec(r, "./x")).toBeUndefined();
  });
  it("detects Express with folder roles and no routes", () => {
    expect(r.framework.id).toBe("express");
    expect(r.framework.routes).toEqual([]);
    expect(r.files.find((f) => f.path === "src/services/user.service.js")!.roles).toContain("service");
  });
  it("ESM fixture contains no require edges (regression guard for CJS support)", async () => {
    const esm = await parseRepo(fx("esm"));
    expect(esm.edges.some((e) => e.kinds.includes("require"))).toBe(false);
  });
});

describe("adapters", () => {
  it("Next.js: roles and only routes with a readable method", async () => {
    const r = await parseRepo(fx("next"));
    expect(r.framework.id).toBe("nextjs");
    expect(r.framework.routes.map((x) => `${x.method} ${x.path}`)).toEqual(["GET /api/users/[id]", "POST /api/users/[id]"]);
    const roles = (p: string) => r.files.find((f) => f.path === p)!.roles;
    expect(roles("app/(marketing)/about/page.tsx")).toContain("page");
    expect(roles("pages/api/legacy.ts")).toContain("api-route");
    expect(roles("app/actions.ts")).toContain("server-action");
    expect(roles("proxy.ts")).toContain("middleware");
  });
  it("Nest.js: literal decorator paths with global prefix; unreadable paths omitted", async () => {
    const r = await parseRepo(fx("nest"));
    expect(r.framework.id).toBe("nestjs");
    expect(r.framework.routes.map((x) => `${x.method} ${x.path}`)).toEqual(["GET /api/cats", "GET /api/cats/:id", "POST /api/cats/bulk"]);
  });
});

describe("parser: untrusted input", () => {
  it("does not follow symlinks out of the repo", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "carto-"));
    cpSync(fx("esm"), dir, { recursive: true });
    const outside = mkdtempSync(path.join(tmpdir(), "carto-out-"));
    writeFileSync(path.join(outside, "secret.ts"), "export const s = 1;");
    symlinkSync(outside, path.join(dir, "src", "linked"));
    symlinkSync(path.join(outside, "secret.ts"), path.join(dir, "src", "secret.ts"));
    const r = await parseRepo(dir);
    expect(r.files.some((f) => f.path.includes("secret") || f.path.includes("linked"))).toBe(false);
  });
  it("refuses tsconfig extends outside the root", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "carto-"));
    mkdirSync(path.join(dir, "src"));
    writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ extends: "/etc/passwd" }));
    writeFileSync(path.join(dir, "src", "a.ts"), 'import "./b";');
    writeFileSync(path.join(dir, "src", "b.ts"), "");
    const r = await parseRepo(dir);
    expect(r.edges).toHaveLength(1);
  });
});

import { parseRepoUrl } from "@/lib/repo-url";
describe("repo URLs", () => {
  it.each([
    ["https://github.com/vercel/next.js", { owner: "vercel", name: "next.js", ref: null }],
    ["github.com/vercel/next.js.git", { owner: "vercel", name: "next.js", ref: null }],
    ["vercel/next.js", { owner: "vercel", name: "next.js", ref: null }],
    ["https://github.com/a/b/tree/canary", { owner: "a", name: "b", ref: "canary" }],
    ["https://github.com/a/b/", { owner: "a", name: "b", ref: null }],
  ])("accepts %s", (url, want) => expect(parseRepoUrl(url)).toEqual(want));
  it.each(["https://gitlab.com/a/b", "https://evil.com/github.com/a/b", "a", "a/../b", "-a/b", "https://github.com/a/b/blob/main/x.ts", "a/b c"])(
    "rejects %s",
    (url) => expect(parseRepoUrl(url)).toBeNull(),
  );
});

describe("parser: placeholders", () => {
  it("reports placeholder files at their real size as skipped", async () => {
    const r = await parseRepo(fx("esm"), { sizeOverrides: new Map([["src/util/orphan.ts", 5_000_000]]) });
    expect(r.skipped.find((s) => s.path === "src/util/orphan.ts")?.reason).toContain("larger than 1 MB");
    expect(r.stats.filesFound).toBe(r.stats.filesParsed + r.stats.filesSkipped);
  });
});
