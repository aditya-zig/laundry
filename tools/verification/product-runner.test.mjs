import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('a rejected product launch clears stale product evidence without touching legacy evidence or connecting remotely', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'laundry-product-launch-'));
  try {
    const root = join(cwd, '.verification'); await mkdir(root);
    for (const file of ['product-results.json', 'product-manifest.json', 'manifest.json']) await writeFile(join(root, file), 'earlier evidence');
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./run.mjs', import.meta.url))], {
      cwd, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, VERIFY_WEB_SCOPE: 'product', DATABASE_URL: 'postgres://test:test@remote.invalid/production' },
    });
    assert.ifError(result.error); assert.equal(result.status, 1);
    assert.match(result.stderr, /loopback verification database/i);
    for (const file of ['product-results.json', 'product-manifest.json']) await assert.rejects(access(join(root, file)), { code: 'ENOENT' });
    assert.equal(await readFile(join(root, 'manifest.json'), 'utf8'), 'earlier evidence');
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
