/* Parse a directory and print what the parser proved. Usage: pnpm parse [dir] [--json out.json] */
import { writeFileSync } from "node:fs";
import { parseRepo } from "../src/parser";

async function main() {
  const args = process.argv.slice(2);
  const jsonIdx = args.indexOf("--json");
  const out = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
  const dir = args.find((a, i) => !a.startsWith("--") && (jsonIdx < 0 || i !== jsonIdx + 1)) ?? ".";
  const t0 = Date.now();
  const r = await parseRepo(dir);
  const s = r.stats;
  console.log(`Parsed ${dir} in ${Date.now() - t0} ms (parser v${r.parserVersion})`);
  console.log(`Framework: ${r.framework.name}${r.framework.evidence ? ` (${r.framework.evidence})` : ""}`);
  console.log(`Files found ${s.filesFound} = parsed ${s.filesParsed} + skipped ${s.filesSkipped}  ${s.filesFound === s.filesParsed + s.filesSkipped ? "OK" : "MISMATCH"}`);
  console.log(`Imports: resolved ${s.imports.resolved}, external ${s.imports.external}, skipped ${s.imports.skipped}, failed ${s.imports.failed}`);
  console.log(`Edges ${s.edges}, lines ${s.lines}`);
  if (r.skipped.length) {
    console.log("\nSkipped files:");
    for (const f of r.skipped.slice(0, 50)) console.log(`  ${f.path}: ${f.reason}`);
    if (r.skipped.length > 50) console.log(`  ... and ${r.skipped.length - 50} more`);
  }
  const notExternal = r.unresolved.filter((u) => u.status !== "external");
  if (notExternal.length) {
    console.log("\nUnresolved (skipped/failed) imports:");
    for (const u of notExternal.slice(0, 60)) console.log(`  [${u.status}] ${u.from}:${u.line} "${u.specifier}" - ${u.reason}`);
    if (notExternal.length > 60) console.log(`  ... and ${notExternal.length - 60} more`);
  }
  const roles = Object.entries(r.framework.roles).map(([id, label]) => `${label} ${r.files.filter((f) => f.roles.includes(id)).length}`);
  if (roles.length) console.log(`\nRoles: ${roles.join(", ")}`);
  if (r.framework.routes.length) console.log(`Routes: ${r.framework.routes.map((x) => `${x.method} ${x.path}`).join(", ")}`);
  if (out) {
    writeFileSync(out, JSON.stringify(r));
    console.log(`\nWrote ${out}`);
  }
  if (s.filesFound !== s.filesParsed + s.filesSkipped) process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
