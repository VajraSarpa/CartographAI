"use client";

import { Fragment, type ReactNode } from "react";
import { findPathMentions } from "@/lib/paths";
import { useMap } from "./context";
import { PathLink } from "./PathLink";

const NONE = new Set<string>();

/** Renders text with known paths as links and unknown paths flagged. No HTML injection: plain React nodes only. */
export function RichText({ text, invented = NONE }: { text: string; invented?: Set<string> }) {
  const { index } = useMap();
  const renderInline = (s: string, key: string): ReactNode[] => {
    const out: ReactNode[] = [];
    const parts = s.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g);
    parts.forEach((p, i) => {
      const k = `${key}-${i}`;
      if (p.startsWith("`") && p.endsWith("`")) {
        const inner = p.slice(1, -1).replace(/:\d+(?::\d+)?$/, "");
        if (index.files.has(inner)) out.push(<PathLink key={k} path={inner} />);
        else if (invented.has(inner) || findPathMentions(p).some((m) => invented.has(m)))
          out.push(
            <span key={k} className="font-mono text-warn line-through" title="Not in the map: the model named a path it was not shown">
              {inner}
            </span>,
          );
        else out.push(<code key={k} className="rounded bg-panel-2 px-1 font-mono text-[0.9em]">{inner}</code>);
      } else if (p.startsWith("**") && p.endsWith("**")) out.push(<strong key={k}>{renderInline(p.slice(2, -2), k)}</strong>);
      else if (p) out.push(<Fragment key={k}>{p}</Fragment>);
    });
    return out;
  };
  // A block may mix prose and bullets ("Its exports:\n- a\n- b"), so split each
  // block into runs of bullet lines (a list) and runs of other lines (a paragraph).
  const BULLET = /^\s*[-*]\s+/;
  const runs: { list: boolean; lines: string[] }[] = [];
  for (const block of text.split(/\n{2,}/)) {
    let prev: { list: boolean; lines: string[] } | null = null;
    for (const line of block.split("\n")) {
      if (!line.trim()) continue;
      const list = BULLET.test(line);
      if (prev && prev.list === list) prev.lines.push(line);
      else runs.push((prev = { list, lines: [line] }));
    }
  }
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {runs.map((r, i) =>
        r.list ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {r.lines.map((l, j) => (
              <li key={j}>{renderInline(l.replace(BULLET, ""), `${i}-${j}`)}</li>
            ))}
          </ul>
        ) : (
          <p key={i} className="whitespace-pre-line">{renderInline(r.lines.join("\n"), String(i))}</p>
        ),
      )}
    </div>
  );
}
