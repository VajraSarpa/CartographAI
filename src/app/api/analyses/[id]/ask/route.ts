import { z } from "zod";
import { serverEnv } from "@/lib/env";
import { mintAgentCredential } from "@/server/agent-credential";
import { checkLimit, recordUsage } from "@/server/limits";
import { ensureOrgRow, requireOrg } from "@/server/session";
import { userDb } from "@/server/supabase";

export const maxDuration = 300;

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(12)
    .refine((m) => m[m.length - 1].role === "user", "last message must be the question"),
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LcMessage = { type?: string; content?: unknown; tool_calls?: { name: string; args: unknown; id?: string }[]; name?: string; tool_call_id?: string };

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : "")).join("");
  return "";
}

/**
 * Relays one question to the agent service and streams NDJSON events:
 * {type:"tool_call"}, {type:"tool_result"}, {type:"answer"}, {type:"error"}.
 * The agent credential stays on the server.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/analyses/[id]/ask">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "not found" }, { status: 404 });
  const session = await requireOrg();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  const env = serverEnv();
  if (!env.AGENT_URL || !env.AGENT_SIGNING_KEY) return Response.json({ error: "Ask is not configured for this deployment." }, { status: 503 });

  // the member must be able to read this analysis (RLS)
  const { data: a } = await userDb().from("analyses").select("id, status").eq("id", id).maybeSingle();
  if (!a || a.status !== "succeeded") return Response.json({ error: "not found" }, { status: 404 });

  await ensureOrgRow(session);
  const limit = await checkLimit(session, "ask");
  if (!limit.ok) return Response.json({ error: limit.message }, { status: 429 });
  await recordUsage(session, "ask", { analysisId: id });

  const credential = await mintAgentCredential({ orgId: session.orgId, analysisId: id, userId: session.userId });
  let upstream: Response;
  try {
    upstream = await fetch(`${env.AGENT_URL.replace(/\/$/, "")}/runs/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.LANGSMITH_API_KEY && !/localhost|127\.0\.0\.1/.test(env.AGENT_URL) ? { "x-api-key": env.LANGSMITH_API_KEY } : {}),
      },
      body: JSON.stringify({
        assistant_id: "cartograph",
        input: { messages: parsed.data.messages },
        context: { credential },
        stream_mode: ["updates"],
        metadata: { analysis_id: id, org_id: session.orgId },
      }),
      signal: AbortSignal.timeout(280_000),
    });
  } catch {
    return Response.json({ error: "The agent is not reachable." }, { status: 503 });
  }
  if (!upstream.ok || !upstream.body) return Response.json({ error: `The agent returned ${upstream.status}.` }, { status: 503 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      const reader = upstream.body!.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      let answer = "";
      // createAgent's middleware nodes can re-emit earlier messages in their
      // "updates" chunks, so forward each tool call and result once, by id.
      const seenCalls = new Set<string>();
      const seenResults = new Set<string>();
      const firstTime = (seen: Set<string>, id: string | undefined) => {
        if (!id) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      };
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let sep: number;
          while ((sep = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            const event = frame.match(/^event: (.*)$/m)?.[1];
            const data = frame
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trimStart())
              .join("\n");
            if (!data) continue;
            if (event === "error") {
              send({ type: "error", message: "The agent failed while answering." });
              continue;
            }
            if (event !== "updates") continue;
            let update: Record<string, { messages?: LcMessage[] } | null>;
            try {
              update = JSON.parse(data);
            } catch {
              continue;
            }
            for (const node of Object.values(update)) {
              for (const m of node?.messages ?? []) {
                if (m.type === "ai") {
                  for (const tc of m.tool_calls ?? []) if (firstTime(seenCalls, tc.id)) send({ type: "tool_call", id: tc.id, name: tc.name, args: tc.args });
                  const t = textOf(m.content);
                  if (!m.tool_calls?.length && t) answer = t;
                } else if (m.type === "tool" && firstTime(seenResults, m.tool_call_id)) {
                  const t = textOf(m.content);
                  send({ type: "tool_result", id: m.tool_call_id, name: m.name, ok: !t.startsWith("Tool error"), size: t.length });
                }
              }
            }
          }
        }
        send(answer ? { type: "answer", text: answer } : { type: "error", message: "The agent returned no answer." });
      } catch {
        send({ type: "error", message: "The answer stream was interrupted." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
