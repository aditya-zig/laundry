import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');

function metroFor(app) {
  const appRequire = createRequire(new URL(`apps/${app}/package.json`, root));
  const nativeRequire = createRequire(appRequire.resolve('react-native/package.json'));
  const cliRequire = createRequire(nativeRequire.resolve('@react-native/community-cli-plugin/package.json'));
  const metroPackage = cliRequire.resolve('metro/package.json');
  return { assets: cliRequire(join(dirname(metroPackage), 'src/Assets.js')), require: createRequire(metroPackage) };
}

for (const app of ['customer', 'partner']) {
  test(`${app} router query dependency preserves Unicode, arrays and URL fragments`, () => {
    // Expo Router 4 imports query-string without declaring it; the apps must
    // supply this compatibility dependency even though their own source does not.
    const appRequire = createRequire(new URL(`apps/${app}/package.json`, root));
    const query = appRequire('query-string');
    assert.deepEqual({ ...query.parse('note=%E0%A4%95%E0%A4%AA%E0%A4%A1%E0%A4%BC%E0%A5%87&bag=a&bag=b&empty&space=a+b') }, {
      note: 'कपड़े', bag: ['a', 'b'], empty: null, space: 'a b',
    });
    const value = { order: 'bag / 1', note: 'कपड़े' };
    const url = query.stringifyUrl({ url: '/orders#receipt', query: value });
    const parsed = query.parseUrl(url, { parseFragmentIdentifier: true });
    assert.equal(parsed.url, '/orders');
    assert.equal(parsed.fragmentIdentifier, 'receipt');
    assert.deepEqual({ ...parsed.query }, value);
    assert.equal(query.parse('bad=%E0%A4%A&good=ok').good, 'ok');
  });

  test(`${app} Metro still reads image buffers with the patched decoder`, () => {
    const { assets } = metroFor(app);
    assert.deepEqual(assets.getAssetSize('png', pixel, 'pixel.png'), { width: 1, height: 1 });
    assert.equal(assets.getAssetSize('txt', Buffer.from('text'), 'note.txt'), null);
    assert.throws(() => assets.getAssetSize('png', Buffer.alloc(0), 'empty.png'), /cannot be an empty file/);
  });

  test(`${app} Metro retains filesystem and archive image-asset metadata`, async () => {
    const { assets } = metroFor(app);
    const directory = await mkdtemp(join(tmpdir(), 'laundry-metro-'));
    try {
      // Metro treats .zip/ paths as already-extracted archive buffers. Exercise
      // that branch too, rather than only the direct buffer API.
      for (const name of ['direct', 'archive.zip']) {
        const folder = join(directory, name);
        await mkdir(folder);
        const path = join(folder, 'pixel@2x.png');
        await writeFile(path, pixel);
        const data = await assets.getAssetData(path, 'pixel.png', [], null, '/assets');
        assert.equal(data.width, 0.5);
        assert.equal(data.height, 0.5);
        assert.deepEqual(data.scales, [2]);
        assert.deepEqual(data.files, [path]);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('malformed URI runs cannot hang the router query decoder', () => {
  const appRequire = createRequire(new URL('apps/customer/package.json', root));
  const queryPath = appRequire.resolve('query-string');
  const result = spawnSync(process.execPath, ['--input-type=commonjs', '-e', `
    const query = require(${JSON.stringify(queryPath)});
    const value = query.parse('note=' + '%C0%AF'.repeat(10_000));
    if (typeof value.note !== 'string' || !value.note.length) process.exit(2);
  `], { timeout: 5_000, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test('the public security gate preserves audit failures without advisory waivers', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const directory = await mkdtemp(join(tmpdir(), 'laundry-audit-gate-'));
  try {
    const executable = join(directory, 'pnpm');
    await writeFile(executable, `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.AUDIT_ARGUMENTS, JSON.stringify(process.argv.slice(2)));\nprocess.exit(37);\n`);
    await chmod(executable, 0o700);
    const result = spawnSync('/bin/sh', ['-c', manifest.scripts['release:security']], {
      cwd: directory,
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, AUDIT_ARGUMENTS: join(directory, 'arguments.json') },
      timeout: 5_000,
      encoding: 'utf8',
    });
    assert.ifError(result.error);
    assert.equal(result.status, 37, result.stderr);
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'arguments.json'), 'utf8')), ['audit', '--prod', '--audit-level', 'moderate']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('zero-length ICNS entries cannot hang the installed image decoder', () => {
  const { require } = metroFor('customer');
  const decoderPath = require.resolve('image-size');
  const result = spawnSync(process.execPath, ['--input-type=commonjs', '-e', `
    const { imageSize } = require(${JSON.stringify(decoderPath)});
    const input = Buffer.alloc(16);
    input.write('icns', 0);
    input.writeUInt32BE(16, 4);
    input.write('icp4', 8);
    input.writeUInt32BE(0, 12);
    try { imageSize(input); process.exit(2); }
    catch { process.exit(0); }
  `], { timeout: 5_000, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
