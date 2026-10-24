import { defineConfig } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { requireTestDatabase } from './tools/verification/evidence.mjs';
import { browserViewport } from './tools/verification/viewports.mjs';

requireTestDatabase(process.env.DATABASE_URL);
const apiPackage = JSON.parse(readFileSync('apps/api/package.json', 'utf8')).name;
const env = {
  ...process.env,
  DEMO_MODE: 'true', NODE_ENV: 'test', PORT: '4100', API_ORIGIN: 'http://localhost:4100',
  EXPO_PUBLIC_API_URL: 'http://localhost:4100/v1', VITE_API_URL: 'http://localhost:4100/v1',
};

export default defineConfig({
  testDir: './e2e',
  outputDir: '.verification/test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [
    ['list'], ['json', { outputFile: '.verification/results.json' }],
    ['html', { outputFolder: '.verification/report', open: 'never' }],
  ],
  use: {
    browserName: 'chromium',
    headless: process.env.VERIFY_HEADED !== 'true',
    launchOptions: { slowMo: process.env.VERIFY_HEADED === 'true' ? Number(process.env.VERIFY_SLOW_MO ?? 0) : 0,
      args: process.env.VERIFY_HEADED === 'true' ? ['--ozone-platform=x11', '--window-position=0,0', '--window-size=1920,1080'] : [] },
    video: 'on', trace: 'on', screenshot: 'only-on-failure',
    viewport: browserViewport(process.env.VERIFY_HEADED === 'true'),
    actionTimeout: 15_000,
  },
  webServer: [
    { command: `pnpm --filter ${apiPackage} start`, url: 'http://localhost:4100/v1/services', env, timeout: 60_000, reuseExistingServer: false },
    ...[
      ['customer', 8081], ['partner', 8082], ['ops', 5173],
    ].map(([app, port]) => ({
      command: `node tools/verification/serve-web.mjs ${app} ${port}`,
      url: `http://localhost:${port}`, timeout: 30_000, reuseExistingServer: false,
    })),
  ],
});
