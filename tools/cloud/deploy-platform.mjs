import { spawnSync, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, appendFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const PROJECT = 'broad-rain-86048848';
const BRANCH = 'br-fancy-glade-a1tjuotr';
const ACCOUNT = '30da226b98a60297593f8e41f078b748';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

async function main() {
  if (process.argv[2] !== '--deploy') throw new Error('Use --deploy explicitly. This deploys the disabled-product staging infrastructure only.');
  if (git('status', '--porcelain')) throw new Error('Refusing deployment from a dirty or untracked working tree');
  const revision = git('rev-parse', 'HEAD');
  const directory = resolve('.data');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const secretsFile = resolve(directory, 'platform.env');
  if ((await stat(secretsFile)).mode & 0o077) throw new Error('Private platform credentials must have mode 0600');
  const values = parseEnv(await readFile(secretsFile, 'utf8'));
  for (const key of ['ORIGIN_SECRET', 'OPERATIONS_TOKEN']) if (!/^[a-f0-9]{64}$/.test(values[key] ?? '')) throw new Error(`Invalid private ${key}`);
  const database = new URL(values.PLATFORM_DATABASE_URL);
  if (database.hostname !== 'ep-raspy-lab-a1ybw0w3-pooler.ap-southeast-1.aws.neon.tech' || database.pathname !== '/laundry_staging' || database.username !== 'laundry_platform' || database.searchParams.get('sslmode') !== 'verify-full') {
    throw new Error('Deployment requires the pinned, least-privilege candidate database');
  }
  const log = resolve(directory, 'platform-deploy.log');
  await writeFile(log, '', { mode: 0o600 });
  const childEnv = { ...process.env, ...values, SOURCE_REVISION: revision, CLOUDFLARE_ACCOUNT_ID: ACCOUNT };
  async function run(args, label) {
    console.log(label);
    const child = spawnSync('pnpm', args, { encoding: 'utf8', env: childEnv, maxBuffer: 20 * 1024 * 1024, timeout: 180000 });
    await appendFile(log, `\n${label}\n${child.stdout ?? ''}\n${child.stderr ?? ''}\nexit=${child.status}\n`);
    if (child.error || child.status !== 0) throw new Error(`${label} failed; diagnostics are in ignored .data/platform-deploy.log`);
    return child.stdout;
  }
  // Some beta cf deployment helpers resolve credentials without carrying the
  // explicit --profile flag. Bind only this checkout so all helpers use Laundry.
  await run(['--filter', '@laundry/gateway', 'exec', 'cf', 'auth', 'activate', 'laundry', resolve('.')], 'Bind the Laundry Cloudflare profile to this checkout');
  // Explicit branch and no env-pull prevent accidental parent deployment or local secret replacement.
  await run(['exec', 'neon', 'deploy', '--config', 'neon.ts', '--env', secretsFile, '--project-id', PROJECT, '--branch', BRANCH, '--profile', 'laundry', '--no-env-pull'], 'Deploy authenticated Neon platform preflight');
  const output = await run(['exec', 'neon', 'functions', 'get', 'platform', '--project-id', PROJECT, '--branch', BRANCH, '--profile', 'laundry', '-o', 'json'], 'Read deployed function identity');
  const detail = JSON.parse(output);
  const origin = detail.invocation_url ?? detail.function?.invocation_url;
  if (typeof origin !== 'string') throw new Error('Neon returned no function invocation URL');
  const { platformOrigin } = await import('../../infra/cloudflare/src/gateway.mjs');
  platformOrigin(origin);
  childEnv.PLATFORM_ORIGIN = origin;
  const workerSecrets = resolve(directory, 'cloudflare-platform.env');
  await writeFile(workerSecrets, `ORIGIN_SECRET=${values.ORIGIN_SECRET}\nOPERATIONS_TOKEN=${values.OPERATIONS_TOKEN}\n`, { mode: 0o600 });
  await run(['--filter', '@laundry/gateway', 'build'], 'Build staging gateway');
  await run(['--filter', '@laundry/gateway', 'exec', 'cf', 'deploy', '--prebuilt', '--mode', 'staging', '--dry-run'], 'Validate Cloudflare build without uploading');
  const result = await run(['--filter', '@laundry/gateway', 'exec', 'cf', 'deploy', '--prebuilt', '--mode', 'staging', '--profile', 'laundry', '--secrets-file', workerSecrets], 'Deploy staging gateway');
  const gatewayUrl = result.match(/https:\/\/laundry-platform-staging\.[a-z0-9-]+\.workers\.dev/)?.[0];
  if (!gatewayUrl) throw new Error('Deployment returned no expected staging URL; inspect the private log before retrying');
  const receipt = { revision, project: PROJECT, branch: BRANCH, account: ACCOUNT, gatewayUrl, nativeOrigin: origin,
    productApiEnabled: false, productionReady: false, createdAt: new Date().toISOString() };
  await writeFile(resolve(directory, 'platform-deployment.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
  console.log(`Deployed ${gatewayUrl}. Product ordering remains disabled. Run live verification before calling infrastructure healthy.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
