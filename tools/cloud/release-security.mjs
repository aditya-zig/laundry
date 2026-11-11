import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const forgeVersion = '1.4.3';
// Published 1.4.3 canonical-DER verification, checked alongside real signature cases.
const rsaSha256 = '6632e195295ce76f6bb9131ee770dcd6cc1ee4ffac7906302208b00faf95a87f';

export function assertReviewedRsa(bytes) {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), rsaSha256, 'Installed RSA implementation is not the reviewed published release');
}

/** The raw registry evidence stays visible. No advisory is waived or muted. */
export function assertAuditClean(audit) {
  assert(audit && !audit.error && audit.metadata?.vulnerabilities && audit.advisories && typeof audit.advisories === 'object' && !Array.isArray(audit.advisories), 'Invalid audit response');
  assert.deepEqual(audit.muted ?? [], [], 'Muted advisories are not allowed');
  for (const level of ['info', 'low', 'moderate', 'high', 'critical']) {
    const count = audit.metadata.vulnerabilities[level];
    assert(Number.isInteger(count) && count >= 0, 'Invalid vulnerability totals');
    if (!['info', 'low'].includes(level)) assert.equal(count, 0, 'Unremediated security findings; refusing release');
  }
  for (const item of Object.values(audit.advisories)) {
    assert(item && ['info', 'low'].includes(item.severity), 'Unremediated advisory; refusing release');
  }
}

export function verifyInstalledForge() {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.pnpm?.overrides?.['node-forge'], forgeVersion, 'The published forge fix must be pinned');
  assert(!Object.keys(manifest.pnpm?.patchedDependencies ?? {}).some(name => name.startsWith('node-forge@')), 'Remove the superseded temporary forge backport');
  const installations = new Set();
  const chains = [
    ['expo', '@expo/cli', 'node-forge'],
    ['expo', '@expo/cli', '@expo/code-signing-certificates', 'node-forge'],
    ['expo', '@expo/cli', '@react-native/dev-middleware', 'selfsigned', 'node-forge'],
    ['react-native', '@react-native/community-cli-plugin', '@react-native/dev-middleware', 'selfsigned', 'node-forge'],
  ];
  for (const app of ['customer', 'partner']) {
    for (const chain of chains) {
      let require = createRequire(join(root, 'apps', app, 'package.json'));
      let path;
      for (const name of chain) {
        path = require.resolve(`${name}/package.json`);
        require = createRequire(path);
      }
      const directory = realpathSync(dirname(path));
      assert.equal(JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).version, forgeVersion);
      assertReviewedRsa(readFileSync(join(directory, 'lib/rsa.js')));
      installations.add(directory);
    }
  }
  assert(installations.size > 0);
  for (const directory of installations) {
    const result = spawnSync(process.execPath, [join(root, 'tools/cloud/forge-regression.cjs'), directory], { encoding: 'utf8', timeout: 15_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `RSA regression failed:\n${result.stdout}\n${result.stderr}`);
  }
  return installations.size;
}

export function main() {
  const result = spawnSync('pnpm', ['audit', '--prod', '--audit-level', 'moderate', '--json'], { cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error || result.signal) { console.error('Dependency audit could not complete'); return 1; }
  if (![0, 1].includes(result.status)) return result.status ?? 1;
  try {
    assertAuditClean(JSON.parse(result.stdout));
    assert.equal(result.status, 0, 'Audit exit disagrees with clean findings');
    const copies = verifyInstalledForge();
    console.error(`Published node-forge ${forgeVersion} VERIFIED in ${copies} installed implementation(s): exact source digest and seven RSA regression cases passed. No moderate, high or critical advisory waiver.`);
    return 0;
  } catch (error) {
    console.error('Security verification FAILED:', error instanceof Error ? error.message : 'Invalid security evidence');
    return result.status || 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = main();
