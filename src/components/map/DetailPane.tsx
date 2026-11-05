"use client";

import { useMemo, useState, type ReactNode } from "react";
import { reach, summary } from "@/graph";
import { useMap } from "./context";
import { PathLink } from "./PathLink";

export type ExplainSlot = (target: { kind: "file"; path: string } | { kind: "module"; module: string }) => ReactNode;

const KIND: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript + JSX",
  ".mts": "TypeScript (ES module)",
  ".cts": "TypeScript (CommonJS)",
  ".js": "JavaScript",
  ".jsx": "JavaScript + JSX",
  ".mjs": "JavaScript (ES module)",
  ".cjs": "JavaScript (CommonJS)",
};

export function DetailPane({ explain, ask }: { explain?: ExplainSlot; ask?: ReactNode }) {
  const { selection } = useMap();
  const [top, setTop] = useState<"overview" | "ask">("overview");
  return (
    <aside className="flex h-full flex-col border-l border-border bg-panel text-sm" aria-label="Details">
      <div className="flex border-b border-border" role="tablist">
        {(["overview", "ask"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={top === t}
            onClick={() => setTop(t)}
            className={`flex-1 px-3 py-2 text-xs font-medium capitalize ${top === t ? "border-b-2 border-accent text-fg" : "text-muted hover:text-fg"}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className={`min-h-0 flex-1 ${top === "ask" ? "" : "hidden"}`}>
        {ask ?? <p className="p-4 text-xs text-muted">Ask is not configured for this deployment.</p>}
      </div>
      <div className={`min-h-0 flex-1 overflow-y-auto ${top === "overview" ? "" : "hidden"}`}>
        {selection?.kind === "file" ? (
          <FileDetail path={selection.path} explain={explain} />
        ) : selection?.kind === "module" ? (
          <ModuleDetail module={selection.module} explain={explain} />
        ) : (
          <RepoSummary />
        )}
      </div>
    </aside>
  );
}

function RepoSummary() {
  const { data, index } = useMap();
  const s = useMemo(() => summary(index, data.map.edges), [index, data]);
  const st = data.map.stats;
  const failed = data.map.unresolved.filter((u) => u.status === "failed");
  return (
    <div className="space-y-4 p-4">
      <div>
        <h2 className="text-base font-semibold">{data.repo ? `${data.repo.owner}/${data.repo.name}` : "This map"}</h2>
        <p className="text-xs text-muted">{data.map.framework.name}</p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Files parsed" value={st.filesParsed} />
        <Stat label="Files skipped" value={st.filesSkipped} />
        <Stat label="Imports drawn" value={st.imports.resolved} />
        <Stat label="External packages" value={st.imports.external} />
        <Stat label="Not resolved (with reason)" value={st.imports.skipped + st.imports.failed} />
        <Stat label="Lines" value={st.lines} />
      </dl>
      <div>
        <h3 className="mb-1 text-xs font-semibold text-muted">Most depended-on files</h3>
        <ul className="space-y-0.5 text-xs">
          {s.mostDependedOn.map((f) => (
            <li key={f.path} className="flex justify-between gap-2">
              <PathLink path={f.path} />
              <span className="shrink-0 tabular-nums text-muted">{f.fanIn}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-muted">
        {s.nothingImports} file{s.nothingImports === 1 ? "" : "s"} that nothing imports and no framework rule reaches (see Insights).
      </p>
      {failed.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">{failed.length} imports could not be resolved</summary>
          <ul className="mt-1 space-y-1">
            {failed.slice(0, 100).map((u, i) => (
              <li key={i}>
                <PathLink path={u.from} label={`${u.from}:${u.line}`} /> <code className="text-muted">{u.specifier}</code>
                <div className="text-muted">{u.reason}</div>
              </li>
            ))}
          </ul>
        </details>
      )}
      {data.map.skipped.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">{data.map.skipped.length} files skipped</summary>
          <ul className="mt-1 space-y-1">
            {data.map.skipped.slice(0, 100).map((f) => (
              <li key={f.path}>
                <code>{f.path}</code>
                <div className="text-muted">{f.reason}</div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-border bg-panel-2 px-2 py-1.5">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums">{value.toLocaleString()}</dd>
    </div>
  );
}

function SubTabs({ structure, explanation }: { structure: ReactNode; explanation: ReactNode }) {
  const [tab, setTab] = useState<"structure" | "explanation">("structure");
  return (
    <>
      <div className="flex gap-3 border-b border-border px-4 text-xs" role="tablist">
        {(["structure", "explanation"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`py-2 capitalize ${tab === t ? "border-b-2 border-accent font-medium" : "text-muted hover:text-fg"}`}>
            {t}
          </button>
        ))}
      </div>
      <div className="p-4">{tab === "structure" ? structure : explanation}</div>
    </>
  );
}

function FileList({ title, files, color }: { title: string; files: Iterable<string>; color?: string }) {
  const list = [...files].sort();
  return (
    <div>
      <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted">
        {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
        {title} <span className="tabular-nums">({list.length})</span>
      </h3>
      {list.length === 0 ? (
        <p className="text-xs text-muted">None.</p>
      ) : (
        <ul className="max-h-56 space-y-0.5 overflow-y-auto text-xs">
          {list.map((p) => (
            <li key={p}>
              <PathLink path={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReachButtons({ start, label }: { start: string[]; label: string }) {
  const { index, lens, setLens } = useMap();
  const run = (direction: "dependents" | "dependencies") => {
    const title = direction === "dependents" ? `Blast radius of ${label}` : `Dependency chain of ${label}`;
    if (lens?.kind === "reach" && lens.label === title) return setLens(null);
    setLens({ kind: "reach", direction, reach: reach(index, start, direction), label: title });
  };
  const active = lens?.kind === "reach" ? lens : null;
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button type="button" onClick={() => run("dependents")} className={`rounded border px-2 py-1 text-xs ${active?.direction === "dependents" ? "border-in bg-in/10" : "border-border hover:bg-panel-2"}`}>
          Blast radius
        </button>
        <button type="button" onClick={() => run("dependencies")} className={`rounded border px-2 py-1 text-xs ${active?.direction === "dependencies" ? "border-out bg-out/10" : "border-border hover:bg-panel-2"}`}>
          Dependency chain
        </button>
      </div>
      {active && (
        <div className="space-y-2 rounded border border-border p-2">
          <p className="text-xs text-muted">
            {active.direction === "dependents" ? "Files that import this, directly or through others: what may break if it changes." : "Files this imports, directly or through others."}
          </p>
          <FileList title="One step" files={active.reach.oneStep} />
          <FileList title="Two steps" files={active.reach.twoSteps} />
          <details>
            <summary className="cursor-pointer text-xs text-muted">Further out: {active.reach.furtherOut.length} more</summary>
            <FileList title="Three or more steps" files={active.reach.furtherOut} />
          </details>
        </div>
      )}
    </div>
  );
}

function FileDetail({ path, explain }: { path: string; explain?: ExplainSlot }) {
  const { index, data } = useMap();
  const f = index.files.get(path);
  if (!f) return <p className="p-4 text-xs text-muted">Not in this map.</p>;
  const notes = data.map.unresolved.filter((u) => u.from === path && u.status !== "external");
  const pkgs = [...new Set(data.map.unresolved.filter((u) => u.from === path && u.status === "external").map((u) => u.pkg!))].sort();
  const roleLabels = f.roles.map((r) => data.map.framework.roles[r] ?? r);
  return (
    <div>
      <div className="space-y-1 px-4 pt-4">
        <h2 className="break-all font-mono text-sm font-semibold">{path}</h2>
      </div>
      <SubTabs
        structure={
          <div className="space-y-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted">Kind</dt>
              <dd>{KIND[f.ext] ?? f.ext}</dd>
              <dt className="text-muted">Folder</dt>
              <dd className="font-mono">{f.module}</dd>
              <dt className="text-muted">Lines</dt>
              <dd className="tabular-nums">{f.lines.toLocaleString()}</dd>
              <dt className="text-muted">Roles</dt>
              <dd>{roleLabels.length ? roleLabels.join(", ") : "None by rule"}</dd>
              {f.entry && (
                <>
                  <dt className="text-muted">Entry</dt>
                  <dd>Reached by the framework or tooling without an import</dd>
                </>
              )}
            </dl>
            <ReachButtons start={[path]} label={path} />
            <FileList title="Imports" files={index.out.get(path) ?? []} color="var(--out)" />
            <FileList title="Imported by" files={index.in.get(path) ?? []} color="var(--in)" />
            {pkgs.length > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-semibold text-muted">External packages ({pkgs.length})</h3>
                <p className="font-mono text-xs">{pkgs.join(", ")}</p>
              </div>
            )}
            {notes.length > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-semibold text-muted">Imports not drawn ({notes.length})</h3>
                <ul className="space-y-1 text-xs">
                  {notes.map((u, i) => (
                    <li key={i}>
                      <code>{u.specifier}</code> <span className="text-muted">line {u.line}</span>
                      <div className="text-muted">{u.reason}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        }
        explanation={explain ? explain({ kind: "file", path }) : <p className="text-xs text-muted">Explanations are not configured for this deployment.</p>}
      />
    </div>
  );
}

function ModuleDetail({ module, explain }: { module: string; explain?: ExplainSlot }) {
  const { index } = useMap();
  const files = index.modules.get(module) ?? [];
  const own = new Set(files);
  const kinds: Record<string, number> = {};
  for (const p of files) {
    const k = KIND[index.files.get(p)!.ext] ?? "other";
    kinds[k] = (kinds[k] ?? 0) + 1;
  }
  const importers = new Set<string>();
  const imports = new Set<string>();
  for (const p of files) {
    index.in.get(p)?.forEach((x) => !own.has(x) && importers.add(x));
    index.out.get(p)?.forEach((x) => !own.has(x) && imports.add(x));
  }
  return (
    <div>
      <div className="px-4 pt-4">
        <h2 className="break-all font-mono text-sm font-semibold">{module === "." ? "(root)" : module}/</h2>
      </div>
      <SubTabs
        structure={
          <div className="space-y-4">
            <div>
              <h3 className="mb-1 text-xs font-semibold text-muted">File kinds ({files.length} files)</h3>
              <ul className="text-xs">
                {Object.entries(kinds)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, n]) => (
                    <li key={k} className="flex justify-between">
                      <span>{k}</span>
                      <span className="tabular-nums text-muted">{n}</span>
                    </li>
                  ))}
              </ul>
            </div>
            <ReachButtons start={files} label={`${module}/`} />
            <FileList title="Imports from other folders" files={imports} color="var(--out)" />
            <FileList title="Imported by other folders" files={importers} color="var(--in)" />
          </div>
        }
        explanation={explain ? explain({ kind: "module", module }) : <p className="text-xs text-muted">Explanations are not configured for this deployment.</p>}
      />
    </div>
  );
}
