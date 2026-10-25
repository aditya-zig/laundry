import assert from 'node:assert/strict';
import { test } from 'node:test';
import web, { apiOrigin } from '../../infra/cloudflare/src/web.mjs';
const native = 'https://br-fancy-glade-a1tjuotr-api.compute.c-1.ap-southeast-1.aws.neon.tech';
function env(app = 'customer') {
  return { APP: app, SOURCE_REVISION: 'a'.repeat(40), API_ORIGIN: '', API_ORIGIN_SECRET: 'a1'.repeat(32), ASSETS: { async fetch(request) { return new URL(request.url).pathname === '/index.html' ? new Response('<html>real app bundle</html>', { headers: { 'content-type': 'text/html' } }) : new Response('missing', { status: 404 }); } } };
}
const request = (path, options) => new Request('https://laundry-customer.example' + path, options);
test('serves known SPA routes with security headers but never converts missing assets or API paths to HTML', async () => {
  for (const path of ['/', '/checkout', '/orders/00000000-0000-4000-8000-000000000001']) {
    const response = await web.fetch(request(path), env());
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-frame-options'), 'DENY'); assert.equal(response.headers.get('x-laundry-revision'), 'a'.repeat(40));
  }
  for (const path of ['/missing.js', '/.env', '/secret.sql', '/missing-page', '/v1/orders']) assert.equal((await web.fetch(request(path), env())).status, 404);
  const api = await web.fetch(request('/v2/catalog/services', { headers: { accept: 'text/html' } }), env());
  assert.equal(api.status, 503); assert.equal((await api.json()).code, 'PROVIDER_UNAVAILABLE');
});
test('rider and operations shells do not inherit customer SPA routes', async () => {
  for (const app of ['partner', 'ops']) {
    assert.equal((await web.fetch(request('/'), env(app))).status, 200);
    assert.equal((await web.fetch(request('/checkout'), env(app))).status, 404);
  }
});
test('reports hosting liveness separately from deferred messaging/order readiness', async () => {
  const response = await web.fetch(request('/health'), env());
  assert.equal(response.status, 200); const data = await response.json();
  assert.equal(data.productionReady, false); assert.equal(data.messagingEnabled, false); assert.equal(data.orderingEnabled, false);
  assert.equal((await web.fetch(request('/health/ready'), env())).status, 503);
});
test('pins the native API origin and refuses credentials, redirects and alternate origins', () => {
  assert.equal(apiOrigin(native), native);
  for (const value of ['http://example.com', 'https://example.com', native + '/evil', native + '?secret=yes', native + '#fragment', native.replace('https://', 'https://user:pass@')]) assert.throws(() => apiOrigin(value));
});
test('forwards raw mutation bytes and retained command key once, with only the server ingress secret', async t => {
  const fixture = env(); fixture.API_ORIGIN = native;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++; assert.equal(url, native + '/v2/orders'); assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.get('x-laundry-origin-secret'), fixture.API_ORIGIN_SECRET);
    assert.equal(options.headers.get('authorization'), 'Bearer opaque'); assert.equal(options.headers.get('idempotency-key'), 'stable-intent');
    assert.equal(options.headers.get('x-forwarded-for'), null); assert.equal(new TextDecoder().decode(options.body), '{ "exact": true }');
    return new Response('{"id":"order"}', { headers: { 'content-type': 'application/json', 'set-cookie': 'must-not-forward=yes' } });
  });
  const response = await web.fetch(request('/v2/orders', { method: 'POST', headers: { authorization: 'Bearer opaque', 'idempotency-key': 'stable-intent', 'x-laundry-origin-secret': 'attacker', 'x-forwarded-for': 'attacker' }, body: '{ "exact": true }' }), fixture);
  assert.equal(calls, 1); assert.equal(response.status, 200); assert.equal(response.headers.get('set-cookie'), null); assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('rejects oversized mutations before contacting the origin', async t => {
  const fixture = env(); fixture.API_ORIGIN = native;
  t.mock.method(globalThis, 'fetch', () => { throw new Error('must not send'); });
  assert.equal((await web.fetch(request('/v2/orders', { method: 'POST', body: 'x'.repeat(65_537) }), fixture)).status, 413);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});
test('lost mutation responses remain unknown without an automatic retry', async t => {
  const fixture = env(); fixture.API_ORIGIN = native;
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('synthetic lost response'); });
  const response = await web.fetch(request('/v2/orders', { method: 'POST', body: '{}' }), fixture);
  assert.equal(response.status, 503); assert.equal((await response.json()).code, 'PROVIDER_OUTCOME_UNKNOWN'); assert.equal(globalThis.fetch.mock.callCount(), 1);
});
test('does not follow or expose origin redirects', async t => {
  const fixture = env(); fixture.API_ORIGIN = native;
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.invalid' } }));
  const response = await web.fetch(request('/v2/identity/me'), fixture);
  assert.equal(response.status, 503); assert.equal(response.headers.get('location'), null); assert.equal(globalThis.fetch.mock.callCount(), 1);
});
