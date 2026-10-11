import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@wandary/contracts": path.resolve(__dirname, "../../packages/contracts/src/index.ts"),
      "@modules": path.resolve(__dirname, "../../modules"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["test/**/*.test.ts", "../../integration/**/*.test.ts"],
    environment: "node",
    globals: false,
    hookTimeout: 60000,
    testTimeout: 60000,
    fileParallelism: false,
    setupFiles: ["./test/setup-env.ts"],
  },
});
