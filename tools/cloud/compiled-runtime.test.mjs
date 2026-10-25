import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeNodePackage } from '../build-node.mjs';

test('compiled CommonJS executes under Node without a TypeScript development loader', async () => {
  const root = await mkdtemp(join(tmpdir(), 'laundry-node-build-'));
  try {
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    const output = join(root, 'dist');
    await mkdir(output);
    const entry = join(output, 'entry.js');
    await writeFile(entry, 'exports.result = 42; console.log(exports.result);');
    const before = spawnSync(process.execPath, [entry], { encoding: 'utf8' });
    assert.equal(before.status, 1);
    await writeNodePackage(output);
    const after = spawnSync(process.execPath, [entry], { encoding: 'utf8' });
    assert.ifError(after.error);
    assert.equal(after.status, 0, after.stderr);
    assert.equal(after.stdout.trim(), '42');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('node packaging CLI refuses unknown applications instead of writing arbitrary output paths', () => {
  const result = spawnSync(process.execPath, [new URL('../build-node.mjs', import.meta.url).pathname, '../outside'], { encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
});
