import type { GraphIndex, Reach } from "@/graph";
import type { ParseResult } from "@/parser/types";

/** What the browser receives: the stored map plus where it came from. */
export interface MapData {
  repo: { owner: string; name: string; ref: string | null; url: string } | null;
  map: ParseResult;
}

export type Selection = { kind: "file"; path: string } | { kind: "module"; module: string } | null;

export type Lens =
  | { kind: "role"; role: string; label: string }
  | { kind: "reach"; direction: "dependents" | "dependencies"; reach: Reach; label: string }
  | { kind: "files"; files: string[]; label: string }
  | null;

export interface Highlight {
  /** null = nothing dimmed */
  files: Set<string> | null;
  modules: Set<string> | null;
  /** files that import the selection (green) */
  inFiles: Set<string>;
  /** files the selection imports (amber) */
  outFiles: Set<string>;
  /** steps from the start, for reach lenses */
  distance: Map<string, number> | null;
  /** the selected file, the selected folder's files, or the reach start */
  center: Set<string>;
}

const EMPTY = new Set<string>();

export function computeHighlight(index: GraphIndex, selection: Selection, lens: Lens): Highlight {
  const modulesOf = (files: Iterable<string>) => {
    const m = new Set<string>();
    for (const f of files) {
      const node = index.files.get(f);
      if (node) m.add(node.module);
    }
    return m;
  };

  if (lens?.kind === "reach") {
    const r = lens.reach;
    const distance = new Map<string, number>();
    r.start.forEach((f) => distance.set(f, 0));
    r.oneStep.forEach((f) => distance.set(f, 1));
    r.twoSteps.forEach((f) => distance.set(f, 2));
    r.furtherOut.forEach((f) => distance.set(f, 3));
    const files = new Set(distance.keys());
    const inFiles = lens.direction === "dependents" ? new Set([...files].filter((f) => !r.start.includes(f))) : EMPTY;
    const outFiles = lens.direction === "dependencies" ? new Set([...files].filter((f) => !r.start.includes(f))) : EMPTY;
    return { files, modules: modulesOf(files), inFiles, outFiles, distance, center: new Set(r.start) };
  }

  if (selection?.kind === "file" && index.files.has(selection.path)) {
    const inFiles = index.in.get(selection.path) ?? EMPTY;
    const outFiles = index.out.get(selection.path) ?? EMPTY;
    const files = new Set([selection.path, ...inFiles, ...outFiles]);
    return { files, modules: modulesOf(files), inFiles, outFiles, distance: null, center: new Set([selection.path]) };
  }

  if (selection?.kind === "module") {
    const own = index.modules.get(selection.module) ?? [];
    const ownSet = new Set(own);
    const inFiles = new Set<string>();
    const outFiles = new Set<string>();
    for (const f of own) {
      index.in.get(f)?.forEach((x) => !ownSet.has(x) && inFiles.add(x));
      index.out.get(f)?.forEach((x) => !ownSet.has(x) && outFiles.add(x));
    }
    const files = new Set([...own, ...inFiles, ...outFiles]);
    return { files, modules: modulesOf(files), inFiles, outFiles, distance: null, center: ownSet };
  }

  if (lens?.kind === "role") {
    const files = new Set([...index.files.values()].filter((f) => f.roles.includes(lens.role)).map((f) => f.path));
    return { files, modules: modulesOf(files), inFiles: EMPTY, outFiles: EMPTY, distance: null, center: EMPTY };
  }
  if (lens?.kind === "files") {
    const files = new Set(lens.files);
    return { files, modules: modulesOf(files), inFiles: EMPTY, outFiles: EMPTY, distance: null, center: EMPTY };
  }
  return { files: null, modules: null, inFiles: EMPTY, outFiles: EMPTY, distance: null, center: EMPTY };
}

/** Distinct cross-module importers of a module's files: what the folded node's height carries. */
export function moduleFanIn(index: GraphIndex): Map<string, number> {
  const res = new Map<string, number>();
  for (const [mod, files] of index.modules) {
    const importers = new Set<string>();
    for (const f of files) index.in.get(f)?.forEach((x) => index.files.get(x)!.module !== mod && importers.add(x));
    res.set(mod, importers.size);
  }
  return res;
}

export function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}
