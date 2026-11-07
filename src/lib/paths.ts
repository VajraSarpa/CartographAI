/**
 * Finds file paths the model named in its text, so we can prove it only named
 * paths it was shown. Pure: used by the server (on every explanation, cached
 * or not), the UI (to link/flag paths) and the evals.
 *
 * Rules (each from a real failure):
 * - a mention must equal a shown path exactly; a relative path that happens
 *   to match the tail of a different file is still invented
 * - backtick spans are scanned too, not only bare text
 */
const EXT = "(?:[cm]?[jt]sx?|json|css|scss|sass|less|html?|md|mdx|ya?ml|svg|png|vue|svelte)";
const PATH_CHARS = "[A-Za-z0-9_@$.\\-\\[\\]()+~]";
// a/b/c.ext, ./a.ext, ../a/b, a.ext (with at least one slash or a code extension)
const PATH_RE = new RegExp(`(?<![A-Za-z0-9_/.@-])((?:\\.{1,2}/)?${PATH_CHARS}+(?:/${PATH_CHARS}+)*\\.${EXT}|(?:\\.{1,2}/)?${PATH_CHARS}+(?:/${PATH_CHARS}+)+)(?![A-Za-z0-9_/-])`, "g");
const URLISH = /^(?:https?:|www\.|[a-z0-9-]+\.(?:com|org|io|dev|net)\b)/i;

export function findPathMentions(text: string): string[] {
  const found = new Set<string>();
  const consider = (raw: string) => {
    const s = raw.trim().replace(/[.,;:]+$/, "").replace(/:\d+(?::\d+)?$/, "");
    if (!s || URLISH.test(s) || s.length > 300) return;
    if (/^[@a-z0-9-]+(?:\/[a-z0-9.-]+)?$/i.test(s) && !/\.[a-z]{1,5}$/i.test(s) && !s.includes("/")) return;
    // npm package names such as "@scope/pkg" or "react-dom/client" are not repo paths
    if (/^@[\w.-]+\/[\w.-]+$/.test(s)) return;
    found.add(s);
  };
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const inner = m[1].trim();
    if (inner.includes("/") || new RegExp(`\\.${EXT}$`).test(inner)) consider(inner);
  }
  const noCode = text.replace(/`[^`\n]*`/g, " ");
  for (const m of noCode.matchAll(PATH_RE)) {
    const s = m[1].replace(/[.,;:]+$/, "");
    if (!s.includes("/") && !new RegExp(`\\.${EXT}$`).test(s)) continue;
    // skip prose like "and/or", "input/output"
    if (/^[a-z]+\/[a-z]+$/i.test(s) && !/\.[a-z]+$/.test(s)) continue;
    consider(s);
  }
  return [...found].sort();
}

export function checkPaths(text: string, shown: Iterable<string>): { named: string[]; invented: string[] } {
  const allowed = new Set(shown);
  const named = findPathMentions(text);
  return { named, invented: named.filter((p) => !allowed.has(p)) };
}
