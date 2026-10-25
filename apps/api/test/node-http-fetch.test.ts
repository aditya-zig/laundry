import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createNodeFetchHandler } from '../src/node-http-fetch';

const secret = randomBytes(32).toString('hex');
const owned: ReturnType<typeof createNodeFetchHandler>[] = [];
function bridge(handler: (req: IncomingMessage, res: ServerResponse) => void, options: { maxBodyBytes?: number; timeoutMs?: number } = {}) {
  let startups = 0;
  const adapter = createNodeFetchHandler(async () => {
    startups++;
    const server = createServer(handler);
    return { server, close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections(); server.close(error => error ? reject(error) : resolve());
    }) };
  }, { originSecret: secret, ...options });
  owned.push(adapter);
  return { adapter, startups: () => startups };
}
function request(path = '/', init: RequestInit = {}) {
  const headers = new Headers(init.headers); headers.set('x-laundry-origin-secret', secret);
  return new Request('https://laundry.example.test' + path, { ...init, headers });
}
afterEach(async () => { for (const adapter of owned.splice(0)) await adapter.close(); });

describe('compiled Node HTTP to Fetch host boundary', () => {
  it('refuses untrusted native-origin traffic before allocating an application', async () => {
    const item = bridge((_req, res) => res.end('not reached'));
    expect((await item.adapter.fetch(new Request('https://origin.example.test/'))).status).toBe(401);
    expect(item.startups()).toBe(0);
  });

  it('starts one loopback server for concurrent requests and cannot route a //host path away', async () => {
    const item = bridge((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ path: req.url })); });
    const results = await Promise.all([1, 2, 3].map(() => item.adapter.fetch(request('//attacker.example.test/private?q=1'))));
    for (const response of results) expect(await response.json()).toEqual({ path: '//attacker.example.test/private?q=1' });
    expect(item.startups()).toBe(1);
  });

  it('preserves untouched body, bearer and retry identity but strips ingress and forged proxy headers', async () => {
    const item = bridge((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(Buffer.from(chunk)));
      req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ raw: Buffer.concat(chunks).toString('utf8'), headers: req.headers })); });
    });
    const raw = '{  "signed": true,\n "amountMinor": 100 }';
    const response = await item.adapter.fetch(request('/v2/webhooks/payments/example', { method: 'POST', body: raw,
      headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic', 'Idempotency-Key': 'same-command', forwarded: 'for=attacker', 'x-forwarded-for': 'attacker', 'x-laundry-client-ip': 'forged' },
    }));
    const result = await response.json();
    expect(result.raw).toBe(raw);
    expect(result.headers).toMatchObject({ authorization: 'Bearer synthetic', 'idempotency-key': 'same-command' });
    for (const name of ['x-laundry-origin-secret', 'x-laundry-client-ip', 'x-forwarded-for', 'forwarded']) expect(result.headers[name]).toBeUndefined();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects oversized streamed bodies without starting the API', async () => {
    const item = bridge((_req, res) => res.end(), { maxBodyBytes: 4 });
    const response = await item.adapter.fetch(request('/v2/orders', { method: 'POST', body: 'too-large' }));
    expect(response.status).toBe(413); expect(item.startups()).toBe(0);
  });

  it('cancels a stalled upload before starting the API', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const item = bridge((_req, res) => res.end(), { timeoutMs: 20 });
    const response = await item.adapter.fetch(request('/v2/orders', { method: 'POST', body: stream, ...{ duplex: 'half' } }));
    expect(response.status).toBe(400); expect(item.startups()).toBe(0); expect(cancelled).toBe(true);
  });

  it('does not follow application redirects to another origin', async () => {
    const item = bridge((_req, res) => { res.statusCode = 302; res.setHeader('Location', 'https://attacker.invalid/collect'); res.end(); });
    const response = await item.adapter.fetch(request('/redirect'));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://attacker.invalid/collect');
    await response.arrayBuffer();
  });

  it('reports a timed-out mutation as unknown and never sends it twice', async () => {
    let calls = 0;
    const item = bridge(() => { calls++; }, { timeoutMs: 30 });
    const response = await item.adapter.fetch(request('/v2/orders', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'PROVIDER_OUTCOME_UNKNOWN' });
    expect(calls).toBe(1);
  });
});
