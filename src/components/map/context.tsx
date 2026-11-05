"use client";

import { createContext, useContext } from "react";
import type { GraphIndex } from "@/graph";
import type { Highlight, Lens, MapData, Selection } from "./model";

export interface MapState {
  data: MapData;
  index: GraphIndex;
  selection: Selection;
  lens: Lens;
  highlight: Highlight;
  expanded: Set<string>;
  moduleFanIn: Map<string, number>;
  selectFile: (path: string, opts?: { reveal?: boolean }) => void;
  selectModule: (module: string) => void;
  toggleModule: (module: string) => void;
  setLens: (lens: Lens) => void;
  clear: () => void;
}

export const MapCtx = createContext<MapState | null>(null);

export function useMap(): MapState {
  const v = useContext(MapCtx);
  if (!v) throw new Error("useMap outside MapExplorer");
  return v;
}
