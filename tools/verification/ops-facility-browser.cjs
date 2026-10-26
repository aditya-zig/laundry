// Synthetic-only extension of the customer v2 HTTP/PostgreSQL browser journey.
// Staff MFA, actual pickup custody, physical QC and live providers are NOT proved.
const { expect } = require('@playwright/test');
const { readFile, writeFile } = require('node:fs/promises');
const { resolve, relative } = require('node:path');

function opsFacilityJourney(fixture) {
  let context, page;
  const intakeCalls = [], qualityPassCalls = [], errors = [];
  const output = resolve('.data/browser-evidence/customer-v2');
  const detail = () => page.locator('[aria-label="Selected order"]');
  const sameRetry = calls => {
    expect(calls).toHaveLength(2);
    expect(calls[0].key).toBeTruthy();
    expect(calls[1]).toEqual(calls[0]);
  };
  async function retryUnknown() {
    await expect(page.getByText('Outcome unknown.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Open order/ }).first()).toBeDisabled();
    await page.getByRole('button', { name: 'Retry with same key', exact: true }).click();
    await expect(page.getByText('Outcome unknown.', { exact: true })).toHaveCount(0);
  }
  async function captureFailure() {
    if (!page || page.isClosed()) return;
    try {
      await page.screenshot({ path: resolve(output, 'ops-failed.png'), fullPage: true });
      await writeFile(resolve(output, 'ops-failed-body.txt'), await page.locator('body').innerText());
    } catch { console.error('Could not capture the ops failure artifact; original test failure is retained.'); }
  }
  return {
    captureFailure,
    async proposeAdjustment(browser) {
      const { phone } = await fixture.prepareOps();
      context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, recordVideo: { dir: resolve(output, 'videos'), size: { width: 1280, height: 1000 } } });
      page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        if (request.method() !== 'POST') return;
        const record = { key: request.headers()['idempotency-key'], body: request.postData() };
        if (request.url().endsWith('/intake')) intakeCalls.push(record);
        if (request.url().endsWith('/quality-check') && request.postDataJSON().passed) qualityPassCalls.push(record);
      });
      await page.goto('http://127.0.0.1:4220', { waitUntil: 'networkidle' });
      await page.getByLabel('Staff phone', { exact: true }).fill(phone);
      await page.getByRole('button', { name: 'Request one-time code', exact: true }).click();
      await expect(page.getByLabel('6-digit one-time code', { exact: true })).toBeVisible();
      const otp = JSON.parse(await readFile('.data/customer-v2-private-otp.json', 'utf8'));
      await page.getByLabel('6-digit one-time code', { exact: true }).fill(otp.code);
      await page.getByRole('button', { name: 'Verify and sign in', exact: true }).click();
      await page.getByRole('button', { name: /^Open order/ }).first().click();
      const form = page.getByTestId('ops-intake-form');
      await expect(form).toBeVisible();
      await form.getByLabel('Measured weight (grams)', { exact: true }).fill('2400');
      await form.getByLabel('Counted items (including accessories)', { exact: true }).fill('12');
      const line = form.getByRole('group', { name: /^Line 1/ });
      await line.getByLabel('Condition', { exact: true }).selectOption('GOOD');
      const bag = form.getByRole('group', { name: 'Physical bag 1', exact: true });
      await bag.getByLabel('Seal or bag label', { exact: true }).fill('SYNTHETIC-SEAL-A');
      await bag.getByLabel('Garments in this bag', { exact: true }).fill('12');
      await bag.getByLabel('Condition', { exact: true }).selectOption('GOOD');
      await bag.getByLabel('Physically sealed', { exact: true }).check();
      await form.getByLabel('I checked the physical facts and bag labels.', { exact: true }).check();
      await page.screenshot({ path: resolve(output, 'ops-intake-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: resolve(output, 'ops-intake-mobile.png'), fullPage: true });
      await page.setViewportSize({ width: 1280, height: 1000 });
      await form.getByRole('button', { name: 'Submit measured intake', exact: true }).click();
      await retryUnknown();
      sameRetry(intakeCalls);
      await expect(detail().getByRole('button', { name: 'Start care', exact: true })).toBeDisabled();
      await expect(detail().getByText(/customer must accept or decline/i)).toBeVisible();
    },
    async finish() {
      try {
        await detail().getByRole('button', { name: 'Refresh', exact: true }).first().click();
        await detail().getByRole('button', { name: 'Start care', exact: true }).click();
        await detail().getByRole('button', { name: 'Send to quality check', exact: true }).click();
        let form = page.getByTestId('ops-quality-form');
        await form.getByLabel('Inspection result', { exact: true }).selectOption('REWORK');
        await form.getByLabel('Inspection note (required for rework)', { exact: true }).fill('Synthetic visible stain: rewash required');
        await form.getByLabel('I checked the physical facts and bag labels.', { exact: true }).check();
        await form.getByRole('button', { name: 'Submit inspection', exact: true }).click();
        await detail().getByRole('button', { name: 'Send to quality check', exact: true }).click();
        form = page.getByTestId('ops-quality-form');
        await form.getByLabel('Inspection result', { exact: true }).selectOption('PASS');
        await form.getByLabel('I checked the physical facts and bag labels.', { exact: true }).check();
        await form.getByRole('button', { name: 'Submit inspection', exact: true }).click();
        await retryUnknown();
        sameRetry(qualityPassCalls);
        await expect(detail().getByRole('button', { name: 'Dispatch return', exact: true })).toBeDisabled();
        const facts = await (await fetch('http://127.0.0.1:4499/__synthetic_ops_evidence')).json();
        expect(facts).toEqual({ syntheticOnly: true, intakes: 1, qc_passes: 1, qc_failures: 1, return_legs: 1, ready_events: 1, amount_due_minor: 10000 });
        expect(errors).toEqual([]);
        await page.screenshot({ path: resolve(output, 'ops-quality-desktop.png'), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: resolve(output, 'ops-quality-mobile.png'), fullPage: true });
        await writeFile(resolve(output, 'ops-result.json'), JSON.stringify({ status: 'passed', ...facts, sameIntakeRetry: true, sameQualityRetry: true, browserErrors: errors, realStaffMfaProven: false, physicalCustodyProven: false }, null, 2));
        console.log('PASS: actual ops intake + care + QC/rework UI, customer consent, post-commit reply-loss retries, one reconciled return obligation/leg/event. Synthetic local providers only; no physical custody or staff-MFA claim.');
        return { video: relative(output, await page.video().path()) };
      } catch (error) {
        await captureFailure();
        throw error;
      } finally { if (context) await context.close(); }
    },
  };
}
module.exports = { opsFacilityJourney };
