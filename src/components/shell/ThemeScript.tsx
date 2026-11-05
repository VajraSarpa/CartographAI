import { headers } from "next/headers";

// Applies a saved explicit theme before first paint. "system" needs no script (CSS media query).
const SCRIPT = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.classList.add(t)}catch(e){}`;

export async function ThemeScript() {
  const h = await headers();
  const nonce = h.get("x-nonce") ?? h.get("content-security-policy")?.match(/'nonce-([^']+)'/)?.[1];
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
