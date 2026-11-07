import "server-only";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseRepo } from "@/parser";
import { PARSER_VERSION } from "@/parser/types";
import { parseRepoUrl } from "@/lib/repo-url";
import { serverEnv } from "@/lib/env";
import { downloadAndExtract, fetchRepoMeta, PipelineError } from "./github";
import { adminDb } from "./supabase";
import { checkLimit, recordUsage } from "./limits";
import type { OrgSession } from "./org";

export type Step = "fetch" | "select" | "parse" | "store";

/** A run that has not moved for this long is considered dead and may be replaced. */
const STALE_RUN_MS = 10 * 60_000;

export type StartResult =
  | { ok: true; analysisId: string; runId: string | null; existing: boolean; repo: { owner: string; name: string; ref: string | null } }
  | { ok: false; error: string };

/**
 * Create (or reuse) the analysis for a repository in the caller's organization
 * and start a run. The organization comes from the verified session only.
 */
export async function startAnalysis(session: OrgSession, rawUrl: string, opts: { force?: boolean } = {}): Promise<StartResult> {
  const ref = parseRepoUrl(rawUrl);
  if (!ref) return { ok: false, error: "Enter a public GitHub repository URL, like https://github.com/owner/repo." };
  const db = adminDb();
  const owner = ref.owner.toLowerCase();
  const name = ref.name.toLowerCase();

  const { data: repo, error: repoErr } = await db
    .from("repositories")
    .upsert({ org_id: session.orgId, owner, name }, { onConflict: "org_id,host,owner,name" })
    .select("id")
    .single();
  if (repoErr || !repo) throw new Error(`repository upsert failed: ${repoErr?.message}`);

  const { data: existing } = await db
    .from("analyses")
    .select("id, status, parser_version, current_run_id, updated_at")
    .eq("org_id", session.orgId)
    .eq("repository_id", repo.id)
    .maybeSingle();

  if (existing && !opts.force) {
    const fresh = Date.now() - new Date(existing.updated_at).getTime() < STALE_RUN_MS;
    if (existing.status === "succeeded" && existing.parser_version === PARSER_VERSION) {
      return { ok: true, analysisId: existing.id, runId: null, existing: true, repo: { owner, name, ref: ref.ref } };
    }
    if ((existing.status === "running" || existing.status === "queued") && fresh) {
      return { ok: true, analysisId: existing.id, runId: existing.current_run_id, existing: true, repo: { owner, name, ref: ref.ref } };
    }
  }

  const limit = await checkLimit(session, "analyze");
  if (!limit.ok) return { ok: false, error: limit.message };

  let analysisId = existing?.id as string | undefined;
  if (!analysisId) {
    const { data, error } = await db
      .from("analyses")
      .insert({ org_id: session.orgId, repository_id: repo.id, status: "queued", ref: ref.ref, created_by: session.userId })
      .select("id")
      .single();
    if (error || !data) throw new Error(`analysis insert failed: ${error?.message}`);
    analysisId = data.id as string;
  }

  const { data: run, error: runErr } = await db
    .from("analysis_runs")
    .insert({ org_id: session.orgId, analysis_id: analysisId, status: "running", step: "fetch", created_by: session.userId })
    .select("id")
    .single();
  if (runErr || !run) throw new Error(`run insert failed: ${runErr?.message}`);

  await db.from("analyses").update({ status: "running", current_run_id: run.id, ref: ref.ref }).eq("id", analysisId).eq("org_id", session.orgId);
  await recordUsage(session, "analyze", { analysisId });
  return { ok: true, analysisId, runId: run.id as string, existing: false, repo: { owner, name, ref: ref.ref } };
}

/**
 * fetch -> select -> parse -> store. Every update is scoped to this run, so a
 * slow, older run can never overwrite the result of a newer one.
 */
export async function runPipeline(args: { runId: string; analysisId: string; orgId: string; owner: string; name: string; ref: string | null }): Promise<void> {
  const db = adminDb();
  let step: Step = "fetch";
  const setStep = async (s: Step, progress: Record<string, unknown> = {}) => {
    step = s;
    await db.from("analysis_runs").update({ step: s, progress }).eq("id", args.runId).eq("status", "running");
  };
  const dir = await mkdtemp(path.join(tmpdir(), "cartograph-"));
  try {
    serverEnv();
    await setStep("fetch");
    const meta = await fetchRepoMeta(args.owner, args.name, args.ref);
    const extracted = await downloadAndExtract(meta, dir);

    await setStep("select", { entries: extracted.entries, bytes: extracted.written, sha: meta.sha });
    let lastReport = 0;
    const map = await parseRepo(dir, {
      sizeOverrides: extracted.oversized,
      onProgress: (done, total) => {
        if (done - lastReport >= 250) {
          lastReport = done;
          void db.from("analysis_runs").update({ step: "parse", progress: { done, total } }).eq("id", args.runId).eq("status", "running");
        }
      },
    });
    await setStep("parse", { done: map.stats.filesFound, total: map.stats.filesFound });

    await setStep("store", { files: map.stats.filesParsed, edges: map.stats.edges });
    const json = JSON.stringify(map);
    const { error: mapErr } = await db
      .from("analysis_maps")
      .upsert({ analysis_id: args.analysisId, org_id: args.orgId, parser_version: map.parserVersion, map, bytes: json.length }, { onConflict: "analysis_id" });
    if (mapErr) throw new Error(`storing map failed: ${mapErr.message}`);
    // explanations and AI roles describe the previous map: drop them
    await db.from("explanations").delete().eq("analysis_id", args.analysisId);
    await db.from("file_roles").delete().eq("analysis_id", args.analysisId);

    const { data: updated } = await db
      .from("analyses")
      .update({
        status: "succeeded",
        commit_sha: meta.sha,
        ref: meta.ref,
        parser_version: map.parserVersion,
        framework: map.framework.name,
        stats: map.stats,
      })
      .eq("id", args.analysisId)
      .eq("current_run_id", args.runId)
      .select("id");
    await db
      .from("analysis_runs")
      .update({ status: "succeeded", finished_at: new Date().toISOString(), progress: { files: map.stats.filesParsed, edges: map.stats.edges, superseded: !updated?.length } })
      .eq("id", args.runId);
  } catch (e) {
    const err = e as Error;
    const userMessage = e instanceof PipelineError ? e.userMessage : "Something went wrong while analyzing. The error was logged.";
    console.error(`[pipeline] run ${args.runId} failed at ${step}:`, err);
    await db.from("analysis_runs").update({ status: "failed", error: userMessage, finished_at: new Date().toISOString() }).eq("id", args.runId);
    await db.from("analyses").update({ status: "failed" }).eq("id", args.analysisId).eq("current_run_id", args.runId);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export { PARSER_VERSION };
