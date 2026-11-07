/*
 * Fetch a public repo, parse it and store the map, from the terminal.
 *   pnpm analyze <github-url> --org <clerk-org-id> [--force]
 * Uses the server secret key, so it runs only where .env.local exists.
 */
import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

async function main() {
  const { runPipeline, startAnalysis } = await import("../src/server/pipeline");
  const { ensureOrgRow } = await import("../src/server/org");
  const { adminDb } = await import("../src/server/supabase");
  const args = process.argv.slice(2);
  const url = args.find((a) => !a.startsWith("--"));
  const orgIdx = args.indexOf("--org");
  const orgId = orgIdx >= 0 ? args[orgIdx + 1] : undefined;
  if (!url || !orgId) {
    console.error("usage: pnpm analyze <github-url> --org <clerk-org-id> [--force]");
    process.exit(2);
  }
  const session = { userId: "cli", orgId, orgName: orgId };
  await ensureOrgRow(session);
  const t0 = Date.now();
  const res = await startAnalysis(session, url, { force: args.includes("--force") });
  if (!res.ok) {
    console.error(`refused: ${res.error}`);
    process.exit(1);
  }
  if (!res.runId || res.existing) {
    console.log(`already analyzed: ${res.analysisId} (use --force to re-run)`);
    return;
  }
  await runPipeline({ runId: res.runId, analysisId: res.analysisId, orgId, owner: res.repo.owner, name: res.repo.name, ref: res.repo.ref });
  const db = adminDb();
  const { data: run } = await db.from("analysis_runs").select("status, step, error, progress").eq("id", res.runId).single();
  const { data: a } = await db.from("analyses").select("status, commit_sha, framework, stats").eq("id", res.analysisId).single();
  console.log(JSON.stringify({ analysisId: res.analysisId, seconds: (Date.now() - t0) / 1000, run, analysis: a }, null, 2));
  if (run?.status !== "succeeded") process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
