"use client";

import { useMemo, useState } from "react";
import { insights } from "@/graph";
import { useMap } from "./context";
import { PathLink } from "./PathLink";

function Section({ title, count, children, defaultOpen = true }: { title: string; count?: number; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-border">
      <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted hover:text-fg" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>
          {open ? "▾" : "▸"} {title}
        </span>
        {count !== undefined && <span className="tabular-nums">{count}</span>}
      </button>
      {open && <div className="px-2 pb-2">{children}</div>}
    </section>
  );
}

export function Rail() {
  const { data, index, lens, setLens } = useMap();
  const fw = data.map.framework;
  const ins = useMemo(() => insights(index), [index]);
  const roleCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of index.files.values()) for (const r of f.roles) c[r] = (c[r] ?? 0) + 1;
    return c;
  }, [index]);

  const filesLens = (label: string, files: string[]) =>
    setLens(lens?.kind === "files" && lens.label === label ? null : { kind: "files", files, label });

  return (
    <aside className="flex h-full flex-col overflow-y-auto border-r border-border bg-panel text-sm" aria-label="Map categories">
      <div className="border-b border-border px-3 py-3">
        <div className="text-xs text-muted">Framework</div>
        <div className="font-medium">{fw.name}</div>
        {fw.evidence && <div className="mt-0.5 font-mono text-[11px] text-muted">{fw.evidence}</div>}
        {fw.others.length > 0 && (
          <div className="mt-1 text-[11px] text-muted">
            Also: {fw.others.map((o) => `${o.name} (${o.files} files)`).join(", ")}
          </div>
        )}
      </div>

      <Section title="Roles" count={Object.keys(fw.roles).length}>
        {Object.keys(fw.roles).length === 0 && <p className="px-1 text-xs text-muted">No roles: no framework rule matched.</p>}
        <ul>
          {Object.entries(fw.roles).map(([id, label]) => {
            const active = lens?.kind === "role" && lens.role === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => setLens(active ? null : { kind: "role", role: id, label })}
                  className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-panel-2 ${active ? "bg-accent/15 text-accent" : ""}`}
                  aria-pressed={active}
                >
                  <span>{label}</span>
                  <span className="tabular-nums text-muted">{roleCounts[id] ?? 0}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>

      {fw.supportsRoutes && (
        <Section title="Routes" count={fw.routes.length} defaultOpen={false}>
          <p className="px-1 pb-1 text-[11px] text-muted">Only routes whose method and full path are both written in the code.</p>
          <ul className="space-y-0.5">
            {fw.routes.map((r) => (
              <li key={`${r.method} ${r.path} ${r.file}`} className="flex items-baseline gap-2 px-1 text-xs">
                <span className="w-12 shrink-0 font-mono text-[10px] font-semibold text-accent">{r.method}</span>
                <PathLink path={r.file} label={r.path} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Insights" defaultOpen={false}>
        <ul className="space-y-0.5 text-xs">
          <InsightRow label="Import cycles" n={ins.cycles.length} onClick={() => filesLens("Import cycles", ins.cycles.flat())} active={lens?.kind === "files" && lens.label === "Import cycles"} />
          <InsightRow
            label="Nothing imports these"
            hint="Not reached by any import or framework rule. The graph can't tell whether they're used."
            n={ins.notImported.length}
            onClick={() => filesLens("Nothing imports these", ins.notImported)}
            active={lens?.kind === "files" && lens.label === "Nothing imports these"}
          />
          <InsightRow label="Heavy fan-in" n={ins.heavyFanIn.length} onClick={() => filesLens("Heavy fan-in", ins.heavyFanIn.map((h) => h.path))} active={lens?.kind === "files" && lens.label === "Heavy fan-in"} />
          <InsightRow label="Large files (500+ lines)" n={ins.largeFiles.length} onClick={() => filesLens("Large files (500+ lines)", ins.largeFiles.map((h) => h.path))} active={lens?.kind === "files" && lens.label === "Large files (500+ lines)"} />
        </ul>
        {lens?.kind === "files" && (
          <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto border-t border-border pt-2">
            {lens.label === "Import cycles"
              ? ins.cycles.map((c, i) => (
                  <li key={i} className="px-1 text-xs">
                    <div className="text-muted">Cycle of {c.length}</div>
                    {c.slice(0, 8).map((p) => (
                      <div key={p} className="pl-2">
                        <PathLink path={p} />
                      </div>
                    ))}
                    {c.length > 8 && <div className="pl-2 text-muted">+{c.length - 8} more</div>}
                  </li>
                ))
              : lens.files.slice(0, 200).map((p) => (
                  <li key={p} className="px-1 text-xs">
                    <PathLink path={p} />
                  </li>
                ))}
          </ul>
        )}
      </Section>

      <div className="mt-auto px-3 py-2 text-[11px] text-muted">
        {data.map.stats.filesParsed} files · {data.map.stats.edges} connections · {data.map.stats.filesSkipped} skipped
      </div>
    </aside>
  );
}

function InsightRow({ label, n, onClick, active, hint }: { label: string; n: number; onClick: () => void; active: boolean; hint?: string }) {
  return (
    <li>
      <button type="button" onClick={onClick} disabled={n === 0} title={hint} aria-pressed={active} className={`flex w-full justify-between rounded px-2 py-1 text-left hover:bg-panel-2 disabled:opacity-50 ${active ? "bg-accent/15 text-accent" : ""}`}>
        <span>{label}</span>
        <span className="tabular-nums text-muted">{n}</span>
      </button>
    </li>
  );
}
