import { AGENT_TOOLS, callAgentTool } from "@/server/agent-tools";

/**
 * Read-only tool endpoints for a standalone Ask agent (AGENT_URL set). No
 * Clerk session: the caller presents the short-lived agent credential,
 * verified in callAgentTool and again by RLS. The in-process agent calls
 * callAgentTool directly instead.
 */
const headers = { "Cache-Control": "no-store" };

export async function POST(req: Request, ctx: RouteContext<"/api/agent/[tool]">) {
  const { tool } = await ctx.params;
  if (!AGENT_TOOLS.has(tool)) return Response.json({ error: "not found" }, { status: 404, headers });
  const token = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
  const raw = await req.text();
  if (raw.length > 10_000) return Response.json({ error: "too large" }, { status: 413, headers });
  let body: Record<string, unknown> = {};
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return Response.json({ error: "bad json" }, { status: 400, headers });
  }
  const result = await callAgentTool(tool, token, body);
  return Response.json(result.body, { status: result.status, headers });
}
