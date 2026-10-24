import { bindings, defineConfig } from 'cf/config';
import { execFileSync } from 'node:child_process';
import * as entrypoint from './src/gateway.mjs' with { type: 'cf-worker' };

export default defineConfig(({ mode }) => {
  if (mode !== 'staging') throw new Error('Only the isolated staging gateway is deployable. Production promotion is not implemented.');
  const revision = process.env.SOURCE_REVISION ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/.test(revision ?? '')) throw new Error('SOURCE_REVISION must pin the tested source commit');
  return {
    accountId: '30da226b98a60297593f8e41f078b748',
    worker: {
      name: 'laundry-platform-staging', entrypoint, compatibilityDate: '2026-10-22',
      workersDev: true, previewUrls: false,
      env: {
        SOURCE_REVISION: bindings.text(revision!),
        // Staging has no custom domain. Workers.dev is explicitly not a launch endpoint.
        PLATFORM_ORIGIN: bindings.text(process.env.PLATFORM_ORIGIN ?? ''),
        ORIGIN_SECRET: bindings.secret(), OPERATIONS_TOKEN: bindings.secret(),
      },
      observability: { enabled: true, headSamplingRate: 0.1 },
    },
  };
});
