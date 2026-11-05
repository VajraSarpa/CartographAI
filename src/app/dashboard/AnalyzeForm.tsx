"use client";

import { useActionState } from "react";
import { analyze, type AnalyzeState } from "./actions";

export function AnalyzeForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const [state, action, pending] = useActionState<AnalyzeState, FormData>(analyze, { error: null });
  return (
    <form action={action} className="space-y-2">
      <label htmlFor="url" className="block text-sm font-medium">
        Public GitHub repository
      </label>
      <div className="flex gap-2">
        <input
          id="url"
          name="url"
          type="text"
          required
          maxLength={300}
          autoFocus={autoFocus}
          placeholder="https://github.com/owner/repo"
          className="min-w-0 flex-1 rounded-md border border-border bg-panel px-3 py-2 font-mono text-sm outline-none focus:border-accent"
          aria-describedby={state.error ? "url-error" : undefined}
        />
        <button type="submit" disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {pending ? "Starting…" : "Analyze"}
        </button>
      </div>
      {state.error && (
        <p id="url-error" role="alert" className="text-sm text-warn">
          {state.error}
        </p>
      )}
    </form>
  );
}
