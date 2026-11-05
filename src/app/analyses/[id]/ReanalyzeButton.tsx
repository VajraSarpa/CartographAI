"use client";

import { useActionState } from "react";
import { analyze, type AnalyzeState } from "@/app/dashboard/actions";

export function ReanalyzeButton({ url, label }: { url: string; label: string }) {
  const [state, action, pending] = useActionState<AnalyzeState, FormData>(analyze, { error: null });
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="url" value={url} />
      <input type="hidden" name="force" value="1" />
      <button type="submit" disabled={pending} className="rounded border border-border px-2 py-0.5 hover:bg-panel-2 disabled:opacity-60">
        {pending ? "Starting…" : label}
      </button>
      {state.error && <span className="text-warn">{state.error}</span>}
    </form>
  );
}
