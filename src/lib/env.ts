import { z } from "zod";

/**
 * Environment contract. Missing or malformed variables fail loudly at startup
 * (see src/instrumentation.ts) instead of surfacing as a confusing runtime bug.
 */

const url = z.url({ protocol: /^https?$/ });
/** an empty value (`AGENT_URL=`) means "not set" */
const optionalUrl = z.preprocess((v) => (v === "" ? undefined : v), url.optional());

/**
 * Enabled languages, comma-separated, in priority order. Built-in ids load
 * directly; any other id is the npm package cartograph-lang-<id>, which must
 * be installed (checked when the parser starts, see src/parser/languages).
 */
export const languagesSchema = z
  .preprocess((v) => (v === "" ? undefined : v), z.string().default("typescript"))
  .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
  .pipe(
    z
      .array(z.string().regex(/^[a-z][a-z0-9-]*$/, "language ids are lowercase letters, digits and dashes, e.g. typescript,python"))
      .min(1, "list at least one language, e.g. typescript")
      .refine((ids) => new Set(ids).size === ids.length, "a language is listed twice"),
  );

/** Just the language list, for tools that run without the rest of the environment (pnpm parse). */
export function languagesFromEnv(env: Record<string, string | undefined> = process.env): string[] {
  const parsed = z.object({ CARTOGRAPH_LANGUAGES: languagesSchema }).safeParse(env);
  if (!parsed.success) throw new Error(`CARTOGRAPH_LANGUAGES is invalid:\n${formatEnvIssues(parsed.error)}`);
  return parsed.data.CARTOGRAPH_LANGUAGES;
}

export const publicSchema = z.object({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().regex(/^pk_(test|live)_/, "must start with pk_test_ or pk_live_"),
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: z.string().startsWith("/").default("/sign-in"),
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: z.string().startsWith("/").default("/sign-up"),
});

export const serverSchema = publicSchema.extend({
  CLERK_SECRET_KEY: z.string().regex(/^sk_(test|live)_/, "must start with sk_test_ or sk_live_"),
  SUPABASE_SECRET_KEY: z.string().min(20),
  /** optional: raises the GitHub API limit from 60 to 5,000 requests/hour */
  GITHUB_TOKEN: z.string().min(10).optional(),
  ANTHROPIC_API_KEY: z.string().regex(/^sk-ant-/, "must start with sk-ant-"),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  LANGSMITH_API_KEY: z.string().min(10).optional(),
  LANGSMITH_PROJECT: z.string().default("cartograph"),
  LANGSMITH_ENDPOINT: url.default("https://api.smith.langchain.com"),
  LANGSMITH_TRACING: z.enum(["true", "false"]).default("true"),
  /** optional standalone agent (LangSmith deployment or local `langgraph dev`); unset = run Ask in-process */
  AGENT_URL: optionalUrl,
  /** ES256 private key (PKCS#8 PEM, \n-escaped) for minting agent credentials */
  AGENT_SIGNING_KEY: z.string().min(100).optional(),
  AGENT_SIGNING_KID: z.string().min(1).optional(),
  /** public base URL of this app, used by the agent to call back */
  APP_URL: optionalUrl,
  /** per-organization limits */
  LIMIT_ANALYSES_PER_DAY: z.coerce.number().int().positive().default(30),
  LIMIT_EXPLAINS_PER_DAY: z.coerce.number().int().positive().default(200),
  LIMIT_ASKS_PER_DAY: z.coerce.number().int().positive().default(100),
  CARTOGRAPH_LANGUAGES: languagesSchema,
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function formatEnvIssues(error: z.ZodError): string {
  return error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
}

/** Validated server environment. Throws with every problem listed. */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Cartograph environment is incomplete:\n${formatEnvIssues(parsed.error)}\nRun \`pnpm env:doctor\` for details.`);
  }
  cached = parsed.data;
  return cached;
}
