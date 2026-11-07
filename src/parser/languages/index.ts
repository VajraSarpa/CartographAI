import type { LanguagePlugin } from "cartograph-lang-api";
import { typescriptPlugin } from "./typescript";

/** Languages that ship with Cartograph. Anything else is the npm package cartograph-lang-<id>. */
export const BUILTIN_LANGUAGES: Record<string, LanguagePlugin> = {
  typescript: typescriptPlugin,
};

export const DEFAULT_LANGUAGES = ["typescript"];

/** ids are lowercase so the package name can be built from them */
export const LANGUAGE_ID = /^[a-z][a-z0-9-]*$/;

export function packageFor(id: string): string {
  return `cartograph-lang-${id}`;
}

/**
 * Load the enabled languages, in order. A built-in is used directly; any other
 * id must be an installed package exporting a LanguagePlugin (default export
 * or `plugin`). Anything wrong fails loudly, naming the language.
 */
export async function loadLanguages(
  ids: readonly string[],
  importer: (pkg: string) => Promise<unknown> = (pkg) => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pkg),
): Promise<LanguagePlugin[]> {
  if (ids.length === 0) throw new Error("No languages enabled: CARTOGRAPH_LANGUAGES is empty.");
  const out: LanguagePlugin[] = [];
  for (const id of ids) {
    if (!LANGUAGE_ID.test(id)) throw new Error(`Language "${id}": ids are lowercase letters, digits and dashes.`);
    if (out.some((p) => p.id === id)) throw new Error(`Language "${id}" is listed twice.`);
    let plugin = BUILTIN_LANGUAGES[id];
    if (!plugin) {
      const pkg = packageFor(id);
      let mod: unknown;
      try {
        mod = await importer(pkg);
      } catch (e) {
        throw new Error(`Language "${id}" is enabled but ${pkg} could not be loaded (run \`pnpm add ${pkg}\`): ${(e as Error).message}`);
      }
      const m = mod as { default?: unknown; plugin?: unknown };
      plugin = (isPlugin(m.default) ? m.default : isPlugin(m.plugin) ? m.plugin : null) as LanguagePlugin;
      if (!plugin) throw new Error(`${pkg} does not export a Cartograph language plug-in (default export or \`plugin\`).`);
    }
    if (plugin.apiVersion !== 1) throw new Error(`${packageFor(id)} uses plug-in API version ${String(plugin.apiVersion)}; this Cartograph supports version 1.`);
    if (plugin.id !== id) throw new Error(`${packageFor(id)} says its id is "${plugin.id}", expected "${id}".`);
    out.push(plugin);
  }
  return out;
}

function isPlugin(v: unknown): v is LanguagePlugin {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return typeof p.id === "string" && typeof p.name === "string" && typeof p.claims === "function" && typeof p.open === "function";
}
