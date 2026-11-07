"use client";

import { useMap } from "./context";

/** A repo path that selects the file on the map (and opens its folder). Unknown paths render as plain text. */
export function PathLink({ path, label }: { path: string; label?: string }) {
  const { index, selectFile } = useMap();
  if (!index.files.has(path)) return <span className="font-mono text-muted">{label ?? path}</span>;
  return (
    <button
      type="button"
      className="max-w-full truncate text-left font-mono text-accent hover:underline"
      onClick={() => selectFile(path, { reveal: true })}
      title={path}
    >
      {label ?? path}
    </button>
  );
}
