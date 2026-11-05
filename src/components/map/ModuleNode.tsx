"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo, useEffect, useRef } from "react";
import { useMap } from "./context";
import { EXPANDED_WIDTH, FOLDED_WIDTH, foldedHeight, MAX_VISIBLE_ROWS, ROW_HEIGHT } from "./layout";
import { basename } from "./model";

export type ModuleNodeType = Node<{ module: string }, "module">;

const NO_FILES: string[] = [];

function ModuleNodeImpl({ data }: NodeProps<ModuleNodeType>) {
  const { index, highlight, selection, expanded, moduleFanIn, toggleModule, selectFile } = useMap();
  const mod = data.module;
  const files = index.modules.get(mod) ?? NO_FILES;
  const isOpen = expanded.has(mod);
  const fanIn = moduleFanIn.get(mod) ?? 0;
  const dim = highlight.modules !== null && !highlight.modules.has(mod);
  const selected = selection?.kind === "module" && selection.module === mod;
  const hasSelectedFile = selection?.kind === "file" && index.files.get(selection.path)?.module === mod;
  const label = mod === "." ? "(root)" : mod;
  const listRef = useRef<HTMLUListElement>(null);
  const selectedPath = selection?.kind === "file" ? selection.path : null;

  // keep the selected row visible inside the scrolling panel (scrolls the list only, not the page)
  useEffect(() => {
    if (!isOpen || !selectedPath || !listRef.current) return;
    const i = files.indexOf(selectedPath);
    if (i < 0) return;
    const list = listRef.current;
    const top = i * ROW_HEIGHT;
    if (top < list.scrollTop || top > list.scrollTop + list.clientHeight - ROW_HEIGHT) {
      list.scrollTop = Math.max(0, top - list.clientHeight / 2);
    }
  }, [isOpen, selectedPath, files]);

  return (
    <div
      className={`rounded-lg border bg-panel shadow-sm transition-opacity ${
        selected || hasSelectedFile ? "border-accent ring-2 ring-accent/30" : "border-border"
      }`}
      style={{
        width: isOpen ? EXPANDED_WIDTH : FOLDED_WIDTH,
        height: isOpen ? undefined : foldedHeight(fanIn),
        opacity: dim ? 0.25 : 1,
      }}
      data-testid={`module-${mod}`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Handle type="source" position={Position.Right} isConnectable={false} />
      <button
        type="button"
        className="nodrag flex w-full items-start gap-2 px-3 py-2 text-left"
        onClick={(e) => {
          e.stopPropagation();
          toggleModule(mod);
        }}
        aria-expanded={isOpen}
        title={label}
      >
        <span className="mt-0.5 text-xs text-muted">{isOpen ? "▾" : "▸"}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-xs font-medium" style={{ direction: "rtl", textAlign: "left" }}>
            {label}
          </span>
          <span className="block text-[11px] text-muted">
            {files.length} file{files.length === 1 ? "" : "s"} · imported by {fanIn}
          </span>
        </span>
      </button>
      {isOpen && (
        <ul
          ref={listRef}
          className="nowheel nodrag nopan overflow-y-auto border-t border-border py-1"
          style={{ maxHeight: MAX_VISIBLE_ROWS * ROW_HEIGHT + 8 }}
        >
          {files.map((f) => {
            const node = index.files.get(f)!;
            const isSel = selection?.kind === "file" && selection.path === f;
            const isIn = highlight.inFiles.has(f);
            const isOut = highlight.outFiles.has(f);
            const rowDim = highlight.files !== null && !highlight.files.has(f);
            const dist = highlight.distance?.get(f);
            return (
              <li key={f}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 px-3 text-left text-xs hover:bg-panel-2 ${isSel ? "bg-accent/15" : ""}`}
                  style={{ height: ROW_HEIGHT, opacity: rowDim ? 0.25 : 1 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectFile(f);
                  }}
                  title={f}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: isIn ? "var(--in)" : isOut ? "var(--out)" : isSel ? "var(--accent)" : "transparent" }}
                    aria-label={isIn ? "imports the selection" : isOut ? "imported by the selection" : undefined}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono">{basename(f)}</span>
                  {dist !== undefined && dist > 0 && <span className="text-[10px] text-muted">{dist >= 3 ? "3+" : dist}</span>}
                  <span className="text-[10px] tabular-nums text-muted" title="imported by">
                    ←{node.fanIn}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export const ModuleNode = memo(ModuleNodeImpl);
