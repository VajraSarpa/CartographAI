import Link from "next/link";
import { Suspense } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { requireOrg } from "@/server/session";
import { userDb } from "@/server/supabase";
import { AnalyzeForm } from "./AnalyzeForm";

export const metadata = { title: "Dashboard" };
export const maxDuration = 300; // the analyze action runs the pipeline after responding

const STATUS: Record<string, string> = { queued: "Queued", running: "Running", succeeded: "Ready", failed: "Failed" };
const STATUS_CLASS: Record<string, string> = {
  queued: "text-muted",
  running: "text-accent",
  succeeded: "text-in",
  failed: "text-warn",
};

interface Row {
  id: string;
  status: string;
  framework: string | null;
  stats: { filesParsed?: number; edges?: number } | null;
  updated_at: string;
  repositories: { owner: string; name: string } | null;
}

async function Analyses() {
  const session = await requireOrg();
  // No org filter here on purpose: the database policy decides what this member sees.
  const { data, error } = await userDb()
    .from("analyses")
    .select("id, status, framework, stats, updated_at, repositories(owner, name)")
    .order("updated_at", { ascending: false })
    .limit(100)
    .returns<Row[]>();
  if (error) throw new Error(`Could not load analyses: ${error.message}`);
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-muted">{session.orgName} · analyses</h2>
      {!data?.length ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">
          No analyses yet. Paste a public repository above to draw its first map.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-panel">
          {data.map((a) => (
            <li key={a.id}>
              <Link href={`/analyses/${a.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-panel-2">
                <span className="min-w-0 flex-1 truncate font-mono text-sm">
                  {a.repositories ? `${a.repositories.owner}/${a.repositories.name}` : "unknown"}
                </span>
                <span className="hidden text-xs text-muted sm:inline">{a.framework ?? ""}</span>
                <span className="hidden text-xs tabular-nums text-muted sm:inline">
                  {a.stats?.filesParsed != null ? `${a.stats.filesParsed} files · ${a.stats.edges} imports` : ""}
                </span>
                <span className={`w-16 text-right text-xs font-medium ${STATUS_CLASS[a.status] ?? ""}`}>{STATUS[a.status] ?? a.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function Form({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const url = typeof sp.url === "string" ? sp.url.slice(0, 300) : "";
  return <AnalyzeForm autoFocus initialUrl={url} />;
}

export default function DashboardPage(props: PageProps<"/dashboard">) {
  return (
    <AppShell>
      <main className="mx-auto max-w-3xl space-y-8 px-6 py-10">
        <Suspense fallback={<AnalyzeForm />}>
          <Form searchParams={props.searchParams} />
        </Suspense>
        <Suspense fallback={<p className="text-sm text-muted">Loading analyses…</p>}>
          <Analyses />
        </Suspense>
      </main>
    </AppShell>
  );
}
