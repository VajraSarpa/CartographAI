/*
 * Evals for the AI features. Run against real stored explanations and maps.
 *   pnpm eval paths           share of stored explanations that name only shown paths
 *   pnpm eval paths splice    insert fake paths into each explanation: the checker must catch all
 *   pnpm eval roles [N]       role classification accuracy vs. framework rule roles (calls the model)
 *   pnpm eval prompts [N]     current prompt vs. previous prompt, as a LangSmith experiment (calls the model)
 */
import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

import type Anthropic from "@anthropic-ai/sdk";

type Row = { id: string; analysis_id: string; target_kind: string; target: string; content: string; shown_paths: string[] };

async function main() {
  const { adminDb } = await import("../src/server/supabase");
  const { checkPaths } = await import("../src/lib/paths");
  const [cmd, sub] = process.argv.slice(2);
  const db = adminDb();

  const loadExplanations = async (): Promise<Row[]> => {
    const { data, error } = await db.from("explanations").select("id, analysis_id, target_kind, target, content, shown_paths").order("created_at");
    if (error) throw error;
    return data as Row[];
  };

  if (cmd === "paths" && sub !== "splice") {
    const rows = await loadExplanations();
    if (!rows.length) return console.log("No stored explanations yet. Generate ~10 with the Explain button first.");
    let clean = 0;
    for (const r of rows) {
      const c = checkPaths(r.content, r.shown_paths);
      if (c.invented.length === 0) clean++;
      else console.log(`  invented in ${r.target_kind} ${r.target}: ${c.invented.join(", ")}`);
    }
    console.log(`\npaths: ${clean}/${rows.length} explanations name only shown paths (${((100 * clean) / rows.length).toFixed(1)}%)`);
    return;
  }

  if (cmd === "paths" && sub === "splice") {
    const rows = await loadExplanations();
    if (!rows.length) return console.log("No stored explanations yet.");
    // Each fake is a different way a model invents a path.
    const fakes = (shown: string[]) => {
      const real = shown[0] ?? "src/index.ts";
      const dir = real.includes("/") ? real.slice(0, real.lastIndexOf("/")) : "src";
      const tail = real.split("/").slice(-2).join("/");
      return [
        `\`${dir}/helpers.generated.ts\``, // plausible sibling
        `${dir}/internal/cache.ts`, // bare, unbackticked
        `\`${tail.includes("/") ? tail : `lib/${tail}`}\``, // relative tail of a real file
        `\`./${real.split("/").pop()}\``, // ./basename
        `\`${real.replace(/\.(\w+)$/, ".spec.$1")}\``, // invented test file
      ].filter((f) => !shown.includes(f.replace(/`/g, "")));
    };
    let inserted = 0;
    let caught = 0;
    for (const r of rows) {
      for (const fake of fakes(r.shown_paths)) {
        const text = `${r.content}\n\nSee also ${fake} for details.`;
        inserted++;
        const inv = checkPaths(text, r.shown_paths).invented;
        if (inv.includes(fake.replace(/`/g, "").trim())) caught++;
        else console.log(`  MISSED ${fake} in ${r.target}`);
      }
    }
    console.log(`\npaths splice: caught ${caught} of ${inserted} spliced fake paths`);
    if (caught !== inserted) process.exit(1);
    return;
  }

  if (cmd === "roles" || cmd === "prompts") {
    const { buildInput, callModel, fetchSource, PREVIOUS_SYSTEM_RECONSTRUCTED, SYSTEM } = await import("../src/server/ai/explain");
    const { serverEnv } = await import("../src/lib/env");
    const model = serverEnv().ANTHROPIC_MODEL;
    const n = Number(sub ?? (cmd === "roles" ? 30 : 10));
    const { data: analyses } = await db.from("analyses").select("id, commit_sha, repositories(owner, name)").eq("status", "succeeded");
    if (!analyses?.length) return console.log("No analyses yet.");
    type ParseResult = import("../src/parser/types").ParseResult;
    const maps: { id: string; sha: string; repo: { owner: string; name: string }; map: ParseResult }[] = [];
    for (const a of analyses as unknown as { id: string; commit_sha: string; repositories: { owner: string; name: string } }[]) {
      const { data } = await db.from("analysis_maps").select("map").eq("analysis_id", a.id).single();
      if (data) maps.push({ id: a.id, sha: a.commit_sha, repo: a.repositories, map: data.map as ParseResult });
    }

    if (cmd === "roles") {
      // Ground truth: framework-rule roles (excluding filename-only rules). The model sees the
      // facts and source WITHOUT the roles or entry flag, and picks from the vocabulary.
      const COMMON = new Set(["test", "config", "package-entry", "html-entry"]);
      const samples: { m: (typeof maps)[number]; path: string; truth: string[] }[] = [];
      for (const m of maps) {
        for (const f of m.map.files) {
          const truth = f.roles.filter((r) => !COMMON.has(r));
          if (truth.length) samples.push({ m, path: f.path, truth });
        }
      }
      // deterministic sample spread across repos
      samples.sort((a, b) => (a.path < b.path ? -1 : 1));
      const step = Math.max(1, Math.floor(samples.length / n));
      const picked = samples.filter((_, i) => i % step === 0).slice(0, n);
      let correct = 0;
      const { claude } = await import("../src/server/ai/client");
      for (const s of picked) {
        const vocab = Object.entries(s.m.map.framework.roles).filter(([id]) => !COMMON.has(id));
        const node = s.m.map.files.find((f) => f.path === s.path)!;
        const source = await fetchSource(s.m.repo, s.m.sha, s.path, node.hash);
        const input = buildInput(s.m.map, { kind: "file", path: s.path }, source);
        const facts = { ...input.facts } as Record<string, unknown>;
        delete facts.roles; // the answer
        delete facts.reached_by_framework_without_import; // a hint derived from the answer
        const res = await claude().messages.create({
          model,
          max_tokens: 2000,
          output_config: {
            effort: "low",
            format: {
              type: "json_schema",
              schema: { type: "object", properties: { role: { type: "string", enum: [...vocab.map(([id]) => id), "none"] } }, required: ["role"], additionalProperties: false },
            },
          },
          messages: [
            {
              role: "user",
              content: `Classify this file's role in a ${s.m.map.framework.name} project. Roles:\n${vocab.map(([id, l]) => `- ${id}: ${l}`).join("\n")}\n- none: none of these\n\nFacts:\n${JSON.stringify(facts)}\n\nSource:\n${source ?? "(unavailable)"}`,
            },
          ],
        });
        const text = res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "{}";
        const got = (JSON.parse(text) as { role?: string }).role ?? "none";
        if (s.truth.includes(got)) correct++;
        else console.log(`  miss ${s.m.repo.owner}/${s.m.repo.name} ${s.path}: got ${got}, expected ${s.truth.join("|")}`);
      }
      console.log(`\nroles: ${correct}/${picked.length} correct (${((100 * correct) / Math.max(1, picked.length)).toFixed(1)}%) with ${model}`);
      return;
    }

    // prompts: same inputs, two prompts, compared as LangSmith experiments
    const { Client } = await import("langsmith");
    const { evaluate } = await import("langsmith/evaluation");
    const ls = new Client();
    const rows = (await loadExplanations()).slice(0, n);
    if (!rows.length) return console.log("No stored explanations yet.");
    const datasetName = "cartograph-explain";
    const dataset = (await ls.hasDataset({ datasetName })) ? await ls.readDataset({ datasetName }) : await ls.createDataset(datasetName, { description: "Explain inputs built from real parsed maps" });
    const examples = [];
    for (const r of rows) {
      const m = maps.find((x) => x.id === r.analysis_id);
      if (!m) continue;
      const target = r.target_kind === "file" ? { kind: "file" as const, path: r.target } : { kind: "module" as const, module: r.target };
      let source: string | null = null;
      if (target.kind === "file") {
        const node = m.map.files.find((f) => f.path === target.path);
        if (node) source = await fetchSource(m.repo, m.sha, node.path, node.hash);
      }
      examples.push({ inputs: buildInput(m.map, target, source) as unknown as Record<string, unknown>, dataset_id: dataset.id });
    }
    const existing = [];
    for await (const ex of ls.listExamples({ datasetId: dataset.id })) existing.push(ex);
    if (!existing.length) await ls.createExamples(examples);

    const noInvented = ({ inputs, outputs }: { inputs: Record<string, unknown>; outputs: Record<string, unknown> }) => {
      const c = checkPaths(String(outputs.explanation ?? ""), inputs.shown as string[]);
      return { key: "no_invented_paths", score: c.invented.length === 0 ? 1 : 0, comment: c.invented.join(", ") || undefined };
    };
    const lengthOk = ({ outputs }: { outputs: Record<string, unknown> }) => {
      const words = String(outputs.explanation ?? "").split(/\s+/).filter(Boolean).length;
      return { key: "length_120_220_words", score: words >= 100 && words <= 240 ? 1 : 0 };
    };
    const noJudgement = ({ outputs }: { outputs: Record<string, unknown> }) => ({
      key: "no_quality_judgement",
      score: /\b(well[- ]written|poorly|clean code|messy|code smell|should refactor|best practice|bad practice)\b/i.test(String(outputs.explanation ?? "")) ? 0 : 1,
    });
    for (const [label, system] of [
      ["previous (reconstructed)", PREVIOUS_SYSTEM_RECONSTRUCTED],
      ["current explain-v1", SYSTEM],
    ] as const) {
      const r = await evaluate(
        async (inputs: Record<string, unknown>) => {
          const out = await callModel(inputs as unknown as Parameters<typeof callModel>[0], model, system);
          return { explanation: out.explanation, role: out.role };
        },
        { data: datasetName, evaluators: [noInvented, lengthOk, noJudgement], experimentPrefix: `explain ${label}`, maxConcurrency: 3, client: ls },
      );
      console.log(`${label}: experiment ${r.experimentName}`);
    }
    await ls.awaitPendingTraceBatches();
    console.log("Compare both experiments in LangSmith -> Datasets & Experiments -> cartograph-explain.");
    return;
  }
  console.log("usage: pnpm eval paths | paths splice | roles [N] | prompts [N]");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
