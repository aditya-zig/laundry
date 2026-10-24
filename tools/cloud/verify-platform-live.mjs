import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';

async function main() {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Live verification requires a clean source revision');
  const deployment = JSON.parse(await readFile('.data/platform-deployment.json', 'utf8'));
  assert.equal(deployment.revision, head, 'Deployment does not match the source revision');
  const secrets = parseEnv(await readFile('.data/platform.env', 'utf8'));
  assert.equal(deployment.gatewayUrl, 'https://laundry-platform-staging.aditya-s274adi.workers.dev');
  assert.equal(deployment.nativeOrigin, 'https://br-fancy-glade-a1tjuotr-platform.compute.c-1.ap-southeast-1.aws.neon.tech/');
  const rows = [];
  async function scenario(name, path, status, options = {}, native = false) {
    const result = await fetch(new URL(path, native ? deployment.nativeOrigin : deployment.gatewayUrl), { ...options, redirect: 'manual', signal: AbortSignal.timeout(25000) });
    assert.equal(result.status, status, name);
    const raw = await result.text();
    for (const value of Object.values(secrets)) assert.equal(raw.includes(value), false, 'A response leaked a private value');
    const body = JSON.parse(raw);
    assert.notEqual(body.productionReady, true);
    if (body.revision) assert.equal(body.revision, head);
    if (!native) {
      assert.equal(result.headers.get('cache-control'), 'no-store');
      assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
    }
    rows.push({ name, status, body });
    console.log(`${name}: ${status}`);
    return body;
  }
  await scenario('edge liveness', '/health/live', 200);
  await scenario('readiness stays closed', '/health/ready', 503);
  await scenario('anonymous internal edge is denied', '/internal/platform', 401);
  await scenario('wrong operator credential is denied', '/internal/platform', 401, { headers: { authorization: 'Bearer invalid' } });
  await scenario('origin credential cannot impersonate operator', '/internal/platform', 401, { headers: { 'x-laundry-origin-secret': secrets.ORIGIN_SECRET } });
  await scenario('anonymous native origin is denied', '/internal/platform', 401, {}, true);
  await scenario('product booking remains disabled', '/v2/orders', 503, { method: 'POST' });
  await scenario('demo identity is not exposed', '/v1/auth/demo', 503, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'operator' }) });
  const body = await scenario('authenticated edge to Neon to restricted PostgreSQL', '/internal/platform', 200, { headers: { authorization: `Bearer ${secrets.OPERATIONS_TOKEN}` } });
  assert.equal(body.infrastructureReady, true);
  assert.equal(body.productApiEnabled, false);
  assert.equal(body.database, 'reachable');
  await mkdir('.verification', { recursive: true });
  await writeFile('.verification/platform-live.json', JSON.stringify({ testedSha: head, checkedAt: new Date().toISOString(),
    scope: 'Cloudflare/Neon infrastructure only; not production product or native acceptance', productionReady: false, scenarios: rows }, null, 2));
  console.log('All nine live infrastructure checks passed. Product launch is not approved.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
