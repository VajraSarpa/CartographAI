import "server-only";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { traceable } from "langsmith/traceable";
import { z } from "zod";
import { buildIndex } from "@/graph";
import { serverEnv } from "@/lib/env";
import { checkPaths } from "@/lib/paths";
import type { ParseResult } from "@/parser/types";
import { adminDb, userDb } from "../supabase";
import type { OrgSession } from "../session";
import { claude } from "./client";

export const PROMPT_VERSION = "explain-v1";
const MAX_LIST = 60;
const MAX_SOURCE_BYTES = 60_000;

// Frozen system prompt: identical bytes on every call, so it is cached.
export const SYSTEM = `You explain one file or folder of a TypeScript/JavaScript repository to a developer who is new to it.

You receive facts produced by a static parser (the import graph) and, for files, the file's source.
Everything you say about connections must come from those facts.

Rules:
- Name a file only if its exact path appears in the facts you were given. Write paths exactly as given, in backticks. Never shorten, guess or construct a path.
- Describe what the code does and how it connects: what it imports, what imports it, its role in the framework if one is given.
- Do not grade, score or judge code quality, and do not suggest refactors. The graph cannot know whether code is good.
- If the facts are not enough to say what something does, say that plainly.
- 120 to 220 words of plain markdown. No headings.

Also return "role": a short lowercase label (1-3 words, e.g. "api client", "ui component", "test helper", "config") describing the file's role, or null for folders or when unclear.`;

const OutputSchema = z.object({
  explanation: z.string().min(1).max(4000),
  role: z.string().max(40).nullable(),
});
const OUTPUT_FORMAT = { type: "json_schema" as const, schema: z.toJSONSchema(OutputSchema, { target: "draft-7" }) as Record<string, unknown> };

export type Target = { kind: "file"; path: string } | { kind: "module"; module: string };

export interface Explanation {
  content: string;
  role: string | null;
  cached: boolean;
  shownPaths: string[];
  inventedPaths: string[];
  model: string;
}

export interface Input {
  facts: Record<string, unknown>;
  source: string | null;
  shown: string[];
}

function sortedSlice(xs: Iterable<string>, n: number): { list: string[]; more: number } {
  const all = [...xs].sort();
  return { list: all.slice(0, n), more: Math.max(0, all.length - n) };
}

/** Build exactly what the model will see. The shown-path set is derived from it. */
export function buildInput(map: ParseResult, target: Target, source: string | null): Input {
  const index = buildIndex(map);
  if (target.kind === "file") {
    const f = index.files.get(target.path);
    if (!f) throw new Error("file not in map");
    // a file importing itself must not leak into its own neighbour lists
    const imports = sortedSlice([...(index.out.get(f.path) ?? [])].filter((p) => p !== f.path), MAX_LIST);
    const importedBy = sortedSlice([...(index.in.get(f.path) ?? [])].filter((p) => p !== f.path), MAX_LIST);
    const external = [...new Set(map.unresolved.filter((u) => u.from === f.path && u.status === "external").map((u) => u.pkg!))].sort();
    const facts = {
      kind: "file",
      path: f.path,
      folder: f.module,
      lines: f.lines,
      framework: map.framework.name,
      roles: f.roles.map((r) => map.framework.roles[r] ?? r),
      reached_by_framework_without_import: f.entry,
      imports: imports.list,
      imports_not_listed: imports.more,
      imported_by: importedBy.list,
      imported_by_not_listed: importedBy.more,
      external_packages: external,
    };
    return { facts, source, shown: [f.path, ...imports.list, ...importedBy.list] };
  }
  const files = index.modules.get(target.module);
  if (!files) throw new Error("folder not in map");
  const own = new Set(files);
  const inbound = new Set<string>();
  const outbound = new Set<string>();
  for (const p of files) {
    index.in.get(p)?.forEach((x) => !own.has(x) && inbound.add(x));
    index.out.get(p)?.forEach((x) => !own.has(x) && outbound.add(x));
  }
  const fileList = sortedSlice(files, MAX_LIST);
  const ins = sortedSlice(inbound, MAX_LIST);
  const outs = sortedSlice(outbound, MAX_LIST);
  const facts = {
    kind: "folder",
    folder: target.module,
    framework: map.framework.name,
    files: fileList.list.map((p) => ({ path: p, lines: index.files.get(p)!.lines, roles: index.files.get(p)!.roles })),
    files_not_listed: fileList.more,
    imported_by_files_outside: ins.list,
    imported_by_not_listed: ins.more,
    imports_files_outside: outs.list,
    imports_not_listed: outs.more,
  };
  return { facts, source: null, shown: [...fileList.list, ...ins.list, ...outs.list] };
}

/** Source at the analyzed commit, verified against the hash the parser recorded. */
export async function fetchSource(repo: { owner: string; name: string }, sha: string, path: string, expectedHash: string): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/${sha}/${path.split("/").map(encodeURIComponent).join("/")}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (createHash("sha256").update(buf).digest("hex").slice(0, 16) !== expectedHash) return null;
    const text = buf.toString("utf8");
    return text.length > MAX_SOURCE_BYTES ? `${text.slice(0, MAX_SOURCE_BYTES)}\n/* ... truncated: file continues ... */` : text;
  } catch {
    return null;
  }
}

function inputHash(input: Input, model: string): string {
  return createHash("sha256").update(JSON.stringify({ v: PROMPT_VERSION, model, facts: input.facts, source: input.source })).digest("hex");
}

/**
 * RECONSTRUCTION, clearly labelled: no earlier prompt was kept, so this is a
 * plausible "first draft" (no path rules, no length bound) used only as the
 * baseline in `pnpm eval prompts`.
 */
export const PREVIOUS_SYSTEM_RECONSTRUCTED = `You are a senior engineer. Explain what this file or folder does and how it fits into the codebase, based on the information provided. Return "role": a short label for the file's role, or null.`;

export const callModel = async (input: Input, model: string, system: string = SYSTEM) => {
  const user = [
    "Facts from the parser (JSON):",
    JSON.stringify(input.facts, null, 1),
    input.source !== null ? `\nSource of ${String(input.facts.path)}:\n\`\`\`\n${input.source}\n\`\`\`` : "",
  ].join("\n");
  const res = await claude().beta.messages.create({
    model,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    output_config: { effort: "low", format: OUTPUT_FORMAT },
    messages: [{ role: "user", content: user }],
  });
  if (res.stop_reason === "refusal") throw new Error("The model declined to explain this.");
  if (res.stop_reason === "max_tokens") throw new Error("The explanation was cut off.");
  const text = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
  const parsed = OutputSchema.safeParse(text ? JSON.parse(text) : null);
  if (!parsed.success) throw new Error("The model returned an unexpected format.");
  return { ...parsed.data, usage: res.usage, servedBy: res.model };
};

/**
 * Explain a file or folder. Cached by exactly what the model would see, so a
 * repeat is free and its trace contains no model call. The invented-path
 * check runs on every result, cached or not.
 */
export const explain = traceable(
  async (args: {
    session: OrgSession;
    analysisId: string;
    repo: { owner: string; name: string };
    commitSha: string | null;
    map: ParseResult;
    target: Target;
  }): Promise<Explanation & { usage?: { input_tokens: number; output_tokens: number } }> => {
    const model = serverEnv().ANTHROPIC_MODEL;
    let source: string | null = null;
    if (args.target.kind === "file" && args.commitSha) {
      const node = args.map.files.find((f) => f.path === (args.target as { path: string }).path);
      if (node) source = await fetchSource(args.repo, args.commitSha, node.path, node.hash);
    }
    const input = buildInput(args.map, args.target, source);
    const hash = inputHash(input, model);
    const targetKey = args.target.kind === "file" ? args.target.path : args.target.module;

    // read through RLS: the member must be able to see this analysis
    const { data: hit } = await userDb()
      .from("explanations")
      .select("content, shown_paths, model")
      .eq("analysis_id", args.analysisId)
      .eq("target_kind", args.target.kind)
      .eq("target", targetKey)
      .eq("input_hash", hash)
      .eq("prompt_version", PROMPT_VERSION)
      .maybeSingle();
    if (hit) {
      const check = checkPaths(hit.content, hit.shown_paths);
      return { content: hit.content, role: null, cached: true, shownPaths: hit.shown_paths, inventedPaths: check.invented, model: hit.model };
    }

    const out = await callModel(input, model);
    const check = checkPaths(out.explanation, input.shown);
    const db = adminDb();
    await db.from("explanations").upsert(
      {
        org_id: args.session.orgId,
        analysis_id: args.analysisId,
        target_kind: args.target.kind,
        target: targetKey,
        input_hash: hash,
        prompt_version: PROMPT_VERSION,
        model: out.servedBy,
        content: out.explanation,
        shown_paths: input.shown,
        invented_paths: check.invented,
      },
      { onConflict: "analysis_id,target_kind,target,input_hash,prompt_version" },
    );
    // a role only for files no framework rule classified; stored and labelled as AI-suggested
    if (args.target.kind === "file" && out.role) {
      const node = args.map.files.find((f) => f.path === (args.target as { path: string }).path);
      if (node && node.roles.length === 0) {
        await db.from("file_roles").upsert(
          { analysis_id: args.analysisId, org_id: args.session.orgId, path: node.path, role: out.role.toLowerCase(), input_hash: hash, model: out.servedBy },
          { onConflict: "analysis_id,path" },
        );
      }
    }
    return {
      content: out.explanation,
      role: out.role,
      cached: false,
      shownPaths: input.shown,
      inventedPaths: check.invented,
      model: out.servedBy,
      usage: { input_tokens: out.usage.input_tokens, output_tokens: out.usage.output_tokens },
    };
  },
  {
    name: "explain",
    run_type: "chain",
    processInputs: (inputs) => {
      const a = (inputs as { args?: unknown[] }).args?.[0] as { analysisId?: string; target?: unknown } | undefined;
      // keep traces small and free of identity: no session, no whole map
      return { analysisId: a?.analysisId, target: a?.target };
    },
  },
);
