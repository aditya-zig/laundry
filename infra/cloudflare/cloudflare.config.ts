import { bindings, defineConfig } from 'cf/config';
import { execFileSync } from 'node:child_process';
import * as entrypoint from './src/gateway.mjs' with { type: 'cf-worker' };

export default defineConfig(({ mode }) => {
  const app = mode.startsWith('web-') ? mode.slice(4) : undefined;
  if (mode !== 'staging' && !['customer', 'partner', 'ops'].includes(app ?? '')) throw new Error('Select staging or an explicit web application');
  const revision = process.env.SOURCE_REVISION ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/.test(revision ?? '')) throw new Error('SOURCE_REVISION must pin the tested source commit');
  if (app) return {
    accountId: '30da226b98a60297593f8e41f078b748',
    worker: {
      name: `laundry-${app === 'partner' ? 'rider' : app}`,
      entrypoint: './src/web.mjs', compatibilityDate: '2026-10-22', workersDev: true, previewUrls: false,
      assets: { notFoundHandling: 'none', htmlHandling: 'none', runWorkerFirst: true },
      env: { APP: bindings.text(app), SOURCE_REVISION: bindings.text(revision), ASSETS: bindings.assets(),
        API_ORIGIN: bindings.text(process.env.API_ORIGIN ?? ''), API_ORIGIN_SECRET: bindings.secret() },
      observability: { enabled: true, headSamplingRate: 0.1 },
    },
  };
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
