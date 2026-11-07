"use client";

import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Edge as FlowEdge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useState } from "react";
import { moduleEdges } from "@/graph";
import { useMap } from "./context";
import { FOLDED_WIDTH, foldedHeight, layoutModules } from "./layout";
import { ModuleNode, type ModuleNodeType } from "./ModuleNode";

const nodeTypes: NodeTypes = { module: ModuleNode };

export function Canvas({ reveal }: { reveal: { module: string; n: number } | null }) {
  const { index, highlight, expanded, moduleFanIn, clear } = useMap();
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }> | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const flow = useReactFlow();

  const mEdges = useMemo(() => moduleEdges(index), [index]);
  const modules = useMemo(() => [...index.modules.keys()].sort(), [index]);

  useEffect(() => {
    let cancelled = false;
    const sized = modules.map((m) => ({ id: m, width: FOLDED_WIDTH, height: foldedHeight(moduleFanIn.get(m) ?? 0) }));
    layoutModules(sized, mEdges)
      .then((p) => !cancelled && setPositions(p))
      .catch((e: Error) => !cancelled && setLayoutError(e.message));
    return () => {
      cancelled = true;
    };
  }, [modules, mEdges, moduleFanIn]);

  useEffect(() => {
    if (!reveal || !positions) return;
    const p = positions.get(reveal.module);
    if (p) flow.setCenter(p.x + 160, p.y + 120, { zoom: Math.max(flow.getZoom(), 0.9), duration: 300 });
  }, [reveal, positions, flow]);

  const nodes: ModuleNodeType[] = useMemo(() => {
    if (!positions) return [];
    return modules.map((m) => ({
      id: m,
      type: "module" as const,
      position: positions.get(m) ?? { x: 0, y: 0 },
      data: { module: m },
      draggable: false,
      selectable: false,
      connectable: false,
      // an open panel sits above neighbours and above the edges
      zIndex: expanded.has(m) ? 1000 : 1,
    }));
  }, [positions, modules, expanded]);

  const edges: FlowEdge[] = useMemo(() => {
    // Which module pairs carry a highlighted file-level import, and in which direction.
    const colour = new Map<string, "in" | "out">();
    if (highlight.files) {
      const add = (from: string, to: string, kind: "in" | "out") => {
        const a = index.files.get(from)!.module;
        const b = index.files.get(to)!.module;
        if (a !== b) colour.set(`${a}\u0000${b}`, kind);
      };
      if (highlight.distance) {
        const dist = highlight.distance;
        const dependents = highlight.inFiles.size > 0;
        for (const [u, du] of dist) {
          for (const v of index.out.get(u) ?? []) {
            const dv = dist.get(v);
            if (dv === undefined) continue;
            // only edges that step one level outward from the start
            if (dependents && (du === dv + 1 || (du === 3 && dv >= 2))) add(u, v, "in");
            if (!dependents && (dv === du + 1 || (dv === 3 && du >= 2))) add(u, v, "out");
          }
        }
      } else {
        for (const x of highlight.inFiles) for (const to of index.out.get(x) ?? []) if (highlight.center.has(to)) add(x, to, "in");
        for (const c of highlight.center) for (const y of index.out.get(c) ?? []) if (highlight.outFiles.has(y)) add(c, y, "out");
      }
    }
    return mEdges.map((e) => {
      const key = `${e.from}\u0000${e.to}`;
      const c = colour.get(key);
      const bothBright = !highlight.modules || (highlight.modules.has(e.from) && highlight.modules.has(e.to));
      const stroke = c === "in" ? "var(--in)" : c === "out" ? "var(--out)" : "var(--edge)";
      const opacity = c ? 0.95 : !highlight.modules ? 0.45 : bothBright && !colour.size ? 0.5 : 0.06;
      return {
        id: key,
        source: e.from,
        target: e.to,
        type: "default",
        zIndex: 0,
        style: { stroke, strokeWidth: c ? 1.6 : Math.min(0.6 + Math.log2(e.count) * 0.25, 1.4), opacity },
        markerEnd: c ? { type: MarkerType.ArrowClosed, color: stroke, width: 14, height: 14 } : undefined,
        focusable: false,
        selectable: false,
      } satisfies FlowEdge;
    });
  }, [mEdges, highlight, index]);

  if (layoutError) return <div className="p-6 text-sm text-warn">Layout failed: {layoutError}</div>;
  if (!positions) return <div className="grid h-full place-items-center text-sm text-muted">Laying out {modules.length} folders…</div>;

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onPaneClick={clear}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      onlyRenderVisibleElements
      fitView
      fitViewOptions={{ padding: 0.05, minZoom: 0.25 }}
      minZoom={0.05}
      maxZoom={2}
      proOptions={{ hideAttribution: false }}
    >
      <Background gap={24} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeColor="var(--edge)" maskColor="rgba(0,0,0,0.08)" />
    </ReactFlow>
  );
}
