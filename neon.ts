import { defineConfig } from '@neon/config/v1';

function secret(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; pass a private environment file to the deployment command`);
  return value;
}

// Isolated release-candidate infrastructure. No product routes, fake accounts,
// AI gateway, public storage, live billing, or production activation.
export default defineConfig({
  functions: {
    platform: {
      name: 'Laundry infrastructure preflight',
      source: 'infra/neon/src/platform.mjs',
      env: {
        ORIGIN_SECRET: secret('ORIGIN_SECRET'),
        PLATFORM_DATABASE_URL: secret('PLATFORM_DATABASE_URL'),
        EXPECTED_BRANCH: 'release-candidate',
        EXPECTED_DATABASE: 'laundry_staging',
        SOURCE_REVISION: secret('SOURCE_REVISION'),
      },
    },
  },
});
