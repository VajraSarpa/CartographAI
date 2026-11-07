import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "test/stubs/server-only.ts") } },
  test: { include: ["test/**/*.test.ts"], exclude: ["test/fixtures/**", "node_modules/**"], environment: "node", testTimeout: 30_000 },
});
