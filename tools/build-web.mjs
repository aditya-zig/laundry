import { spawnSync } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';

const app = process.argv[2] ?? process.env.LAUNDRY_APP ?? 'ops';
if (!['customer', 'partner', 'ops'].includes(app)) {
  throw new Error('Choose customer, partner, or ops');
}
const result = spawnSync('pnpm', ['--filter', `@wandary/${app}...`, 'build'], {
  stdio: 'inherit', env: process.env,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const target = new URL(`../apps/${app}/dist/assets/services/`, import.meta.url);
await mkdir(target, { recursive: true });
await cp(new URL('../assets/services/', import.meta.url), target, { recursive: true });
const output = new URL('../.web-dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await cp(new URL(`../apps/${app}/dist/`, import.meta.url), output, { recursive: true });
