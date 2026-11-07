/*
 *   pnpm agent key     create the ES256 key that signs agent credentials:
 *                      writes AGENT_SIGNING_KEY/KID into .env.local and the private JWK
 *                      to .agent-signing-key.jwk.json for Supabase (JWT Keys -> standby key)
 *   pnpm agent check   prove valid credentials read, and forged ones read nothing
 */
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

function setEnv(file: string, values: Record<string, string>) {
  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
  for (const [k, v] of Object.entries(values)) {
    const i = lines.findIndex((l) => l.startsWith(`${k}=`));
    const line = `${k}=${JSON.stringify(v)}`;
    if (i >= 0) lines[i] = line;
    else lines.push(line);
  }
  writeFileSync(file, lines.join("\n").replace(/\n*$/, "\n"), { mode: 0o600 });
  chmodSync(file, 0o600);
}

async function key() {
  if (existsSync(".env.local") && /^AGENT_SIGNING_KEY=/m.test(readFileSync(".env.local", "utf8")) && !process.argv.includes("--rotate")) {
    console.log("AGENT_SIGNING_KEY already set. Use `pnpm agent key --rotate` to replace it.");
    return;
  }
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  // Supabase requires the key id of an imported key to be a UUID
  const kid = randomUUID();
  const pem = await exportPKCS8(privateKey);
  // JSON.stringify in setEnv escapes the newlines once: KEY="-----BEGIN...\n..."
  setEnv(".env.local", { AGENT_SIGNING_KEY: pem, AGENT_SIGNING_KID: kid });
  const jwk = { ...(await exportJWK(privateKey)), kid, alg: "ES256" };
  writeFileSync(".agent-signing-key.jwk.json", JSON.stringify(jwk, null, 2) + "\n", { mode: 0o600 });
  console.log(`Wrote AGENT_SIGNING_KEY and AGENT_SIGNING_KID (${kid}) to .env.local.`);
  console.log("Wrote the private JWK to .agent-signing-key.jwk.json (git-ignored).");
  console.log("\nNext: Supabase -> Project Settings -> JWT Keys -> Create standby key -> Import an existing private key (ES256),");
  console.log("paste the contents of .agent-signing-key.jwk.json, save, then delete that file.");
  console.log(`Public key (for reference): ${JSON.stringify(await exportJWK(publicKey))}`);
}

async function check() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const { mintAgentCredential, verifyAgentCredential } = await import("../src/server/agent-credential");
  const { loadForAgent, runAgentTool } = await import("../src/server/agent-tools");
  const { adminDb } = await import("../src/server/supabase");
  const { data: rows } = await adminDb().from("analyses").select("id, org_id").eq("status", "succeeded").limit(50);
  if (!rows?.length) return console.log("Analyze at least one repository first.");
  const a = rows[0];
  const other = rows.find((r) => r.org_id !== a.org_id);
  let failed = 0;
  const expect = (label: string, ok: boolean) => {
    console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
    if (!ok) failed++;
  };
  const tryRead = async (token: string) => {
    const claims = await verifyAgentCredential(token);
    // also read AS the token with forged claims, to prove RLS holds on its own
    const asDb = await loadForAgent(token, claims ?? { orgId: a.org_id, analysisId: a.id, userId: "check" });
    return { claims, asDb };
  };

  const valid = await mintAgentCredential({ orgId: a.org_id, analysisId: a.id, userId: "check" });
  const v = await tryRead(valid);
  expect("valid credential verifies", !!v.claims);
  expect("valid credential reads its analysis (Supabase trusts the key)", !!v.asDb);
  if (v.asDb) {
    const ov = (await runAgentTool("repo_overview", v.asDb, {})) as { files_parsed?: number };
    expect(`repo_overview works (${ov.files_parsed} files)`, (ov.files_parsed ?? 0) > 0);
  } else console.log("       -> import the standby key in Supabase (see `pnpm agent key`) and retry");

  const crossOrg = await mintAgentCredential({ orgId: other?.org_id ?? "org_someone_else", analysisId: a.id, userId: "check" });
  expect("credential for another organization reads nothing", !(await loadForAgent(crossOrg, { orgId: "x", analysisId: a.id, userId: "x" })));
  if (other) {
    const wrongPair = await mintAgentCredential({ orgId: a.org_id, analysisId: other.id ?? randomUUID(), userId: "check" });
    expect("credential naming another org's analysis reads nothing", !(await loadForAgent(wrongPair, { orgId: a.org_id, analysisId: other.id, userId: "x" })));
  }
  const madeUp = await mintAgentCredential({ orgId: a.org_id, analysisId: randomUUID(), userId: "check" });
  expect("made-up analysis id reads nothing", !(await loadForAgent(madeUp, { orgId: a.org_id, analysisId: randomUUID(), userId: "x" })));

  const [h, p, s] = valid.split(".");
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  const forged = `${h}.${Buffer.from(JSON.stringify({ ...payload, org_id: other?.org_id ?? "org_evil" })).toString("base64url")}.${s}`;
  const t = await tryRead(forged);
  expect("tampered token fails verification", !t.claims);
  expect("tampered token reads nothing from the database", !t.asDb);
  const g = await tryRead("garbage.token.value");
  expect("garbage token fails and reads nothing", !g.claims && !g.asDb);
  console.log(failed ? `\n${failed} check(s) failed` : "\nAll agent credential checks passed.");
  process.exit(failed ? 1 : 0);
}

const cmd = process.argv[2];
if (cmd === "key") key();
else if (cmd === "check") check();
else console.log("usage: pnpm agent key [--rotate] | pnpm agent check");
