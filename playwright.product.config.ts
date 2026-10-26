import { defineConfig } from '@playwright/test';
import { requireTestDatabase } from './tools/verification/evidence.mjs';

requireTestDatabase(process.env.DATABASE_URL);

// The existing task-only driver owns its API, app previews and four browser
// sessions. Do not also start the legacy v1 preview servers for this journey.
export default defineConfig({
  testDir: './tools/verification/specs',
  // Execute the same Node-built services/contracts as the standalone driver.
  build: { external: ['**/apps/api/dist/**', '**/packages/contracts/dist/**'] },
  outputDir: '.verification/product-test-results',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  reporter: [['list'], ['json', { outputFile: '.verification/product-results.json' }]],
});
