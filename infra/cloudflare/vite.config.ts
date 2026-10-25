import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  const app = mode.startsWith('web-') ? mode.slice(4) : undefined;
  if (app && !['customer', 'partner', 'ops'].includes(app)) throw new Error('Unknown web application');
  return { plugins: [cloudflare()], publicDir: app ? fileURLToPath(new URL(`../../apps/${app}/dist/`, import.meta.url)) : false };
});
