import { exportPKCS8, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

let mint: typeof import("@/server/agent-credential").mintAgentCredential;
let verify: typeof import("@/server/agent-credential").verifyAgentCredential;
let otherKey: CryptoKey;

beforeAll(async () => {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  otherKey = (await generateKeyPair("ES256")).privateKey;
  Object.assign(process.env, {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x",
    NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_xxxxxxxxxxxx",
    CLERK_SECRET_KEY: "sk_test_x",
    SUPABASE_SECRET_KEY: "sb_secret_xxxxxxxxxxxxxxxx",
    ANTHROPIC_API_KEY: "sk-ant-x",
    AGENT_SIGNING_KEY: (await exportPKCS8(privateKey)).replace(/\n/g, "\\n"),
    AGENT_SIGNING_KID: "test-kid",
  });
  ({ mintAgentCredential: mint, verifyAgentCredential: verify } = await import("@/server/agent-credential"));
});

const claims = { orgId: "org_A", analysisId: "aaaaaaaa-0000-0000-0000-00000000000a", userId: "user_1" };

describe("agent credential", () => {
  it("round-trips and names one analysis, its org and a read-only scope", async () => {
    const t = await mint(claims);
    expect(await verify(t)).toEqual(claims);
    const payload = JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());
    expect(payload).toMatchObject({ role: "authenticated", scope: "agent:read", org_id: "org_A", aud: "authenticated" });
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(600);
  });
  it("rejects a tampered payload", async () => {
    const [h, p, s] = (await mint(claims)).split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), org_id: "org_B" })).toString("base64url");
    expect(await verify(`${h}.${forged}.${s}`)).toBeNull();
  });
  it("rejects a token signed by another key", async () => {
    const t = await new SignJWT({ scope: "agent:read", org_id: "org_A", analysis_id: claims.analysisId })
      .setProtectedHeader({ alg: "ES256" }).setIssuer("cartograph-app").setAudience("authenticated").setSubject("u").setExpirationTime("5m").sign(otherKey);
    expect(await verify(t)).toBeNull();
  });
  it("rejects garbage, empty, and alg=none tokens", async () => {
    expect(await verify("garbage")).toBeNull();
    expect(await verify("")).toBeNull();
    const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ scope: "agent:read", org_id: "org_A", analysis_id: claims.analysisId, sub: "u", iss: "cartograph-app", aud: "authenticated" })).toString("base64url")}.`;
    expect(await verify(none)).toBeNull();
  });
});
