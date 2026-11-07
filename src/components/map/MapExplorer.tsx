"use client";

import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { buildIndex } from "@/graph";
import { Canvas } from "./Canvas";
import { MapCtx, type MapState } from "./context";
import { DetailPane, type ExplainSlot } from "./DetailPane";
import { computeHighlight, moduleFanIn, type Lens, type MapData, type Selection } from "./model";
import { Rail } from "./Rail";

/**
 * Three columns: rail, map, detail pane. Everything after the first render is
 * computed in the browser from the stored map: selecting fires no requests.
 */
export function MapExplorer({ data, explain, ask }: { data: MapData; explain?: ExplainSlot; ask?: ReactNode }) {
  const index = useMemo(() => buildIndex(data.map), [data]);
  const fanIn = useMemo(() => moduleFanIn(index), [index]);
  const [selection, setSelection] = useState<Selection>(null);
  const [lens, setLensState] = useState<Lens>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [reveal, setReveal] = useState<{ module: string; n: number } | null>(null);

  const expand = useCallback((m: string) => setExpanded((s) => (s.has(m) ? s : new Set(s).add(m))), []);

  const selectFile = useCallback(
    (path: string, opts?: { reveal?: boolean }) => {
      const node = index.files.get(path);
      if (!node) return;
      if (opts?.reveal) {
        expand(node.module);
        setSelection({ kind: "file", path });
        setReveal((r) => ({ module: node.module, n: (r?.n ?? 0) + 1 }));
        return;
      }
      setLensState((l) => (l?.kind === "role" ? l : null));
      setSelection((s) => (s?.kind === "file" && s.path === path ? null : { kind: "file", path }));
      expand(node.module);
    },
    [index, expand],
  );

  const selectModule = useCallback((m: string) => {
    setLensState((l) => (l?.kind === "role" ? l : null));
    setSelection((s) => (s?.kind === "module" && s.module === m ? null : { kind: "module", module: m }));
  }, []);

  const toggleModule = useCallback(
    (m: string) => {
      if (expanded.has(m)) {
        setExpanded((s) => {
          const n = new Set(s);
          n.delete(m);
          return n;
        });
        // folding the panel that holds the selection clears it
        setSelection((s) => {
          if (!s) return s;
          if (s.kind === "module" && s.module === m) return null;
          if (s.kind === "file" && index.files.get(s.path)?.module === m) return null;
          return s;
        });
      } else {
        expand(m);
        setLensState((l) => (l?.kind === "role" ? l : null));
        setSelection({ kind: "module", module: m });
      }
    },
    [expanded, expand, index],
  );

  const clear = useCallback(() => {
    setSelection(null);
    setLensState(null);
  }, []);

  const setLens = useCallback((l: Lens) => {
    setLensState(l);
    if (l?.kind === "role" || l?.kind === "files") setSelection(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && clear();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clear]);

  const highlight = useMemo(() => computeHighlight(index, selection, lens), [index, selection, lens]);

  const state: MapState = {
    data,
    index,
    selection,
    lens,
    highlight,
    expanded,
    moduleFanIn: fanIn,
    selectFile,
    selectModule,
    toggleModule,
    setLens,
    clear,
  };

  return (
    <MapCtx.Provider value={state}>
      <ReactFlowProvider>
        <div className="grid h-full min-h-0 grid-cols-[240px_1fr_360px] grid-rows-[minmax(0,1fr)]">
          <Rail />
          <main className="relative min-h-0" aria-label="Map">
            {lens && (
              <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded border border-border bg-panel px-2 py-1 text-xs shadow">
                <span>{lens.label}</span>
                <button type="button" className="text-muted hover:text-fg" onClick={() => setLensState(null)} aria-label="Clear filter">
                  ✕
                </button>
              </div>
            )}
            <Canvas reveal={reveal} />
          </main>
          <DetailPane explain={explain} ask={ask} />
        </div>
      </ReactFlowProvider>
    </MapCtx.Provider>
  );
}
