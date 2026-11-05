import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const FRAMEWORK = ["next", "next/*", "react", "react-dom", "react/*", "@clerk/*", "@supabase/*", "@/lib/*", "@/components/*", "@/app/*"];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Parsing and graph code take data in and return data: no framework, UI or database.
  {
    files: ["src/parser/**", "src/graph/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: FRAMEWORK, message: "Parser/graph code must not import framework, UI or database code." }] }],
    },
  },
  // Graph math runs in the browser: types from the parser only, no file system.
  {
    files: ["src/graph/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: FRAMEWORK, message: "Graph code must not import framework, UI or database code." },
            { group: ["@/parser", "@/parser/*", "!@/parser/types"], allowTypeImports: true, message: "Graph code may only import parser types." },
            { group: ["node:*", "fs", "path"], message: "Graph code runs in the browser." },
          ],
        },
      ],
    },
  },
  // Browser components must not pull in the parser, server modules or the file system.
  {
    files: ["src/components/**", "src/app/**/*.client.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/parser", "@/parser/*"], allowTypeImports: true, message: "Browser code may only import parser types." },
            { group: ["@/server/*", "node:*", "fs", "path", "child_process"], message: "Server-only code in a browser component." },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "test/fixtures/**", "cartograph-agent/**"]),
]);

export default eslintConfig;
