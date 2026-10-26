import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createManifest, validateManifest, REQUIRED_PRODUCT_SCENARIOS } from './evidence.mjs';

const sha = 'a'.repeat(40);
const roles = ['customer', 'ops', 'pickupRider', 'rider'];
function receipt() {
  const leg = (riderLeg, status, accepted_audits) => ({ status: 'passed', riderLeg, actualRiderBrowser: true,
    sameAcceptanceKeyAndBody: true, sameHandoverKeyAndBody: true, assignmentRequiredBeforeProof: true,
    wrongCodeRejected: true, noPrematureDelivery: true, accepted_audits, code_attempts: 1,
    custody_handovers: 1, order_status: status, syntheticOnly: true, physicalCustodyProven: false,
    nativeDeviceProven: false, browserErrors: [] });
  return { status: 'passed', sourceRevision: sha, sourceDirty: false, scope: 'customer-ops-rider',
    syntheticOnly: true, commercialCalls: 0, orders: 1, legs: 2, obligations: 1, accepted_decisions: 1,
    confirmed_events: 1, browserErrors: [], pickupBrowserProven: true, pickupBagContinuity: true,
    sameBookingKeyAndBody: true, sameAdjustmentKeyAndBody: true, sameReviewKeyAndBody: true,
    sameSupportCaseKeyAndBody: true, sameSupportMessageKeyAndBody: true, ownedBillingRecordsVisible: true,
    manualReceiptNotGatewayCapture: true, failedReadNotZeroBalance: true,
    customerDeepLinkReloadProven: true, customerBagQuantityEditsProven: true,
    pickupRiderBrowser: leg('PICKUP', 'PICKUP_PENDING', 1), riderBrowser: leg('RETURN', 'RETURNING', 2),
    recordings: Object.fromEntries(roles.map(role => [role, `videos/${role}.webm`])) };
}
function report(proof = receipt()) {
  return { suites: [{ specs: [{ title: 'E2E-PRODUCT: task-only unit fixture', tests: [{ status: 'expected',
    expectedStatus: 'passed', results: [{ status: 'passed', attachments: [
      ...roles.map(role => ({ name: `video-${role}`, path: `${role}.webm`, contentType: 'video/webm' })),
      { name: 'qualified-product-receipt', contentType: 'application/json', body: Buffer.from(JSON.stringify(proof)).toString('base64') },
    ] }] }] }] }] };
}
async function inFixture(body) {
  const root = await mkdtemp(join(tmpdir(), 'laundry-product-evidence-'));
  try {
    for (const role of roles) await writeFile(join(root, `${role}.webm`), `Synthetic unit-test media: ${role}`);
    await body(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
const create = (root, input = report()) => createManifest({ report: input, root, headSha: sha, testedSha: sha,
  baseSha: 'b'.repeat(40), dirty: false, scope: 'product' });
const validate = (root, manifest) => validateManifest(manifest, { root, headSha: sha, scope: 'product',
  requiredScenarios: REQUIRED_PRODUCT_SCENARIOS });

test('current-product evidence requires its own explicit scope, one passed run and four role videos', async () => {
  await inFixture(async root => {
    const manifest = await create(root);
    assert.equal(manifest.version, 2); assert.equal(manifest.kind, 'product');
    await validate(root, manifest);
    await assert.rejects(validateManifest(manifest, { root, headSha: sha }), /scope/i);
    const legacy = await createManifest({ report: report(), root, headSha: sha, testedSha: sha, baseSha: sha, dirty: false });
    await assert.rejects(validate(root, legacy), /scope/i);
  });
});

test('current-product evidence rejects missing, duplicated, substituted or changed role footage', async () => {
  await inFixture(async root => {
    const manifest = await create(root);
    for (const videos of [manifest.scenarios[0].videos.slice(1), Array(4).fill(manifest.scenarios[0].videos[0]),
      manifest.scenarios[0].videos.map(video => ({ ...video, role: 'other' }))]) {
      const invalid = structuredClone(manifest); invalid.scenarios[0].videos = videos;
      await assert.rejects(validate(root, invalid), /role|video|distinct/i);
    }
    const badDigest = structuredClone(manifest); badDigest.scenarios[0].receiptSha256 = 'f'.repeat(64);
    await assert.rejects(validate(root, badDigest), /hash/i);
    await writeFile(join(root, 'ops.webm'), 'Synthetic unit-test media: customer');
    await assert.rejects(validate(root, await create(root)), /distinct/i);
    await writeFile(join(root, 'ops.webm'), 'Synthetic unit-test media: ops');
    await writeFile(join(root, 'customer.webm'), 'changed after capture');
    await assert.rejects(validate(root, manifest), /hash|size/i);
  });
});

test('current-product receipts cannot omit or contradict app, custody, financial or replay guarantees', async () => {
  await inFixture(async root => {
    for (const change of [
      p => { p.sourceRevision = 'c'.repeat(40); }, p => { p.sourceDirty = true; },
      p => { p.syntheticOnly = false; }, p => { p.commercialCalls = 1; }, p => { p.orders = 2; },
      p => { p.productionReady = true; },
      p => { p.pickupBagContinuity = false; }, p => { p.customerBagQuantityEditsProven = false; },
      p => { p.customerDeepLinkReloadProven = false; }, p => { p.manualReceiptNotGatewayCapture = false; },
      p => { p.sameBookingKeyAndBody = false; }, p => { p.failedReadNotZeroBalance = false; },
      p => { p.pickupRiderBrowser.actualRiderBrowser = false; },
      p => { p.riderBrowser.noPrematureDelivery = false; }, p => { p.riderBrowser.order_status = 'DELIVERED'; },
      p => { p.riderBrowser.physicalCustodyProven = true; },
    ]) {
      const proof = receipt(); change(proof);
      await assert.rejects(validate(root, await create(root, report(proof))), /receipt|proof|scenario|revision|scope/i);
    }
    const missing = report(); missing.suites[0].specs[0].tests[0].results[0].attachments.pop();
    await assert.rejects(validate(root, await create(root, missing)), /receipt|scenario/i);
  });
});
