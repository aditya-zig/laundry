import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertAuditRemediable, assertPatchedRsa, verifyInstalledBackport } from './release-security.mjs';

function audit() {
  return {
    advisories: { one: { github_advisory_id: 'GHSA-86w9-cpqp-85rv', module_name: 'node-forge', severity: 'high', vulnerable_versions: '<=1.4.0', patched_versions: '<0.0.0', cves: ['CVE-2026-85393'], findings: [{ version: '1.4.0', paths: ['apps__customer>expo>@expo/cli>node-forge'] }] } },
    muted: [], metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 } },
  };
}
test('recognizes only the exact advisory addressed by the reviewed source backport', () => {
  assertAuditRemediable(audit());
});
for (const [name, change] of [
  ['another advisory', x => { x.advisories.two = { ...x.advisories.one, github_advisory_id: 'OTHER' }; }],
  ['changed advisory', x => { x.advisories.one.github_advisory_id = 'OTHER'; }],
  ['another affected package', x => { x.advisories.one.module_name = 'another-package'; }],
  ['another installed version', x => { x.advisories.one.findings[0].version = '1.3.1'; }],
  ['another CVE', x => { x.advisories.one.cves.push('CVE-OTHER'); }],
  ['a now-published fixed version', x => { x.advisories.one.patched_versions = '>=1.4.1'; }],
  ['extra vulnerability totals', x => { x.metadata.vulnerabilities.moderate = 1; }],
  ['muted advisories', x => { x.muted = ['something']; }],
  ['an audit service error', x => { x.error = { code: 'OFFLINE' }; }],
  ['missing findings', x => { x.advisories.one.findings = []; }],
  ['no advisory evidence', x => { x.advisories = {}; }],
]) {
  test(`refuses ${name}`, () => {
    const value = audit(); change(value);
    assert.throws(() => assertAuditRemediable(value));
  });
}
test('cannot call an arbitrary or noop RSA implementation remediated', () => {
  assert.throws(() => assertPatchedRsa(Buffer.from('module.exports = {}')), /reviewed security backport/);
});
test('both apps and every known forge consumer resolve the reviewed code and pass actual RSA verification', () => {
  assert(verifyInstalledBackport() >= 1);
});
