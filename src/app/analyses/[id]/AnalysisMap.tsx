"use client";

import { AskPanel } from "@/components/map/AskPanel";
import { ExplainPanel } from "@/components/map/ExplainPanel";
import { MapExplorer } from "@/components/map/MapExplorer";
import type { MapData } from "@/components/map/model";

export function AnalysisMap({ analysisId, data }: { analysisId: string; data: MapData }) {
  return (
    <MapExplorer
      data={data}
      explain={(target) => <ExplainPanel analysisId={analysisId} target={target} />}
      ask={<AskPanel analysisId={analysisId} />}
    />
  );
}
