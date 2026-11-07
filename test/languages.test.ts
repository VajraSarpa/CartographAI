import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LanguagePlugin } from "cartograph-lang-api";
import { parseRepo } from "@/parser";
import { loadLanguages } from "@/parser/languages";
import { typescriptPlugin } from "@/parser/languages/typescript";
import { languagesFromEnv } from "@/lib/env";
import template from "../packages/lang-template/src/index";

const fx = path.join(__dirname, "fixtures", "lang-template");

describe("language plug-ins: the template package", async () => {
  const r = await parseRepo(fx, { languages: [template] });

  it("parses only the files it claims, and tags each with its language", () => {
    expect(r.files.map((f) => [f.path, f.language])).toEqual([
      ["lib/util.tmpl", "template"],
      ["main.tmpl", "template"],
    ]);
  });

  it("makes edges only for resolved imports and keeps a reason for the rest", () => {
    expect(r.edges.map((e) => `${e.from} -> ${e.to}`)).toEqual(["lib/util.tmpl -> main.tmpl", "main.tmpl -> lib/util.tmpl"]);
    const by = (s: string) => r.unresolved.find((u) => u.specifier === s);
    expect(by("./missing.tmpl")).toMatchObject({ status: "failed", reason: "no file found at missing.tmpl" });
    expect(by("./notes.txt")).toMatchObject({ status: "skipped", to: "notes.txt" });
    expect(by("stdlib")).toMatchObject({ status: "external", pkg: "stdlib" });
    expect(by("$dynamic")).toMatchObject({ status: "skipped", reason: expect.stringContaining("computed specifier") });
  });

  it("uses the roles and entry roles the plug-in reports", () => {
    const main = r.files.find((f) => f.path === "main.tmpl")!;
    expect(main).toMatchObject({ roles: ["entry-file"], entry: true });
    expect(r.framework.id).toBe("none");
  });
});

describe("language plug-ins: several at once", async () => {
  const r = await parseRepo(fx, { languages: [typescriptPlugin, template] });

  it("each file belongs to the first language that claims it", () => {
    expect(Object.fromEntries(r.files.map((f) => [f.path, f.language]))).toEqual({
      "helper.ts": "typescript",
      "lib/util.tmpl": "template",
      "main.tmpl": "template",
    });
    expect(r.stats.filesFound).toBe(3);
  });
});

describe("language plug-ins: the core does not trust a resolver", () => {
  it("turns a 'resolved' import of a file that is not in the repo into a failure", async () => {
    const liar: LanguagePlugin = {
      ...template,
      open: () => ({ parse: () => [{ specifier: "x", kind: "import", typeOnly: false, line: 1, literal: true }], resolve: () => ({ status: "resolved", to: "made/up.tmpl" }) }),
    };
    const r = await parseRepo(fx, { languages: [liar] });
    expect(r.edges).toEqual([]);
    expect(r.unresolved[0]).toMatchObject({ status: "failed", reason: expect.stringContaining("not in the repository (made/up.tmpl)") });
  });
});

describe("loadLanguages", () => {
  const importer = (mods: Record<string, unknown>) => async (pkg: string) => {
    if (pkg in mods) return mods[pkg];
    throw new Error(`Cannot find package '${pkg}'`);
  };

  it("loads built-ins and cartograph-lang-<id> packages, in order", async () => {
    const got = await loadLanguages(["typescript", "template"], importer({ "cartograph-lang-template": { default: template } }));
    expect(got.map((l) => l.id)).toEqual(["typescript", "template"]);
  });

  it("fails loudly, naming the package to install", async () => {
    await expect(loadLanguages(["typescript", "ruby"], importer({}))).rejects.toThrow(/cartograph-lang-ruby could not be loaded \(run `pnpm add cartograph-lang-ruby`\)/);
  });

  it("rejects packages that are not plug-ins, or are for another id or API version", async () => {
    await expect(loadLanguages(["x"], importer({ "cartograph-lang-x": { default: {} } }))).rejects.toThrow(/does not export/);
    await expect(loadLanguages(["x"], importer({ "cartograph-lang-x": { default: template } }))).rejects.toThrow(/says its id is "template"/);
    await expect(loadLanguages(["template"], importer({ "cartograph-lang-template": { plugin: { ...template, apiVersion: 2 } } }))).rejects.toThrow(/API version 2/);
    await expect(loadLanguages(["typescript", "typescript"])).rejects.toThrow(/listed twice/);
    await expect(loadLanguages([])).rejects.toThrow(/No languages/);
  });
});

describe("CARTOGRAPH_LANGUAGES", () => {
  it("defaults to typescript and python, and reads a comma-separated list", () => {
    expect(languagesFromEnv({})).toEqual(["typescript", "python"]);
    expect(languagesFromEnv({ CARTOGRAPH_LANGUAGES: "" })).toEqual(["typescript", "python"]);
    expect(languagesFromEnv({ CARTOGRAPH_LANGUAGES: " typescript, python " })).toEqual(["typescript", "python"]);
  });

  it("rejects bad ids, duplicates and an empty list", () => {
    expect(() => languagesFromEnv({ CARTOGRAPH_LANGUAGES: "TypeScript" })).toThrow(/lowercase/);
    expect(() => languagesFromEnv({ CARTOGRAPH_LANGUAGES: "typescript,typescript" })).toThrow(/twice/);
    expect(() => languagesFromEnv({ CARTOGRAPH_LANGUAGES: " , " })).toThrow(/at least one/);
  });
});
