import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForGatewayRevision } from './deployment-receipt.mjs';
const revision = 'a'.repeat(40);
const receipt = { service: 'laundry-gateway', alive: true, productionReady: false, revision };

test('deployment receipt waits for the actual expected revision, not successful CLI output', async () => {
  let calls = 0, waits = 0;
  await waitForGatewayRevision('https://staging.invalid/', revision, { attempts: 2, wait: async () => { waits++; }, fetcher: async (url, options) => {
    assert.equal(url.toString(), 'https://staging.invalid/health/live');
    assert.equal(options.redirect, 'manual');
    calls++;
    return Response.json(calls === 1 ? { ...receipt, revision: 'b'.repeat(40) } : receipt);
  } });
  assert.equal(calls, 2); assert.equal(waits, 1);
});
test('stale, redirected, unavailable, and product-ready responses cannot issue a staging receipt', async () => {
  for (const response of [Response.json({ ...receipt, revision: 'b'.repeat(40) }), Response.json({ ...receipt, productionReady: true }), new Response(null, { status: 302 }), new Response('private provider error', { status: 500 })]) {
    await assert.rejects(waitForGatewayRevision('https://staging.invalid/', revision, { attempts: 1, fetcher: async () => response }), /no deployment receipt issued/);
  }
});
test('invalid source revisions are rejected before any network request', async () => {
  let calls = 0;
  await assert.rejects(waitForGatewayRevision('https://staging.invalid/', 'short', { fetcher: async () => { calls++; } }), /full source revision/);
  assert.equal(calls, 0);
});
