import { formatEnvIssues, serverSchema } from "@/lib/env";

/** Runs once when the server starts: missing configuration fails loudly. */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const parsed = serverSchema.safeParse(process.env);
  if (parsed.success) return;
  const msg = `\n\n  Cartograph cannot start: environment is incomplete\n${formatEnvIssues(parsed.error)}\n  Run \`pnpm env:doctor\`.\n`;
  if (process.env.NODE_ENV === "production") throw new Error(msg);
  console.error("\x1b[31m%s\x1b[0m", msg);
}
