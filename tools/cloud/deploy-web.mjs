import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, stat, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { apiOrigin } from '../../infra/cloudflare/src/web.mjs';
const account = '30da226b98a60297593f8e41f078b748';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
async function main() {
  if (process.argv[2] !== '--deploy') throw new Error('Use --deploy explicitly');
  if (git('status', '--porcelain')) throw new Error('Commit reviewed web hosting changes before deployment');
  const revision = git('rev-parse', 'HEAD');
  await mkdir('.data', { recursive: true, mode: 0o700 });
  const secretFile = resolve('.data/web.env');
  try { await writeFile(secretFile, `API_ORIGIN_SECRET=${randomBytes(32).toString('hex')}\n`, { mode: 0o600, flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if ((await stat(secretFile)).mode & 0o077) throw new Error('Web credentials require mode 0600');
  const values = parseEnv(await readFile(secretFile, 'utf8'));
  if (!/^[a-f0-9]{64}$/.test(values.API_ORIGIN_SECRET ?? '')) throw new Error('Invalid private API ingress secret');
  if (values.API_ORIGIN) apiOrigin(values.API_ORIGIN);
  const log = resolve('.data/web-deploy.log');
  await writeFile(log, '', { mode: 0o600 });
  function run(args, env = {}) {
    const child = spawnSync('pnpm', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 180_000,
      env: { ...process.env, ...values, ...env, SOURCE_REVISION: revision, CLOUDFLARE_ACCOUNT_ID: account } });
    return appendFile(log, `\n${args.join(' ')}\n${child.stdout ?? ''}\n${child.stderr ?? ''}\nexit=${child.status}\n`).then(() => {
      if (child.error || child.status !== 0) throw new Error('Web deployment step failed; private diagnostics: .data/web-deploy.log');
    });
  }
  await run(['release:security']);
  await run(['--filter', '@laundry/gateway', 'exec', 'cf', 'auth', 'activate', 'laundry', resolve('.')]);
  const deployed = [];
  for (const app of ['customer', 'partner', 'ops']) {
    const slug = app === 'partner' ? 'rider' : app;
    const url = `https://laundry-${slug}.aditya-s274adi.workers.dev`;
    console.log(`Building and deploying Laundry ${slug}`);
    await run(['--filter', `@laundry/${app}`, 'build', ...(app === 'ops' ? [] : ['--clear'])], {
      EXPO_PUBLIC_API_V2_URL: `${url}/v2`, VITE_API_V2_URL: `${url}/v2`, VITE_DEMO_MODE: 'false', DEMO_MODE: 'false',
    });
    await run(['--filter', '@laundry/gateway', 'exec', 'vite', 'build', '--mode', `web-${app}`]);
    await run(['--filter', '@laundry/gateway', 'exec', 'cf', 'deploy', '--prebuilt', '--mode', `web-${app}`, '--dry-run']);
    await run(['--filter', '@laundry/gateway', 'exec', 'cf', 'deploy', '--prebuilt', '--mode', `web-${app}`, '--profile', 'laundry', '--secrets-file', secretFile]);
    let confirmed = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        const response = await fetch(`${url}/health`, { redirect: 'error', signal: AbortSignal.timeout(10_000), cache: 'no-store' });
        const data = await response.json();
        if (response.ok && data.revision === revision && data.app === app && data.productionReady === false && data.messagingEnabled === false) { confirmed = true; break; }
      } catch { /* bounded propagation wait, not a successful deployment receipt */ }
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
    if (!confirmed) throw new Error(`Deployed revision was not confirmed at ${url}`);
    for (const [path, status] of [['/', 200], ['/health/ready', 503], ['/missing-bundle.js', 404], ['/.env', 404], ['/v1/auth/demo', 404]]) {
      const response = await fetch(url + path, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
      if (response.status !== status) throw new Error(`Unexpected deployed response for ${slug} ${path}`);
      await response.body?.cancel();
    }
    deployed.push({ app, url, revision });
    await writeFile('.data/web-deployment.json', JSON.stringify({ revision, account, deployed, productApiConnected: Boolean(values.API_ORIGIN), productionReady: false, messagingEnabled: false, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    console.log(`Verified ${url}`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
