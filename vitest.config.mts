import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["test/**/*.test.ts"], exclude: ["test/fixtures/**", "node_modules/**"], environment: "node", testTimeout: 30_000 },
});
