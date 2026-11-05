import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { PARSER_VERSION, type ParseResult } from "@/parser/types";
import { requireOrg } from "@/server/session";
import { userDb } from "@/server/supabase";
import { AnalysisMap } from "./AnalysisMap";
import { Progress, type RunView } from "./Progress";
import { ReanalyzeButton } from "./ReanalyzeButton";

export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function Analysis({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  await requireOrg();
  const db = userDb();
  // RLS: an analysis from another team is simply not found.
  const { data: a } = await db
    .from("analyses")
    .select("id, status, parser_version, commit_sha, ref, current_run_id, repositories(owner, name)")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      status: RunView["status"];
      parser_version: number | null;
      commit_sha: string | null;
      ref: string | null;
      current_run_id: string | null;
      repositories: { owner: string; name: string } | null;
    }>();
  if (!a || !a.repositories) notFound();
  const repo = a.repositories;
  const url = `https://github.com/${repo.owner}/${repo.name}`;
  const label = `${repo.owner}/${repo.name}`;

  if (a.status !== "succeeded") {
    const { data: run } = a.current_run_id
      ? await db.from("analysis_runs").select("id, status, step, progress, error").eq("id", a.current_run_id).maybeSingle<RunView>()
      : { data: null };
    if (!run) notFound();
    return (
      <>
        <Progress analysisId={a.id} initial={run} repoLabel={label} />
        {run.status === "failed" && (
          <div className="mx-auto max-w-xl px-6">
            <ReanalyzeButton url={url} label="Try again" />
          </div>
        )}
      </>
    );
  }

  const { data: stored } = await db.from("analysis_maps").select("map").eq("analysis_id", a.id).maybeSingle<{ map: ParseResult }>();
  if (!stored) notFound();
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border bg-panel px-4 py-1.5 text-xs">
        <a href={url} target="_blank" rel="noopener noreferrer" className="font-mono font-medium hover:underline">
          {label}
        </a>
        {a.commit_sha && <span className="font-mono text-muted">{a.ref ? `${a.ref} @ ` : ""}{a.commit_sha.slice(0, 7)}</span>}
        {a.parser_version !== PARSER_VERSION && <span className="text-warn">Stored by an older parser. Re-analyze for the current rules.</span>}
        <div className="ml-auto">
          <ReanalyzeButton url={url} label="Re-analyze" />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <AnalysisMap analysisId={a.id} data={{ repo: { owner: repo.owner, name: repo.name, ref: a.ref, url }, map: stored.map }} />
      </div>
    </div>
  );
}

export default function AnalysisPage(props: PageProps<"/analyses/[id]">) {
  return (
    <AppShell full>
      <Suspense fallback={<p className="p-6 text-sm text-muted">Loading…</p>}>
        <Analysis params={props.params} />
      </Suspense>
    </AppShell>
  );
}
