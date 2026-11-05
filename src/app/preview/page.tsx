// TEMPORARY dev-only preview (removed in the pipeline phase): renders a map
// parsed to .preview/map.json with `pnpm parse <dir> --json .preview/map.json`.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MapExplorer } from "@/components/map/MapExplorer";
import type { ParseResult } from "@/parser/types";

async function Preview() {
  await connection();
  if (process.env.NODE_ENV !== "development") notFound();
  let map: ParseResult;
  try {
    map = JSON.parse(await readFile(path.join(process.cwd(), ".preview", "map.json"), "utf8"));
  } catch {
    return <p className="p-6 text-sm">No preview map. Run <code>pnpm parse . --json .preview/map.json</code>.</p>;
  }
  return <MapExplorer data={{ repo: null, map }} />;
}

export default function PreviewPage() {
  return (
    <div className="h-screen">
      <Suspense fallback={<p className="p-6 text-sm">Loading map…</p>}>
        <Preview />
      </Suspense>
    </div>
  );
}
