import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildIndex } from "@/graph";
import { parseRepo } from "@/parser";
import { runAgentTool } from "@/server/agent-tools";

describe("agent tools (over a real parsed map)", async () => {
  const map = await parseRepo(path.join(__dirname, "fixtures", "esm"));
  const L = { map, index: buildIndex(map), repo: { owner: "o", name: "r" }, sha: null };

  it("repo_overview summarises without inventing", async () => {
    const r = (await runAgentTool("repo_overview", L, {})) as Record<string, unknown>;
    expect(r.files_parsed).toBe(map.stats.filesParsed);
    expect(r.import_cycles).toBe(1);
  });
  it("find_files matches all words in the path", async () => {
    const r = (await runAgentTool("find_files", L, { query: "lib c.ts" })) as { matches: { path: string }[] };
    expect(r.matches.map((m) => m.path)).toEqual(["src/lib/c.ts"]);
  });
  it("file_details lists real neighbours and unresolved reasons", async () => {
    const r = (await runAgentTool("file_details", L, { path: "src/index.ts" })) as { imports: { items: string[] }; not_resolved: { reason: string }[] };
    expect(r.imports.items).toContain("src/lib/c.ts");
    expect(r.not_resolved.every((u) => u.reason)).toBe(true);
  });
  it("blast_radius groups by distance", async () => {
    const r = (await runAgentTool("blast_radius", L, { path: "src/lib/c.ts" })) as { one_step: { items: string[] }; two_steps: { items: string[] } };
    expect(r.one_step.items).toEqual(["src/index.ts", "src/lib/b.ts"]);
    expect(r.two_steps.items).toEqual(["src/lib/index.ts"]);
  });
  it("unknown paths return an error with suggestions, not a guess", async () => {
    const r = (await runAgentTool("file_details", L, { path: "lib/b.ts" })) as { error: string };
    expect(r.error).toContain("Did you mean: src/lib/b.ts");
  });
});
