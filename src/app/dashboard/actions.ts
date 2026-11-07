"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { ensureOrgRow, requireOrg } from "@/server/session";
import { runPipeline, startAnalysis } from "@/server/pipeline";

export interface AnalyzeState {
  error: string | null;
}

/** Start (or reopen) the analysis of a repository for the active team. */
export async function analyze(_prev: AnalyzeState, form: FormData): Promise<AnalyzeState> {
  const session = await requireOrg();
  const url = String(form.get("url") ?? "");
  const force = form.get("force") === "1";
  await ensureOrgRow(session);
  let res;
  try {
    res = await startAnalysis(session, url, { force });
  } catch (e) {
    console.error("[analyze] start failed", e);
    return { error: "Could not start the analysis. Try again." };
  }
  if (!res.ok) return { error: res.error };
  if (res.runId && !res.existing) {
    const { runId, analysisId, repo } = res;
    after(() => runPipeline({ runId, analysisId, orgId: session.orgId, owner: repo.owner, name: repo.name, ref: repo.ref }));
  }
  redirect(`/analyses/${res.analysisId}`);
}
