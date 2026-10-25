import path from "node:path";
import { defineConfig } from "vitest/config";

// The workspace install links consumers through dist entry points, but this
// package is uninstalled during isolated repair runs. Alias workspace imports
// to source so focused tests run without a dependency install.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
  resolve: {
    alias: {
      "@laundry/api-client": path.resolve(__dirname, "../api-client/src/index.ts"),
      "@laundry/contracts": path.resolve(__dirname, "../contracts/src/index.ts"),
      "@laundry/test-fixtures": path.resolve(__dirname, "../test-fixtures/src/index.ts"),
    },
  },
});
