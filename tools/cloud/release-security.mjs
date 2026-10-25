import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const rsaSha256 = '5019e28f1429de036f4d13be23639c30b4ce6df7183676608a9888f2714674c9';
const advisoryId = 'GHSA-86w9-cpqp-85rv';

export function assertPatchedRsa(bytes) {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), rsaSha256, 'Installed RSA implementation is not the reviewed security backport');
}

export function assertAuditRemediable(audit) {
  assert(audit && !audit.error && audit.metadata?.vulnerabilities && audit.advisories && !Array.isArray(audit.advisories), 'Invalid audit response');
  assert.deepEqual(audit.muted ?? [], [], 'Muted advisories are not allowed');
  const entries = Object.values(audit.advisories);
  assert.equal(entries.length, 1, 'Unexpected security finding; refusing release');
  const item = entries[0];
  assert.equal(item.github_advisory_id, advisoryId, 'Unremediated advisory');
  assert.equal(item.module_name, 'node-forge');
  assert.equal(item.severity, 'high');
  assert.equal(item.vulnerable_versions, '<=1.4.0');
  assert.equal(item.patched_versions, '<0.0.0', 'A published fix must replace this temporary backport');
  assert.deepEqual(item.cves, ['CVE-2026-85393']);
  assert(Array.isArray(item.findings) && item.findings.length > 0);
  for (const finding of item.findings) assert.equal(finding.version, '1.4.0', 'Unreviewed forge version');
  assert.deepEqual(audit.metadata.vulnerabilities, { info: 0, low: 0, moderate: 0, high: 1, critical: 0 }, 'Unexpected vulnerability totals');
}

export function verifyInstalledBackport() {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const patch = manifest.pnpm?.patchedDependencies?.['node-forge@1.4.0'];
  assert.equal(patch, 'patches/node-forge@1.4.0.patch', 'The global forge backport must be pinned');
  const patchText = readFileSync(join(root, patch), 'utf8');
  assert.equal((patchText.match(/^diff --git /gm) ?? []).length, 1, 'Backport must change only RSA parsing');
  assert(patchText.startsWith('diff --git a/lib/rsa.js b/lib/rsa.js\n'), 'Unexpected backport scope');
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
      assert.equal(JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).version, '1.4.0');
      assertPatchedRsa(readFileSync(join(directory, 'lib/rsa.js')));
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
  // Preserve the upstream audit verbatim, including the version-based advisory.
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error || result.signal) { console.error('Dependency audit could not complete'); return 1; }
  if (![0, 1].includes(result.status)) return result.status ?? 1;
  try {
    const audit = JSON.parse(result.stdout);
    assert(audit && !audit.error && audit.metadata?.vulnerabilities && audit.advisories, 'Invalid audit response');
    const copies = verifyInstalledBackport();
    if (result.status === 1) assertAuditRemediable(audit);
    else {
      for (const level of ['moderate', 'high', 'critical']) assert.equal(audit.metadata.vulnerabilities[level], 0, 'Audit status disagrees with findings');
      for (const item of Object.values(audit.advisories)) assert(['info', 'low'].includes(item.severity), 'Unremediated advisory');
    }
    console.error(`Security backport VERIFIED in ${copies} installed implementation(s): ${advisoryId}; exact source digest and seven RSA regression cases passed. The upstream version advisory remains in the raw audit above.`);
    return 0;
  } catch (error) {
    console.error('Security verification FAILED:', error instanceof Error ? error.message : 'Invalid security evidence');
    return result.status || 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = main();
