"use client";

import { MapExplorer } from "@/components/map/MapExplorer";
import type { MapData } from "@/components/map/model";

/** Client wrapper: later phases plug Explain and Ask into the map here. */
export function AnalysisMap({ data }: { analysisId: string; data: MapData }) {
  return <MapExplorer data={data} />;
}
