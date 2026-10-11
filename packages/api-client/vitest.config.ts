import path from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
  resolve: {
    alias: {
      "@wandary/contracts": path.resolve(__dirname, "../contracts/src/index.ts"),
      "@wandary/test-fixtures": path.resolve(__dirname, "../test-fixtures/src/index.ts"),
    },
  },
});
