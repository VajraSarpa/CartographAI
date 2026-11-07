"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSupabase } from "@/lib/supabase-browser";

const STEPS = [
  { id: "fetch", label: "Fetch", hint: "Download the repository archive from GitHub" },
  { id: "select", label: "Select", hint: "Keep code files; list everything else" },
  { id: "parse", label: "Parse", hint: "Read every import with the TypeScript parser" },
  { id: "store", label: "Store", hint: "Save the map for your team" },
] as const;

export interface RunView {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  step: (typeof STEPS)[number]["id"];
  progress: Record<string, number | string | boolean>;
  error: string | null;
}

export function Progress({ analysisId, initial, repoLabel }: { analysisId: string; initial: RunView; repoLabel: string }) {
  const db = useSupabase();
  const router = useRouter();
  const [run, setRun] = useState<RunView>(initial);

  useEffect(() => {
    if (!db) return;
    const channel = db
      .channel(`run:${initial.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "analysis_runs", filter: `id=eq.${initial.id}` }, (payload) =>
        setRun(payload.new as RunView),
      )
      .subscribe();
    // fallback in case realtime is unavailable: poll the same row (RLS still applies)
    const poll = setInterval(async () => {
      const { data } = await db.from("analysis_runs").select("id, status, step, progress, error").eq("id", initial.id).maybeSingle();
      if (data) setRun(data as RunView);
    }, 4000);
    return () => {
      clearInterval(poll);
      void db.removeChannel(channel);
    };
  }, [db, initial.id]);

  useEffect(() => {
    // finished: show the map of the newly analyzed repo
    if (run.status === "succeeded") router.refresh();
  }, [run.status, router, analysisId]);

  const current = STEPS.findIndex((s) => s.id === run.step);
  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-12">
      <div>
        <h1 className="font-mono text-lg font-semibold">{repoLabel}</h1>
        <p className="text-sm text-muted">{run.status === "failed" ? "The analysis stopped." : "Drawing the map…"}</p>
      </div>
      <ol className="space-y-3">
        {STEPS.map((s, i) => {
          const done = run.status === "succeeded" || i < current;
          const active = run.status === "running" && i === current;
          const failed = run.status === "failed" && i === current;
          return (
            <li key={s.id} className="flex items-start gap-3">
              <span
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] ${
                  failed ? "border-warn text-warn" : done ? "border-in bg-in text-white" : active ? "border-accent text-accent" : "border-border text-muted"
                }`}
                aria-hidden
              >
                {failed ? "!" : done ? "✓" : i + 1}
              </span>
              <div className="min-w-0">
                <div className={`text-sm font-medium ${active ? "text-accent" : failed ? "text-warn" : ""}`}>
                  {s.label}
                  {active && <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-accent align-middle" />}
                </div>
                <div className="text-xs text-muted">{s.hint}</div>
                {active && s.id === "parse" && typeof run.progress.done === "number" && (
                  <div className="text-xs tabular-nums text-muted">
                    {run.progress.done} / {run.progress.total} files
                  </div>
                )}
                {failed && run.error && (
                  <p role="alert" className="mt-1 text-sm text-warn">
                    {run.error}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
