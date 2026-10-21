import { defineConfig } from "vite";
import path from "node:path";

// The pilot console talks to the same origin in dev (the /v1 proxy below) so
// the browser needs no CORS grant and no second API host.
export default defineConfig({
  resolve: {
    alias: {
      "@wandary/contracts": path.resolve(__dirname, "../../packages/contracts/src/index.ts"),
      "@wandary/api-client": path.resolve(__dirname, "../../packages/api-client/src/index.ts"),
    },
  },
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      "/v1": {
        target: process.env.PILOT_API_URL ?? "http://localhost:4100",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
