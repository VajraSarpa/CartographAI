import { verifyAgentCredential } from "@/server/agent-credential";
import { loadForAgent, runAgentTool } from "@/server/agent-tools";

/**
 * Read-only tool endpoints for the Ask agent. No Clerk session: the caller
 * presents the short-lived agent credential, verified here and again by RLS.
 */
const TOOLS = new Set(["repo_overview", "find_files", "file_details", "blast_radius", "dependency_chain", "read_source"]);
const NOTHING = () => Response.json({ error: "not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request, ctx: RouteContext<"/api/agent/[tool]">) {
  const { tool } = await ctx.params;
  if (!TOOLS.has(tool)) return NOTHING();
  const token = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
  const claims = await verifyAgentCredential(token);
  if (!claims) return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const raw = await req.text();
  if (raw.length > 10_000) return Response.json({ error: "too large" }, { status: 413 });
  let body: Record<string, unknown> = {};
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const loaded = await loadForAgent(token, claims);
  if (!loaded) return NOTHING();
  const result = await runAgentTool(tool, loaded, body);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
