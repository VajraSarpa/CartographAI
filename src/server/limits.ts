import "server-only";
import { serverEnv } from "@/lib/env";
import { adminDb } from "./supabase";
import type { OrgSession } from "./session";

export type UsageKind = "analyze" | "explain" | "ask";

const PER_USER_PER_MINUTE: Record<UsageKind, number> = { analyze: 5, explain: 20, ask: 10 };

/**
 * Daily per-organization quota plus a per-user burst limit. Protects the
 * model budget and GitHub quota from one noisy (or compromised) account.
 */
export async function checkLimit(s: OrgSession, kind: UsageKind): Promise<{ ok: true } | { ok: false; message: string }> {
  const env = serverEnv();
  const daily = { analyze: env.LIMIT_ANALYSES_PER_DAY, explain: env.LIMIT_EXPLAINS_PER_DAY, ask: env.LIMIT_ASKS_PER_DAY }[kind];
  const db = adminDb();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  const [org, user] = await Promise.all([
    db.from("usage_events").select("id", { count: "exact", head: true }).eq("org_id", s.orgId).eq("kind", kind).gte("created_at", dayAgo),
    db.from("usage_events").select("id", { count: "exact", head: true }).eq("user_id", s.userId).eq("kind", kind).gte("created_at", minuteAgo),
  ]);
  if (org.error || user.error) throw new Error(`usage check failed: ${(org.error ?? user.error)!.message}`);
  if ((user.count ?? 0) >= PER_USER_PER_MINUTE[kind]) return { ok: false, message: "Too many requests. Wait a minute and try again." };
  if ((org.count ?? 0) >= daily) return { ok: false, message: `Your team reached today's limit (${daily}). Try again tomorrow.` };
  return { ok: true };
}

export async function recordUsage(
  s: OrgSession,
  kind: UsageKind,
  extra: { analysisId?: string; inputTokens?: number; outputTokens?: number } = {},
): Promise<void> {
  await adminDb().from("usage_events").insert({
    org_id: s.orgId,
    user_id: s.userId,
    kind,
    analysis_id: extra.analysisId ?? null,
    input_tokens: extra.inputTokens ?? null,
    output_tokens: extra.outputTokens ?? null,
  });
}
