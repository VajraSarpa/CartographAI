"use client";

import { useRef, useState } from "react";
import { RichText } from "./RichText";

type ToolEvent = { id?: string; name: string; args: unknown; done?: boolean; ok?: boolean };
type Turn = { role: "user" | "assistant"; content: string; tools?: ToolEvent[]; error?: string };

const SUGGESTIONS = ["Where is authentication handled?", "What are the entry points?", "What breaks if I change the most depended-on file?"];

export function AskPanel({ analysisId }: { analysisId: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    const history = turns.filter((t) => !t.error && t.content).map((t) => ({ role: t.role, content: t.content }));
    const next: Turn[] = [...turns, { role: "user", content: question }, { role: "assistant", content: "", tools: [] }];
    setTurns(next);
    setQ("");
    setBusy(true);
    const update = (fn: (t: Turn) => Turn) => setTurns((ts) => [...ts.slice(0, -1), fn(ts[ts.length - 1])]);
    try {
      const res = await fetch(`/api/analyses/${analysisId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...history.slice(-10), { role: "user", content: question }] }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === "tool_call") update((t) => ({ ...t, tools: [...(t.tools ?? []), { id: ev.id, name: ev.name, args: ev.args }] }));
          else if (ev.type === "tool_result")
            update((t) => ({ ...t, tools: (t.tools ?? []).map((x) => (x.id === ev.id ? { ...x, done: true, ok: ev.ok } : x)) }));
          else if (ev.type === "answer") update((t) => ({ ...t, content: ev.text }));
          else if (ev.type === "error") update((t) => ({ ...t, error: ev.message }));
        }
        bottom.current?.scrollIntoView({ block: "end" });
      }
    } catch (e) {
      update((t) => ({ ...t, error: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 && (
          <div className="space-y-2 text-xs text-muted">
            <p>Ask about this repository. Answers come from the parsed graph through tool calls you can watch.</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => ask(s)} className="block w-full rounded border border-border px-2 py-1.5 text-left hover:bg-panel-2">
                {s}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="ml-6 rounded-lg bg-accent/10 px-3 py-2 text-sm">
              {t.content}
            </div>
          ) : (
            <div key={i} className="space-y-2">
              {(t.tools ?? []).length > 0 && (
                <ul className="space-y-0.5 font-mono text-[11px] text-muted">
                  {t.tools!.map((x, j) => (
                    <li key={j} className="truncate" title={JSON.stringify(x.args)}>
                      {x.done ? (x.ok ? "✓" : "✗") : "…"} {x.name}({Object.values((x.args as Record<string, unknown>) ?? {}).filter((v) => v !== "" && v != null).map(String).join(", ")})
                    </li>
                  ))}
                </ul>
              )}
              {t.content ? <RichText text={t.content} /> : !t.error && <p className="text-xs text-muted">Thinking…</p>}
              {t.error && (
                <p role="alert" className="text-xs text-warn">
                  {t.error}
                </p>
              )}
            </div>
          ),
        )}
        <div ref={bottom} />
      </div>
      <form
        className="flex gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(q);
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={2000}
          placeholder="Ask the repo a question"
          className="min-w-0 flex-1 rounded-md border border-border bg-panel px-3 py-1.5 text-sm outline-none focus:border-accent"
          aria-label="Question"
        />
        <button type="submit" disabled={busy || !q.trim()} className="rounded-md bg-accent px-3 text-sm font-medium text-white disabled:opacity-60">
          Ask
        </button>
      </form>
    </div>
  );
}
