// Actual rider export and compiled HTTP services; synthetic OTP/code and bags only.
const { expect } = require('@playwright/test');
const { writeFile } = require('node:fs/promises');
const { resolve, relative } = require('node:path');
const { reviewViewport } = require('./viewports.mjs');
const { recordingCheckpoint } = require('./recording-checkpoint.mjs');
async function riderCustodyJourney(browser, fixture, output, leg = 'RETURN') {
  if (!browser || !['PICKUP', 'RETURN'].includes(leg)) throw Error('Owned verification browser and known leg required');
  const proof = await fixture.syntheticRiderProof(leg);
  const prefix = leg === 'PICKUP' ? 'rider-pickup' : 'rider';
  const acceptedBefore = leg === 'RETURN' && fixture.pickupBagId ? 1 : 0;
  const statusBefore = leg === 'PICKUP' ? 'CONFIRMED' : 'READY_FOR_RETURN';
  const statusAfter = leg === 'PICKUP' ? 'PICKUP_PENDING' : 'RETURNING';
  expect(await fixture.syntheticRiderEvidence(leg)).toEqual({ accepted_audits: acceptedBefore, code_attempts: 0, custody_handovers: 0, order_status: statusBefore });
  const viewport = reviewViewport({ width: 390, height: 844 });
  const context = await browser.newContext({ viewport, recordVideo: { dir: resolve(output, 'videos'), size: viewport } });
  const page = await context.newPage(), accepts = [], handovers = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    const value = { key: request.headers()['idempotency-key'], body: request.postData() };
    if (request.url().endsWith(`/rider/jobs/${proof.jobId}/accept`)) accepts.push(value);
    if (request.url().endsWith('/v2/rider/handovers')) {
      expect(request.postDataJSON().jobId).toBe(proof.jobId);
      handovers.push(value);
    }
  });
  try {
    await page.goto('http://127.0.0.1:4221', { waitUntil: 'networkidle' });
    await page.getByLabel('Phone number', { exact: true }).fill(proof.phone);
    await page.getByRole('button', { name: 'Request sign-in code', exact: true }).click();
    await expect(page.getByLabel('One-time code', { exact: true })).toBeVisible();
    await page.getByLabel('One-time code', { exact: true }).fill(fixture.syntheticRiderOtp(proof.phone));
    await page.getByRole('button', { name: 'Verify and sign in', exact: true }).click();
    await page.getByTestId(`rider-job-${proof.jobId}`).click();
    await expect(page.getByText(proof.code, { exact: true })).toHaveCount(0);
    if (leg === 'PICKUP') await page.getByLabel('Pickup bag-label UUIDs', { exact: true }).fill(proof.bagId);
    const code = page.getByLabel('Custody code', { exact: true });
    await code.fill(proof.code === '000000' ? '000001' : '000000');
    await page.getByLabel('Garment count', { exact: true }).fill('12');
    if (leg === 'PICKUP') {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: resolve(output, 'rider-pickup-form-mobile.png'), fullPage: true });
      await page.setViewportSize(reviewViewport({ width: 1280, height: 900 }));
      await page.screenshot({ path: resolve(output, 'rider-pickup-form-desktop.png'), fullPage: true });
      await page.setViewportSize(reviewViewport({ width: 390, height: 844 }));
    }
    await expect(page.getByRole('button', { name: 'Record custody handover', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Confirm rider assignment', exact: true }).click();
    await expect(page.getByText(/Acceptance outcome unknown\./)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm rider assignment', exact: true }).click();
    await expect(page.getByText('Assignment acknowledged', { exact: true })).toBeVisible();
    expect(accepts).toHaveLength(2); expect(accepts[0].key).toBeTruthy(); expect(accepts[1]).toEqual(accepts[0]);
    await page.getByRole('button', { name: 'Record custody handover', exact: true }).click();
    await expect(page.getByText('Custody not recorded', { exact: true })).toBeVisible();
    await expect(code).toHaveValue('');
    expect(await fixture.syntheticRiderEvidence(leg)).toEqual({ accepted_audits: acceptedBefore + 1, code_attempts: 1, custody_handovers: 0, order_status: statusBefore });
    await code.fill(proof.code);
    await page.getByRole('button', { name: 'Record custody handover', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry retained custody request', exact: true })).toBeVisible();
    await expect(code).toHaveCount(0); // Ambiguous proof is immutable, not a new editable form.
    await page.getByRole('button', { name: 'Retry retained custody request', exact: true }).click();
    await expect(page.getByText(/Custody recorded/i).first()).toBeVisible();
    expect(handovers).toHaveLength(3); expect(handovers[1].key).toBeTruthy(); expect(handovers[2]).toEqual(handovers[1]);
    expect(JSON.parse(handovers[0].body).actionId).not.toBe(JSON.parse(handovers[1].body).actionId);
    if (leg === 'PICKUP') expect(JSON.parse(handovers[1].body).containerIds).toEqual([proof.bagId]);
    const facts = await fixture.syntheticRiderEvidence(leg);
    expect(facts).toEqual({ accepted_audits: acceptedBefore + 1, code_attempts: 1, custody_handovers: 1, order_status: statusAfter });
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(output, `${prefix}-custody-mobile.png`), fullPage: true });
    await page.setViewportSize(reviewViewport({ width: 1280, height: 900 }));
    await page.screenshot({ path: resolve(output, `${prefix}-custody-desktop.png`), fullPage: true });
    if (leg === 'RETURN') await recordingCheckpoint(page, 'return-proof');
    const result = { status: 'passed', syntheticOnly: true, actualRiderBrowser: true, sameAcceptanceKeyAndBody: true, sameHandoverKeyAndBody: true,
      wrongCodeRejected: true, assignmentRequiredBeforeProof: true, noPrematureDelivery: true, riderLeg: leg, pickupBrowserProven: leg === 'PICKUP', physicalCustodyProven: false, nativeDeviceProven: false, ...facts, browserErrors: errors,
      video: relative(output, await page.video().path()) };
    await writeFile(resolve(output, `${prefix}-result.json`), JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    await page.screenshot({ path: resolve(output, `${prefix}-failed.png`), fullPage: true }).catch(() => {});
    await writeFile(resolve(output, `${prefix}-failed-body.txt`), await page.locator('body').innerText()).catch(() => {});
    throw error;
  } finally { await context.close(); }
}
module.exports = { riderCustodyJourney };
