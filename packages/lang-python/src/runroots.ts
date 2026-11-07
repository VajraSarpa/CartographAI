import path from "node:path";
import type { RepoView } from "cartograph-lang-api";
import type { Root } from "./project";

/** Files whose commands can prove which folder an app runs from. */
export const RUN_FILES = /(^|\/)(Procfile|Dockerfile[^/]*|[^/]*compose[^/]*\.ya?ml|Makefile|app\.ya?ml|[^/]+\.sh)$/;

const SERVERS = "gunicorn|uvicorn|hypercorn|daphne|granian|waitress-serve";

/**
 * Folders on the import path because a run command in the repo says so:
 *   gunicorn app.main:app / uvicorn "svc.main:app" / CMD ["uvicorn", "svc.main:app"]
 *   python -m pkg.tool / flask --app web / FLASK_APP=web
 *   python manage.py runserver  (a script's own folder is sys.path[0])
 * A module target counts only when exactly one folder in the repo holds that
 * module path; a script only when exactly one file matches. Anything else is
 * not evidence.
 */
export function runRoots(repo: RepoView): Root[] {
  const roots: Root[] = [];
  const add = (dir: string, source: string) => {
    if (!roots.some((r) => r.dir === dir)) roots.push({ dir, source });
  };
  const files = [...repo.files];
  for (const f of files) {
    if (!RUN_FILES.test(f)) continue;
    const text = repo.readText(f, 200_000);
    if (!text) continue;
    // one logical command per line; JSON-array CMDs become plain words
    const lines = text.replace(/\\\r?\n/g, " ").split(/\r?\n/);
    lines.forEach((raw, i) => {
      const line = raw.replace(/[[\]",']/g, " ").replace(/\s+/g, " ");
      const where = `${f}:${i + 1}`;
      const mods: string[] = [];
      const server = new RegExp(`\\b(?:${SERVERS})\\b(.*)$`).exec(line);
      if (server) for (const m of server[1].matchAll(/(?:^|\s)([A-Za-z_][\w.]*):[A-Za-z_]\w*(?:\(\))?(?=\s|$)/g)) mods.push(m[1]);
      for (const m of line.matchAll(/\bpython[\d.]*\s+(?:-\w+\s+)*-m\s+([A-Za-z_][\w.]*)/g)) mods.push(m[1]);
      for (const m of line.matchAll(/\bflask\s+(?:--app|-A)[\s=]+([A-Za-z_][\w.]*)/g)) mods.push(m[1]);
      for (const m of line.matchAll(/\bFLASK_APP\s*[=:]\s*([A-Za-z_][\w.]*)/g)) mods.push(m[1]);
      for (const mod of mods) {
        const rel = mod.split(".").join("/");
        const hits = new Set<string>();
        for (const x of files) {
          for (const suffix of [`${rel}.py`, `${rel}/__init__.py`, `${rel}/__main__.py`]) {
            if (x === suffix) hits.add(".");
            else if (x.endsWith(`/${suffix}`)) hits.add(x.slice(0, -suffix.length - 1));
          }
        }
        if (hits.size === 1) add([...hits][0], `run command ${mod} (${where})`);
      }
      for (const m of line.matchAll(/\bpython[\d.]*\s+(?:-\w+\s+)*((?:\.\/)?[\w./-]+\.py)\b/g)) {
        const p = m[1].replace(/^\.\//, "");
        const hits = files.filter((x) => x === p || x.endsWith(`/${p}`));
        if (hits.length === 1) add(path.posix.dirname(hits[0]), `run command python ${p} (${where}): a script's folder is on sys.path`);
      }
    });
  }
  return roots;
}
