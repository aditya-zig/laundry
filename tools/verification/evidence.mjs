import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REQUIRED_WEB_SCENARIOS = Object.freeze(['SMOKE-CUSTOMER', 'SMOKE-RIDER', 'SMOKE-OPS', 'E2E-FULFILLMENT']);
export const REQUIRED_PRODUCT_SCENARIOS = Object.freeze(['E2E-PRODUCT']);
const PRODUCT_ROLES = ['customer', 'ops', 'pickupRider', 'rider'];
function requireScope(scope) {
  if (!['legacy', 'product'].includes(scope)) throw new Error('Unknown evidence scope.');
}
function receiptFields(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(actual?.[key]) !== JSON.stringify(value)) throw new Error(`Invalid product receipt proof: ${key}`);
  }
}
function validateProductReceipt(receipt, testedSha, dirty) {
  receiptFields(receipt, { status: 'passed', sourceRevision: testedSha, sourceDirty: dirty,
    scope: 'customer-ops-rider', syntheticOnly: true, commercialCalls: 0,
    orders: 1, legs: 2, obligations: 1, accepted_decisions: 1, confirmed_events: 1, browserErrors: [],
    pickupBrowserProven: true, pickupBagContinuity: true, customerDeepLinkReloadProven: true,
    customerBagQuantityEditsProven: true, customerPieceQuantityEditsProven: true,
    opsCatalogReadOnlyProven: true, opsCatalogFailedReadsNotEmptyOrZero: true,
    sameBookingKeyAndBody: true, sameAdjustmentKeyAndBody: true,
    sameReviewKeyAndBody: true, sameSupportCaseKeyAndBody: true, sameSupportMessageKeyAndBody: true,
    ownedBillingRecordsVisible: true, manualReceiptNotGatewayCapture: true, failedReadNotZeroBalance: true });
  if (receipt.productionReady !== undefined && receipt.productionReady !== false) throw new Error('Product receipt cannot claim production readiness.');
  for (const [proof, riderLeg, order_status, accepted_audits] of [
    [receipt.pickupRiderBrowser, 'PICKUP', 'PICKUP_PENDING', 1],
    [receipt.riderBrowser, 'RETURN', 'RETURNING', 2],
  ]) receiptFields(proof, { status: 'passed', riderLeg, order_status, accepted_audits,
    actualRiderBrowser: true, sameAcceptanceKeyAndBody: true, sameHandoverKeyAndBody: true,
    assignmentRequiredBeforeProof: true, wrongCodeRejected: true, noPrematureDelivery: true,
    code_attempts: 1, custody_handovers: 1, syntheticOnly: true, physicalCustodyProven: false,
    nativeDeviceProven: false, browserErrors: [] });
  if (JSON.stringify(Object.keys(receipt.recordings ?? {}).sort()) !== JSON.stringify([...PRODUCT_ROLES].sort())) throw new Error('Product receipt must identify all four role recordings.');
}

export function requireTestDatabase(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('An explicit loopback verification database is required.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/laundry_verify_[a-zA-Z0-9_]+$/.test(url.pathname)) {
    throw new Error('Use a loopback verification database named laundry_verify_<run>, never a shared or production database.');
  }
}
function contained(root, file) {
  const path = resolve(root, file); const rel = relative(resolve(root), path);
  if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Video path escapes the evidence directory.');
  return path;
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function testsFrom(suites) {
  return (suites ?? []).flatMap(suite => [...(suite.specs ?? []).flatMap(spec => (spec.tests ?? []).map(test => ({ spec, test }))), ...testsFrom(suite.suites)]);
}
export async function createManifest({ report, root, headSha, testedSha, baseSha, dirty, scope = 'legacy' }) {
  requireScope(scope);
  const scenarios = [];
  for (const { spec, test } of testsFrom(report.suites)) {
    const result = test.results?.at(-1); const videos = []; const errors = [];
    let productReceipt, receiptCount = 0;
    for (const attachment of result?.attachments ?? []) {
      if (scope === 'product' && attachment.name === 'qualified-product-receipt') {
        receiptCount++;
        try {
          if (attachment.contentType !== 'application/json') throw new Error('JSON receipt required');
          const bytes = attachment.path ? await readFile(contained(root, attachment.path)) : Buffer.from(attachment.body ?? '', 'base64');
          productReceipt = JSON.parse(bytes.toString('utf8'));
        } catch (error) { errors.push(`Invalid product receipt: ${error.message}`); }
        continue;
      }
      const role = scope === 'product' ? attachment.name?.replace(/^video-/, '') : undefined;
      if (scope === 'product' ? !attachment.name?.startsWith('video-') : attachment.name !== 'video') continue;
      try {
        if (scope === 'product' && !PRODUCT_ROLES.includes(role)) throw new Error('Unknown recorded role.');
        const path = contained(root, attachment.path);
        if (!/\.(mp4|webm|mov)$/i.test(path)) throw new Error('Video file has an unsupported extension.');
        const bytes = await readFile(path);
        if (!bytes.length) throw new Error('Video file is empty.');
        videos.push({ ...(scope === 'product' ? { role } : {}), path: relative(resolve(root), path), sizeBytes: bytes.length, sha256: digest(bytes) });
      } catch (error) { errors.push(`Missing or invalid video: ${error.message}`); }
    }
    if (scope === 'product' && receiptCount !== 1) errors.push('Exactly one qualified product receipt required.');
    scenarios.push({ id: spec.title, project: test.projectName ?? '', status: test.status === 'expected' && test.expectedStatus === 'passed' && result?.status === 'passed' && test.results.length === 1 ? 'passed' : 'failed', videos, errors,
      ...(scope === 'product' ? { productReceipt, receiptSha256: digest(JSON.stringify(productReceipt ?? null)) } : {}) });
  }
  return { version: scope === 'product' ? 2 : 1, kind: scope, createdAt: new Date().toISOString(), headSha, baseSha, testedSha, dirty, runId: process.env.GITHUB_RUN_ID ?? 'local', runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? '1',
    scope: scope === 'product' ? 'Current KG/pay-on-return synthetic web journey with four role sessions; not native, live authentication, physical fulfillment or whole-product readiness' : 'legacy web smoke and cross-role fulfillment; demo identity/payment, not native or production-v2 acceptance',
    ...(scope === 'product' ? { productionReady: false } : {}), scenarios };
}
export async function validateManifest(manifest, { root, headSha, requireClean = true, requiredScenarios = [], scope = 'legacy' }) {
  requireScope(scope);
  if (scope === 'product' ? manifest.kind !== 'product' || manifest.version !== 2 || manifest.productionReady !== false : manifest.kind === 'product' || manifest.version !== 1) throw new Error('Evidence scope mismatch.');
  if (manifest.headSha !== headSha) throw new Error('Stale evidence: PR head SHA does not match.');
  for (const key of ['headSha', 'baseSha', 'testedSha']) if (!/^[a-f0-9]{40}$/.test(manifest[key] ?? '')) throw new Error(`Invalid evidence commit: ${key}`);
  if (requireClean && manifest.dirty !== false) throw new Error('Dirty workspace evidence cannot approve a published revision.');
  if (!manifest.scenarios?.length) throw new Error('No recorded scenarios in evidence.');
  for (const id of requiredScenarios) if (!manifest.scenarios.some(s => s.id.startsWith(id + ':'))) throw new Error(`Missing required scenario: ${id}`);
  for (const scenario of manifest.scenarios) {
    if (scenario.status !== 'passed' || scenario.errors?.length || !scenario.videos?.length) throw new Error(`Scenario did not pass with video: ${scenario.id}`);
    if (scope === 'product') {
      if (JSON.stringify(scenario.videos.map(video => video.role).sort()) !== JSON.stringify([...PRODUCT_ROLES].sort()) || new Set(scenario.videos.map(video => video.sha256)).size !== 4 || new Set(scenario.videos.map(video => video.path)).size !== 4) throw new Error('Four distinct role videos are required.');
      validateProductReceipt(scenario.productReceipt, manifest.testedSha, manifest.dirty);
      if (digest(JSON.stringify(scenario.productReceipt)) !== scenario.receiptSha256) throw new Error('Product receipt hash mismatch.');
    }
    for (const video of scenario.videos) {
      let bytes;
      try { bytes = await readFile(contained(root, video.path)); } catch { throw new Error(`Missing video: ${video.path}`); }
      if (bytes.length !== video.sizeBytes || digest(bytes) !== video.sha256) throw new Error(`Video hash or size mismatch: ${video.path}`);
    }
  }
}
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
export async function writeEvidence({ exitCode = 0, scope = 'legacy' } = {}) {
  requireScope(scope);
  const root = resolve('.verification');
  const report = JSON.parse(await readFile(resolve(root, scope === 'product' ? 'product-results.json' : 'results.json'), 'utf8'));
  const testedSha = git('rev-parse', 'HEAD');
  const manifest = await createManifest({ report, root, testedSha, headSha: process.env.VERIFY_HEAD_SHA ?? testedSha, baseSha: process.env.VERIFY_BASE_SHA || git('rev-parse', 'origin/main'), dirty: Boolean(git('status', '--porcelain')), scope });
  const manifestFile = resolve(root, scope === 'product' ? 'product-manifest.json' : 'manifest.json');
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
  if (exitCode !== 0) throw new Error(`Browser checks failed (exit ${exitCode}); diagnostic evidence retained.`);
  await validateManifest(manifest, { root, headSha: process.env.VERIFY_HEAD_SHA ?? testedSha, requireClean: process.env.VERIFY_ALLOW_DIRTY !== '1', scope, requiredScenarios: scope === 'product' ? REQUIRED_PRODUCT_SCENARIOS : REQUIRED_WEB_SCENARIOS });
  console.log(`Verified ${scope} browser evidence: ${manifestFile}. This is not production-readiness approval.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeEvidence({ scope: process.env.VERIFY_WEB_SCOPE ?? 'legacy' }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
