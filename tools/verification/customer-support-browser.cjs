// Task-only customer UI acceptance, using the already-owned browser context.
// The caller supplies either the actual owned ops UI or an explicitly synthetic
// service fallback; the result records which path was actually exercised.
const { expect } = require('@playwright/test');
const { resolve } = require('node:path');
const { reviewViewport } = require('./viewports.mjs');
async function customerSupportJourney(page, output, replyToSupport) {
  const cases = [], messages = [];
  const capture = request => {
    const url = new URL(request.url());
    if (request.method() !== 'POST' || url.origin !== 'http://127.0.0.1:4499') return;
    const record = { key: request.headers()['idempotency-key'], body: request.postData() };
    if (/^\/v2\/orders\/[^/]+\/incidents$/.test(url.pathname)) cases.push(record);
    if (url.pathname.startsWith('/v2/incidents/') && url.pathname.endsWith('/messages')) messages.push(record);
  };
  const evidence = async () => (await fetch('http://127.0.0.1:4499/__synthetic_support_evidence')).json();
  page.on('request', capture);
  try {
    const before = await evidence();
    expect(before).toMatchObject({ syntheticOnly: true, incidents: 0, messages: 0, order_status: 'DELIVERED' });
    const summary = 'Synthetic quality concern after recorded delivery';
    await expect(page.getByRole('button', { name: 'Open support case', exact: true })).toBeDisabled();
    await expect(page.getByRole('radio', { name: 'Care quality', exact: true })).not.toBeChecked();
    await page.getByRole('radio', { name: 'Care quality', exact: true }).click();
    await page.getByLabel('Support case summary', { exact: true }).fill(summary);
    await page.getByLabel('Support case details', { exact: true }).fill('Synthetic cuff inspection request; no refund authorised.');
    await page.setViewportSize(reviewViewport({ width: 1280, height: 900 }));
    await page.getByText('Support for this order', { exact: true }).locator('..').screenshot({ path: resolve(output, 'support-case-desktop.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize(reviewViewport({ width: 390, height: 844 }));
    await page.getByRole('button', { name: 'Open support case', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Check original support case', exact: true })).toBeVisible();
    await expect(page.getByLabel('Support case summary', { exact: true })).toHaveCount(0);
    const emptyCasesDuringUnknown = await page.getByText('No support cases are recorded for this order.', { exact: true }).count();
    await page.getByText('Support for this order', { exact: true }).locator('..').screenshot({ path: resolve(output, 'support-case-pending-mobile.png') });
    await page.goBack();
    await page.getByRole('button', { name: 'View order', exact: true }).click();
    await page.getByRole('button', { name: 'Check original support case', exact: true }).click();
    await expect(page.getByText('Support conversation', { exact: true })).toBeVisible();
    expect(cases).toHaveLength(2); expect(cases[0].key).toBeTruthy(); expect(cases[0]).toEqual(cases[1]);
    expect(JSON.parse(cases[0].body)).toMatchObject({ category: 'QUALITY', summary, mediaIds: [] });

    const text = 'Synthetic customer follow-up without a replacement case.';
    await expect(page.getByRole('button', { name: 'Send support message', exact: true })).toBeDisabled();
    await page.getByLabel('Support case message', { exact: true }).fill(text);
    await page.getByRole('button', { name: 'Send support message', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Check original support message', exact: true })).toBeVisible();
    await expect(page.getByLabel('Support case message', { exact: true })).toHaveCount(0);
    const emptyMessagesDuringUnknown = await page.getByText('No messages in this case yet.', { exact: true }).count();
    await page.getByRole('button', { name: 'Back to support cases', exact: true }).click();
    await page.getByRole('button', { name: `Open case: ${summary}`, exact: true }).click();
    await page.getByRole('button', { name: 'Check original support message', exact: true }).click();
    await expect(page.getByText('Message recorded', { exact: true })).toBeVisible();
    expect(messages).toHaveLength(2); expect(messages[0].key).toBeTruthy(); expect(messages[0]).toEqual(messages[1]);
    expect(JSON.parse(messages[0].body)).toEqual({ body: text, mediaIds: [] });
    const staffEvidence = await replyToSupport();
    await page.bringToFront();
    await page.getByRole('button', { name: 'Refresh case messages', exact: true }).click();
    await expect(page.getByText('Synthetic operator acknowledgement; no refund or rewash promised.', { exact: true })).toBeVisible();
    await expect(page.getByText(/^OPERATOR ·/)).toBeVisible();
    await page.getByText('Support conversation', { exact: true }).locator('..').screenshot({ path: resolve(output, 'support-thread-mobile.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize(reviewViewport({ width: 1280, height: 900 }));
    await page.getByText('Support conversation', { exact: true }).locator('..').screenshot({ path: resolve(output, 'support-thread-desktop.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize(reviewViewport({ width: 390, height: 844 }));
    expect(await evidence()).toEqual({ ...before, incidents: 1, messages: 2, customer_messages: 1, staff_messages: 1, opened_audits: 1, message_audits: 2 });
    expect({ emptyCasesDuringUnknown, emptyMessagesDuringUnknown }).toEqual({ emptyCasesDuringUnknown: 0, emptyMessagesDuringUnknown: 0 });
    return { noFalseEmptyStateDuringUnknown: true, sameSupportCaseKeyAndBody: true, sameSupportMessageKeyAndBody: true, supportOrderUnchanged: true, syntheticStaffReplyOnly: staffEvidence?.staffConsoleBrowserProven !== true, ...staffEvidence };
  } finally { page.off('request', capture); }
}
module.exports = { customerSupportJourney };
