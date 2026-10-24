import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGateway, platformOrigin } from '../../infra/cloudflare/src/gateway.mjs';
import { createPlatformHandler, sameSecret, createPlatformPool } from '../../infra/neon/src/platform.mjs';

const secret = 'a'.repeat(64), operations = 'b'.repeat(64), revision = '1'.repeat(40);
const env = { SOURCE_REVISION: revision, OPERATIONS_TOKEN: operations, ORIGIN_SECRET: secret,
  PLATFORM_ORIGIN: 'https://br-synthetic-platform.compute.example.ap-southeast-1.aws.neon.tech/' };
const req = (path, headers = {}, method = 'GET') => new Request(`https://laundry.invalid${path}`, { method, headers });
const state = { database: 'laundry_candidate', command_schema: true, legacy_outbox_schema: true, privileged: false };
function fixture(overrides = {}) {
  const calls = [];
  const client = { query: async sql => { calls.push(sql); return { rows: [state] }; }, release: poisoned => calls.push(['release', poisoned]), ...overrides };
  const db = { connect: async () => { calls.push('connect'); return client; } };
  const handler = createPlatformHandler({ originSecret: secret, branchName: 'release-candidate', expectedBranch: 'release-candidate', databaseName: 'laundry_candidate', db, revision });
  return { handler, calls };
}

test('platform rejects unauthenticated native requests before database allocation', async () => {
  const { handler, calls } = fixture();
  for (const headers of [{}, { 'x-laundry-origin-secret': 'wrong' }, { authorization: `Bearer ${operations}` }]) {
    const result = await handler.fetch(req('/internal/platform', headers));
    assert.equal(result.status, 401);
  }
  assert.deepEqual(calls, []);
});
test('platform rejects methods and paths without database work', async () => {
  const { handler, calls } = fixture();
  for (const [path, method] of [['/v1/auth/demo', 'POST'], ['/internal/platform', 'POST'], ['/v2/bookings', 'GET']]) {
    assert.equal((await handler.fetch(req(path, { 'x-laundry-origin-secret': secret }, method))).status, 404);
  }
  assert.deepEqual(calls, []);
});
test('platform uses a read-only transaction and never claims product readiness', async () => {
  const { handler, calls } = fixture();
  const result = await handler.fetch(req('/internal/platform', { 'x-laundry-origin-secret': secret }));
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.infrastructureReady, true);
  assert.equal(body.productionReady, false);
  assert.equal(body.productApiEnabled, false);
  assert.equal(calls[1], 'BEGIN READ ONLY');
  assert.equal(calls.at(-2), 'ROLLBACK');
  assert.deepEqual(calls.at(-1), ['release', false]);
  assert.equal(JSON.stringify(body).includes('laundry_candidate'), false);
});
test('platform rejects wrong database, absent migrations, and privileged runtime roles', async () => {
  for (const changed of [{ database: 'foreign_database' }, { command_schema: false }, { legacy_outbox_schema: false }, { privileged: true }]) {
    const { handler } = fixture({ query: async () => ({ rows: [{ ...state, ...changed }] }) });
    const result = await handler.fetch(req('/internal/platform', { 'x-laundry-origin-secret': secret }));
    assert.equal(result.status, 503);
    assert.equal((await result.json()).code, 'DATABASE_CONFIGURATION_INVALID');
  }
});
test('database failures are redacted and failed rollback destroys the connection', async () => {
  const { handler, calls } = fixture({ query: async () => { throw new Error('postgres://private:secret@hidden.neon.tech/db'); } });
  const result = await handler.fetch(req('/internal/platform', { 'x-laundry-origin-secret': secret }));
  assert.equal(result.status, 503);
  assert.equal((await result.text()).includes('secret'), false);
  assert.deepEqual(calls.at(-1), ['release', true]);
});
test('platform configuration and secret checks fail closed', () => {
  assert.equal(sameSecret(secret, secret), true);
  assert.equal(sameSecret(secret + 'x', secret), false);
  assert.equal(sameSecret('short', 'short'), false);
  assert.throws(() => createPlatformHandler({ originSecret: 'short' }), /origin secret/);
  assert.throws(() => createPlatformHandler({ originSecret: secret, expectedBranch: 'release-candidate', branchName: 'staging' }), /wrong branch/);
  assert.throws(() => createPlatformPool('postgres://secret@foreign.invalid/db'), /verified-TLS Neon/);
  assert.throws(() => createPlatformPool('postgres://secret@ep-x.neon.tech/db?sslmode=disable'), /verified-TLS Neon/);
});
test('gateway public health and disabled product endpoints never invoke the origin', async () => {
  let calls = 0;
  const gateway = createGateway(async () => { calls++; throw new Error('must not run'); });
  for (const [path, status, method] of [['/health/live', 200, 'GET'], ['/health/ready', 503, 'GET'], ['/v1/auth/demo', 503, 'POST'], ['/v2/bookings', 503, 'POST'], ['/', 503, 'GET']]) {
    const result = await gateway.fetch(req(path, {}, method), env);
    assert.equal(result.status, status);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await result.json()).productionReady, false);
  }
  assert.equal(calls, 0);
});
test('gateway rejects forged origin headers and missing or wrong operator credentials', async () => {
  let calls = 0;
  const gateway = createGateway(async () => { calls++; });
  for (const headers of [{}, { 'x-laundry-origin-secret': secret }, { authorization: 'Bearer wrong' }]) {
    assert.equal((await gateway.fetch(req('/internal/platform', headers), env)).status, 401);
  }
  assert.equal((await gateway.fetch(req('/internal/platform', { authorization: 'Bearer undefined' }), { ...env, OPERATIONS_TOKEN: undefined })).status, 401);
  assert.equal(calls, 0);
});
test('gateway pins the native origin and strips caller credentials, cookies, and query', async () => {
  let captured;
  const gateway = createGateway(async (url, options) => { captured = { url: url.toString(), options }; return Response.json({ service: 'laundry-platform', infrastructureReady: true, productionReady: false, productApiEnabled: false, database: 'reachable', revision }); });
  const result = await gateway.fetch(req('/internal/platform?next=https://attacker.invalid', { authorization: `Bearer ${operations}`, cookie: 'private=cookie', 'x-laundry-origin-secret': 'forged' }), env);
  assert.equal(result.status, 200);
  assert.equal(captured.url, new URL('/internal/platform', env.PLATFORM_ORIGIN).toString());
  assert.deepEqual(captured.options.headers, { 'x-laundry-origin-secret': secret });
  assert.equal(captured.options.redirect, 'manual');
  assert.equal(JSON.stringify(await result.json()).includes(secret), false);
});
test('gateway rejects malformed origins and cannot become an open proxy', () => {
  for (const raw of ['http://attacker.invalid', 'https://attacker.invalid/', 'https://x.compute.a.aws.neon.tech.attacker.invalid/', 'https://user:secret@x.compute.a.aws.neon.tech/', 'https://x.compute.a.aws.neon.tech/path', 'https://x.compute.a.aws.neon.tech/?next=bad']) {
    assert.throws(() => platformOrigin(raw));
  }
  assert.equal(platformOrigin(env.PLATFORM_ORIGIN).origin, env.PLATFORM_ORIGIN.slice(0, -1));
});
test('gateway refuses upstream redirects, stale receipts, production claims, HTML and secrets', async () => {
  for (const upstream of [new Response(null, { status: 302, headers: { location: 'https://attacker.invalid/' } }), new Response('private error', { status: 500 }), Response.json({ service: 'laundry-platform', productionReady: true, revision }), Response.json({ service: 'laundry-platform', productionReady: false, revision: '2'.repeat(40) })]) {
    const gateway = createGateway(async () => upstream);
    const result = await gateway.fetch(req('/internal/platform', { authorization: `Bearer ${operations}` }), env);
    assert.equal(result.status, 503);
    const body = await result.text();
    assert.equal(body.includes('private'), false);
    assert.equal(body.includes('attacker'), false);
  }
});
