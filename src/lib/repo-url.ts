export interface RepoRef {
  owner: string;
  name: string;
  /** branch or tag if the URL named one (no slashes), else null = default branch */
  ref: string | null;
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;
const REF = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Accepts https://github.com/owner/repo(.git)(/tree/ref), github.com/owner/repo
 * or owner/repo. Returns null for anything else (other hosts, odd characters).
 */
export function parseRepoUrl(input: string): RepoRef | null {
  let s = input.trim();
  if (s.length > 300) return null;
  s = s.replace(/^git\+/, "").replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  if (/^github\.com\//i.test(s)) s = s.slice("github.com/".length);
  else if (s.includes(".") && s.split("/")[0].includes(".")) return null; // another host
  s = s.replace(/[?#].*$/, "").replace(/\/+$/, "");
  const parts = s.split("/");
  if (parts.length < 2) return null;
  const owner = parts[0];
  const name = parts[1].replace(/\.git$/i, "");
  if (!OWNER.test(owner) || !NAME.test(name) || name === "." || name === "..") return null;
  let ref: string | null = null;
  if (parts.length >= 4 && parts[2] === "tree") {
    if (parts.length === 4 && REF.test(parts[3])) ref = parts[3];
    else if (parts.length > 4) ref = null; // ref with slashes is ambiguous: use the default branch
  } else if (parts.length > 2) {
    return null;
  }
  return { owner, name, ref };
}
