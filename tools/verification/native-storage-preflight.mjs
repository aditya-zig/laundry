import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

// Static native JavaScript/config evidence only. Never substitutes for a binary,
// SQLCipher execution, device force-stop, keychain or live-provider acceptance.
const output = resolve('.verification/native-storage-preflight.json');
await mkdir(resolve('.verification'), { recursive: true });
await rm(output, { force: true });
const directories = process.argv.slice(2);
assert.equal(directories.length, 2, 'Pass the customer and rider Android JS export directories');
const compiled = await import(pathToFileURL(resolve('packages/app-foundation/dist/index.js')).href);
assert.equal(typeof compiled.openNativeSqliteSessionStores, 'function', 'Build the updated foundation before exporting native apps');
const sha = data => createHash('sha256').update(data).digest('hex');
const apps = [];
for (const [index, app] of ['customer', 'partner'].entries()) {
  const role = app === 'customer' ? 'customer' : 'rider';
  const config = JSON.parse(await readFile(resolve(`apps/${app}/app.json`), 'utf8')).expo;
  assert.equal(config.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-sqlite')?.[1]?.useSQLCipher, true);
  assert.equal(config.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-secure-store')?.[1]?.configureAndroidBackup, true);
  const root = await realpath(directories[index]);
  const metadataBytes = await readFile(resolve(root, 'metadata.json'));
  const metadata = JSON.parse(metadataBytes.toString('utf8'));
  const name = metadata.fileMetadata?.android?.bundle;
  assert.equal(typeof name, 'string');
  assert.match(name, /^_expo\/static\/js\/android\/[^/]+\.js$/);
  const bundlePath = await realpath(resolve(root, name));
  const within = relative(root, bundlePath);
  assert.ok(!isAbsolute(within) && within !== '..' && !within.startsWith('../'), 'Bundle must remain inside its own export');
  const bundle = await readFile(bundlePath);
  const text = bundle.toString('utf8');
  for (const expected of [
    'This runtime has no SQLCipher',
    'Native protected stores and a secure UUID source must be ready',
    'The pending journal key does not match its retained intent',
    `laundry-${role}-session-v1.db`, `laundry-${role}-journal-key-v1`,
    'Preparing protected session', 'ExpoSQLite',
  ]) assert.ok(text.includes(expected), `${role} export is missing the expected protected native wiring: ${expected}`);
  apps.push({ role, metadataSha256: sha(metadataBytes), bundleSha256: sha(bundle), bytes: bundle.length });
}
const result = { status: 'passed', scope: 'native-storage-static-preflight',
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()), apps,
  nativeDeviceProven: false, androidBinaryBuilt: false, encryptionProven: false, liveProvidersProven: false };
await writeFile(output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
console.log('PASS: native config, fresh compiled API and both Android JS bundles; NOT native device/binary/encryption acceptance.');
