import "server-only";
import { createHash } from "node:crypto";
import { exportJWK, importPKCS8, jwtVerify, SignJWT, type JWK } from "jose";
import { serverEnv } from "@/lib/env";

/**
 * The agent's credential: a short-lived ES256 JWT naming exactly one analysis
 * and its organization, with a read-only scope. Supabase trusts the same key
 * (imported as a standby JWT signing key), so RLS enforces the scope again in
 * the database; the app verifies it too before doing anything.
 */
export const AGENT_SCOPE = "agent:read";
const TTL_SECONDS = 10 * 60;
const ISSUER = "cartograph-app";

let keys: Promise<{ priv: CryptoKey; pub: CryptoKey; kid: string }> | null = null;

function loadKeys() {
  keys ??= (async () => {
    const env = serverEnv();
    if (!env.AGENT_SIGNING_KEY) throw new Error("AGENT_SIGNING_KEY is not set (run `pnpm agent key`)");
    // accept real newlines or literal "\n" (how dashboards usually store it)
    const pem = env.AGENT_SIGNING_KEY.replace(/\\+n/g, "\n").replace(/\\(?=\n)/g, "");
    const priv = await importPKCS8(pem, "ES256", { extractable: true });
    const jwk = await exportJWK(priv);
    const { d: _d, ...pubJwk } = jwk;
    void _d;
    const { importJWK } = await import("jose");
    const pub = (await importJWK({ ...pubJwk, alg: "ES256" } as JWK, "ES256")) as CryptoKey;
    const kid = env.AGENT_SIGNING_KID ?? createHash("sha256").update(JSON.stringify(pubJwk)).digest("hex").slice(0, 16);
    return { priv, pub, kid };
  })();
  return keys;
}

export interface AgentClaims {
  orgId: string;
  analysisId: string;
  userId: string;
}

export async function mintAgentCredential(c: AgentClaims): Promise<string> {
  const { priv, kid } = await loadKeys();
  return new SignJWT({ role: "authenticated", org_id: c.orgId, analysis_id: c.analysisId, scope: AGENT_SCOPE })
    .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
    .setIssuer(ISSUER)
    .setSubject(c.userId)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(priv);
}

/** Returns the claims, or null for anything expired, tampered, mis-scoped or malformed. */
export async function verifyAgentCredential(token: string): Promise<AgentClaims | null> {
  if (!token || token.length > 4000) return null;
  try {
    const { pub } = await loadKeys();
    const { payload } = await jwtVerify(token, pub, { issuer: ISSUER, audience: "authenticated", algorithms: ["ES256"] });
    if (payload.scope !== AGENT_SCOPE || typeof payload.org_id !== "string" || typeof payload.analysis_id !== "string" || typeof payload.sub !== "string") {
      return null;
    }
    if (!/^[0-9a-f-]{36}$/i.test(payload.analysis_id)) return null;
    return { orgId: payload.org_id, analysisId: payload.analysis_id, userId: payload.sub };
  } catch {
    return null;
  }
}
