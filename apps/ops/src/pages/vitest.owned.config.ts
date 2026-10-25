import { defineConfig } from "vitest/config";

const root = new URL("../../", import.meta.url).pathname;

export default defineConfig({
  root,
  test: {
    include: [
      "src/features/**/*.test.{ts,tsx}",
      "src/pages/**/*.test.{ts,tsx}",
      "src/styles/**/*.test.ts",
    ],
  },
});
