import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createPreviewServer } from './serve-web.mjs';

let directory, server, port;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'laundry-spa-'));
  const root = join(directory, 'dist');
  await mkdir(join(root, 'assets/.pnpm'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<html>Demo application</html>');
  await writeFile(join(root, 'entry.js'), 'console.log("app")');
  await writeFile(join(root, 'assets/.pnpm/icon.ttf'), 'font');
  await writeFile(join(root, '.env'), 'private');
  await writeFile(join(directory, 'outside'), 'outside private');
  await symlink(join(directory, 'outside'), join(root, 'escape.txt'));
  server = await createPreviewServer(root);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = server.address().port;
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function get(path, options = {}) {
  // http.request preserves raw encoded paths that fetch's URL parser normalizes.
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, ...options }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('fresh browser navigation and refresh of a deep route receive the app shell', async () => {
  for (const path of ['/', '/services/garment?note=%E0%A4%95', '/orders/order-1']) {
    const result = await get(path, { headers: { accept: 'text/html,application/xhtml+xml' } });
    assert.equal(result.status, 200);
    assert.equal(result.body, '<html>Demo application</html>');
    assert.match(result.headers['content-type'], /^text\/html/);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(result.headers['x-content-type-options'], 'nosniff');
  }
});

test('real scripts and Expo font paths keep their own content types', async () => {
  const script = await get('/entry.js?v=1');
  assert.equal(script.status, 200);
  assert.match(script.headers['content-type'], /^application\/javascript/);
  assert.equal(script.body, 'console.log("app")');
  const font = await get('/assets/.pnpm/icon.ttf');
  assert.equal(font.status, 200);
  assert.equal(font.headers['content-type'], 'font/ttf');
});

test('missing assets, API paths and non-navigation requests never receive HTML fallback', async () => {
  for (const path of ['/missing.js', '/assets/missing', '/_expo/missing', '/api/orders', '/v1/orders']) {
    const result = await get(path, { headers: { accept: 'text/html' } });
    assert.equal(result.status, 404, path);
    assert.equal(result.body, 'Not found');
  }
  assert.equal((await get('/orders/order-1')).status, 404);
});

test('HEAD retains metadata but has no body; mutation methods are rejected', async () => {
  const head = await get('/services/garment', { method: 'HEAD', headers: { accept: 'text/html' } });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers['content-length']), Buffer.byteLength('<html>Demo application</html>'));
  assert.equal(head.body, '');
  const post = await get('/orders/order-1', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
});

test('malformed, traversal, hidden-file and external symlink paths cannot expose private files', async () => {
  for (const path of ['/%', '/%2e%2e/outside', '/.%2e/outside', '/%5c..%5coutside', '/%00', '/.env']) {
    const result = await get(path);
    assert.equal(result.status, 400, path);
    assert.equal(result.body, 'Invalid path');
  }
  const escaped = await get('/escape.txt');
  assert.equal(escaped.status, 404);
  assert.equal(escaped.body, 'Not found');
});
