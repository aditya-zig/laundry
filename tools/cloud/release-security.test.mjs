import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertAuditClean, assertReviewedRsa, verifyInstalledForge } from './release-security.mjs';

function audit() {
  return { advisories: {}, muted: [], metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } } };
}
test('accepts a valid clean audit without a backport waiver', () => {
  assertAuditClean(audit());
});
for (const [name, change] of [
  ['the formerly waived RSA advisory', x => { x.advisories.one = { github_advisory_id: 'GHSA-86w9-cpqp-85rv', severity: 'high' }; x.metadata.vulnerabilities.high = 1; }],
  ['an unexpected moderate advisory', x => { x.advisories.one = { severity: 'moderate' }; }],
  ['a high advisory despite zero totals', x => { x.advisories.one = { severity: 'high' }; }],
  ['critical vulnerability totals', x => { x.metadata.vulnerabilities.critical = 1; }],
  ['muted advisories', x => { x.muted = ['something']; }],
  ['an audit service error', x => { x.error = { code: 'OFFLINE' }; }],
  ['missing advisory evidence', x => { delete x.advisories; }],
  ['an array instead of an advisory map', x => { x.advisories = []; }],
  ['missing vulnerability totals', x => { delete x.metadata.vulnerabilities; }],
  ['an unknown severity', x => { x.advisories.one = { severity: 'other' }; }],
]) {
  test(`refuses ${name}`, () => {
    const value = audit(); change(value);
    assert.throws(() => assertAuditClean(value));
  });
}
test('preserves low/info reporting at the existing moderate release threshold', () => {
  const value = audit(); value.advisories.one = { severity: 'low' }; value.metadata.vulnerabilities.low = 1;
  assertAuditClean(value);
});
test('cannot call an arbitrary or noop RSA implementation reviewed', () => {
  assert.throws(() => assertReviewedRsa(Buffer.from('module.exports = {}')), /reviewed published release/);
});
test('both apps and every known forge consumer resolve the published fix and pass actual RSA verification', () => {
  assert(verifyInstalledForge() >= 1);
});
