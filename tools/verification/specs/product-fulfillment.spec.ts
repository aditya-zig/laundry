import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFile, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, relative, isAbsolute } from 'node:path';

const require = createRequire(import.meta.url);

test('E2E-PRODUCT: current customer, pickup rider, facility, return rider and manual collection', async ({}, testInfo) => {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim());
  // Explicit synthetic configuration; no test may silently fall back to the
  // service-only custody path when the actual rider-app gate is requested.
  process.env.LAUNDRY_SYNTHETIC_ACCEPTANCE = 'true';
  process.env.LAUNDRY_VERIFY_OPS_FACILITY = 'true';
  process.env.LAUNDRY_VERIFY_RIDER = 'true';
  process.env.LAUNDRY_VERIFY_PICKUP = 'true';
  await require('../customer-v2-browser.cjs').run();
  const root = resolve('.data/browser-evidence/customer-v2');
  const receipt = JSON.parse(await readFile(resolve(root, 'result.json'), 'utf8'));
  expect(receipt).toMatchObject({ status: 'passed', sourceRevision: revision, sourceDirty: dirty,
    scope: 'customer-ops-rider', syntheticOnly: true, commercialCalls: 0,
    pickupBrowserProven: true, pickupBagContinuity: true, orders: 1, legs: 2, obligations: 1,
    accepted_decisions: 1, confirmed_events: 1, browserErrors: [],
    sameBookingKeyAndBody: true, sameAdjustmentKeyAndBody: true,
    sameReviewKeyAndBody: true, sameSupportCaseKeyAndBody: true, sameSupportMessageKeyAndBody: true,
    ownedBillingRecordsVisible: true, manualReceiptNotGatewayCapture: true, failedReadNotZeroBalance: true });
  for (const [proof, leg, state, acknowledgements] of [
    [receipt.pickupRiderBrowser, 'PICKUP', 'PICKUP_PENDING', 1],
    [receipt.riderBrowser, 'RETURN', 'RETURNING', 2],
  ]) {
    expect(proof).toMatchObject({ status: 'passed', riderLeg: leg, actualRiderBrowser: true,
      sameAcceptanceKeyAndBody: true, sameHandoverKeyAndBody: true,
      assignmentRequiredBeforeProof: true, wrongCodeRejected: true, noPrematureDelivery: true,
      accepted_audits: acknowledgements, code_attempts: 1, custody_handovers: 1, order_status: state,
      syntheticOnly: true, physicalCustodyProven: false, nativeDeviceProven: false, browserErrors: [] });
  }
  const recordings = Object.entries(receipt.recordings);
  expect(recordings.map(([role]) => role).sort()).toEqual(['customer', 'ops', 'pickupRider', 'rider']);
  expect(new Set(recordings.map(([, file]) => file)).size).toBe(4);
  for (const [role, file] of recordings) {
    expect(typeof file).toBe('string');
    const source = resolve(root, String(file));
    const path = relative(root, source);
    expect(isAbsolute(path) || path === '..' || path.startsWith('../')).toBe(false);
    expect(path).toMatch(/^videos\/.+\.webm$/);
    expect((await readFile(source)).length).toBeGreaterThan(0);
    const target = testInfo.outputPath(`${role}.webm`);
    await copyFile(source, target);
    await testInfo.attach('video', { path: target, contentType: 'video/webm' });
  }
  await testInfo.attach('qualified-product-receipt', { body: JSON.stringify(receipt, null, 2), contentType: 'application/json' });
});
