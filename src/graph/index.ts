// Pure graph math over a parsed map. Runs in the browser and on the server.
// Imports only types from the parser, never its runtime (file-system) code.
import type { Edge, FileNode, ParseResult } from "@/parser/types";

export interface GraphIndex {
  files: Map<string, FileNode>;
  out: Map<string, Set<string>>;
  in: Map<string, Set<string>>;
  /** runtime-only adjacency (type-only imports removed), for cycles */
  runtimeOut: Map<string, Set<string>>;
  modules: Map<string, string[]>;
}

export function buildIndex(map: Pick<ParseResult, "files" | "edges">): GraphIndex {
  const files = new Map(map.files.map((f) => [f.path, f]));
  const out = new Map<string, Set<string>>();
  const inn = new Map<string, Set<string>>();
  const runtimeOut = new Map<string, Set<string>>();
  const modules = new Map<string, string[]>();
  for (const f of map.files) {
    out.set(f.path, new Set());
    inn.set(f.path, new Set());
    runtimeOut.set(f.path, new Set());
    const list = modules.get(f.module) ?? [];
    list.push(f.path);
    modules.set(f.module, list);
  }
  for (const e of map.edges) {
    if (e.from === e.to || !files.has(e.from) || !files.has(e.to)) continue;
    out.get(e.from)!.add(e.to);
    inn.get(e.to)!.add(e.from);
    if (!e.typeOnly) runtimeOut.get(e.from)!.add(e.to);
  }
  return { files, out, in: inn, runtimeOut, modules };
}

export interface Reach {
  /** start set (a file, or every file of a folder) */
  start: string[];
  /** files exactly one step away */
  oneStep: string[];
  /** files exactly two steps away */
  twoSteps: string[];
  /** files three or more steps away */
  furtherOut: string[];
  total: number;
}

/**
 * Breadth-first reach. "dependents" = who imports this, transitively
 * (blast radius: what may break if it changes). "dependencies" = what this
 * imports, transitively (dependency chain).
 */
export function reach(index: GraphIndex, start: string | string[], direction: "dependents" | "dependencies"): Reach {
  const adj = direction === "dependents" ? index.in : index.out;
  const starts = (Array.isArray(start) ? start : [start]).filter((s) => index.files.has(s));
  const dist = new Map<string, number>(starts.map((s) => [s, 0]));
  let frontier = starts;
  let d = 0;
  while (frontier.length) {
    d++;
    const next: string[] = [];
    for (const f of frontier) {
      for (const n of adj.get(f) ?? []) {
        if (!dist.has(n)) {
          dist.set(n, d);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  const by = (pred: (x: number) => boolean) =>
    [...dist.entries()].filter(([, v]) => v > 0 && pred(v)).map(([k]) => k).sort();
  const oneStep = by((v) => v === 1);
  const twoSteps = by((v) => v === 2);
  const furtherOut = by((v) => v >= 3);
  return { start: starts, oneStep, twoSteps, furtherOut, total: oneStep.length + twoSteps.length + furtherOut.length };
}

/** Strongly connected components with more than one file (runtime imports only). Iterative Tarjan. */
export function findCycles(index: GraphIndex): string[][] {
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  let counter = 0;
  for (const root of [...index.files.keys()].sort()) {
    if (idx.has(root)) continue;
    const work: { node: string; it: Iterator<string> }[] = [];
    const push = (n: string) => {
      idx.set(n, counter);
      low.set(n, counter);
      counter++;
      stack.push(n);
      onStack.add(n);
      work.push({ node: n, it: (index.runtimeOut.get(n) ?? new Set<string>()).values() });
    };
    push(root);
    while (work.length) {
      const top = work[work.length - 1];
      const nx = top.it.next();
      if (!nx.done) {
        const w = nx.value;
        if (!idx.has(w)) push(w);
        else if (onStack.has(w)) low.set(top.node, Math.min(low.get(top.node)!, idx.get(w)!));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].node;
        low.set(parent, Math.min(low.get(parent)!, low.get(top.node)!));
      }
      if (low.get(top.node) === idx.get(top.node)) {
        const comp: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          comp.push(w);
        } while (w !== top.node);
        if (comp.length > 1) result.push(comp.sort());
      }
    }
  }
  return result.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

export const LARGE_FILE_LINES = 500;

export interface Insights {
  cycles: string[][];
  /** parsed files nothing imports and that no framework rule reaches. Not "unused": the graph can't know. */
  notImported: string[];
  heavyFanIn: { path: string; fanIn: number }[];
  largeFiles: { path: string; lines: number }[];
}

export function insights(index: GraphIndex): Insights {
  const files = [...index.files.values()];
  const fanIns = files.map((f) => f.fanIn).sort((a, b) => a - b);
  const p95 = fanIns[Math.floor(fanIns.length * 0.95)] ?? 0;
  const threshold = Math.max(10, p95);
  return {
    cycles: findCycles(index),
    notImported: files.filter((f) => f.fanIn === 0 && !f.entry).map((f) => f.path).sort(),
    heavyFanIn: files
      .filter((f) => f.fanIn >= threshold)
      .sort((a, b) => b.fanIn - a.fanIn || a.path.localeCompare(b.path))
      .slice(0, 25)
      .map((f) => ({ path: f.path, fanIn: f.fanIn })),
    largeFiles: files
      .filter((f) => f.lines >= LARGE_FILE_LINES)
      .sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path))
      .slice(0, 25)
      .map((f) => ({ path: f.path, lines: f.lines })),
  };
}

export interface RepoSummary {
  files: number;
  edges: number;
  lines: number;
  mostDependedOn: { path: string; fanIn: number }[];
  nothingImports: number;
}

export function summary(index: GraphIndex, edges: Edge[]): RepoSummary {
  const files = [...index.files.values()];
  return {
    files: files.length,
    edges: edges.length,
    lines: files.reduce((s, f) => s + f.lines, 0),
    mostDependedOn: files
      .filter((f) => f.fanIn > 0)
      .sort((a, b) => b.fanIn - a.fanIn || a.path.localeCompare(b.path))
      .slice(0, 8)
      .map((f) => ({ path: f.path, fanIn: f.fanIn })),
    nothingImports: files.filter((f) => f.fanIn === 0 && !f.entry).length,
  };
}

/** Folder-level edges with counts, for the folded map. */
export function moduleEdges(index: GraphIndex): { from: string; to: string; count: number }[] {
  const m = new Map<string, number>();
  for (const [from, tos] of index.out) {
    const fm = index.files.get(from)!.module;
    for (const to of tos) {
      const tm = index.files.get(to)!.module;
      if (fm === tm) continue;
      const k = `${fm}\u0000${tm}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
  }
  return [...m.entries()].map(([k, count]) => {
    const [from, to] = k.split("\u0000");
    return { from, to, count };
  });
}
