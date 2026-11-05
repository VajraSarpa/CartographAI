import type { ElkNode } from "elkjs/lib/elk-api";

export const FOLDED_WIDTH = 220;
export const EXPANDED_WIDTH = 320;
export const ROW_HEIGHT = 26;
export const HEADER_HEIGHT = 44;
export const MAX_VISIBLE_ROWS = 14;

/** Folded height grows with fan-in (log scale, capped) so busy folders stand out. */
export function foldedHeight(fanIn: number): number {
  return Math.round(HEADER_HEIGHT + Math.min(84, 14 * Math.log2(1 + fanIn)));
}

export function expandedHeight(rows: number): number {
  return HEADER_HEIGHT + Math.min(rows, MAX_VISIBLE_ROWS) * ROW_HEIGHT + 10;
}

let elkPromise: Promise<{ layout: (g: ElkNode) => Promise<ElkNode> }> | null = null;
function elk() {
  elkPromise ??= import("elkjs/lib/elk.bundled.js").then((m) => new m.default());
  return elkPromise;
}

/**
 * Deterministic layered layout of folded folders. Computed once per map;
 * expanding a folder opens a panel in place (above its neighbours) instead of
 * re-flowing the whole map, so nothing jumps under the cursor.
 */
export async function layoutModules(
  nodes: { id: string; width: number; height: number }[],
  edges: { from: string; to: string }[],
): Promise<Map<string, { x: number; y: number }>> {
  const engine = await elk();
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.randomSeed": "1",
      "elk.spacing.nodeNode": "28",
      "elk.layered.spacing.nodeNodeBetweenLayers": "70",
      "elk.layered.wrapping.strategy": "MULTI_EDGE",
      "elk.layered.compaction.postCompaction.strategy": "EDGE_LENGTH",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.separateConnectedComponents": "true",
      "elk.spacing.componentComponent": "60",
      "elk.aspectRatio": "1.6",
    },
    children: nodes.map((n) => ({ id: n.id, width: n.width, height: n.height })),
    edges: edges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
  };
  const out = await engine.layout(graph);
  const pos = new Map<string, { x: number; y: number }>();
  for (const c of out.children ?? []) pos.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
  return pos;
}
