import { after } from "next/server";
import { z } from "zod";
import type { ParseResult } from "@/parser/types";
import { explain } from "@/server/ai/explain";
import { flushTraces } from "@/server/ai/client";
import { checkLimit, recordUsage } from "@/server/limits";
import { ensureOrgRow, requireOrg } from "@/server/session";
import { userDb } from "@/server/supabase";

export const maxDuration = 120;

const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: z.string().min(1).max(1000) }),
  z.object({ kind: z.literal("module"), module: z.string().min(1).max(1000) }),
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request, ctx: RouteContext<"/api/analyses/[id]/explain">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "not found" }, { status: 404 });
  const session = await requireOrg();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });

  // RLS decides whether this member can see the analysis and its map
  const db = userDb();
  const { data: a } = await db
    .from("analyses")
    .select("id, commit_sha, status, repositories(owner, name)")
    .eq("id", id)
    .maybeSingle<{ id: string; commit_sha: string | null; status: string; repositories: { owner: string; name: string } | null }>();
  if (!a || !a.repositories || a.status !== "succeeded") return Response.json({ error: "not found" }, { status: 404 });
  const { data: stored } = await db.from("analysis_maps").select("map").eq("analysis_id", id).maybeSingle<{ map: ParseResult }>();
  if (!stored) return Response.json({ error: "not found" }, { status: 404 });

  const target = parsed.data;
  const exists =
    target.kind === "file" ? stored.map.files.some((f) => f.path === target.path) : stored.map.files.some((f) => f.module === target.module);
  if (!exists) return Response.json({ error: "not in this map" }, { status: 404 });

  await ensureOrgRow(session);
  const limit = await checkLimit(session, "explain");
  if (!limit.ok) return Response.json({ error: limit.message }, { status: 429 });

  after(flushTraces);
  try {
    const result = await explain({ session, analysisId: id, repo: a.repositories, commitSha: a.commit_sha, map: stored.map, target });
    if (!result.cached) await recordUsage(session, "explain", { analysisId: id, inputTokens: result.usage?.input_tokens, outputTokens: result.usage?.output_tokens });
    return Response.json({
      content: result.content,
      cached: result.cached,
      inventedPaths: result.inventedPaths,
      model: result.model,
    });
  } catch (e) {
    console.error("[explain] failed", e);
    const msg = e instanceof Error && /declined|cut off|unexpected format/.test(e.message) ? e.message : "Could not explain this right now.";
    return Response.json({ error: msg }, { status: 502 });
  }
}
