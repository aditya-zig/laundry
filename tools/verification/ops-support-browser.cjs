// Uses the same already-authenticated, task-owned ops context/video as facility work.
// Identity/channel providers remain synthetic; no real staffing or SLA is claimed.
const { expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { resolve } = require('node:path');
const { reviewViewport } = require('./viewports.mjs');

async function opsSupportJourney(page, output) {
  const calls = [], errors = [];
  const capture = request => {
    if (request.method() === 'POST' && /^http:\/\/127\.0\.0\.1:4499\/v2\/incidents\/[^/]+\/messages$/.test(request.url())) calls.push({ key: request.headers()['idempotency-key'], body: request.postData() });
  };
  const pageError = error => errors.push(error.message);
  let failCases = true, failThread = true;
  const casesPattern = '**/v2/ops/incidents*';
  const messagesPattern = '**/v2/incidents/*/messages*';
  const unavailable = async route => {
    const response = await route.fetch();
    await route.fulfill({ response, status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'PROVIDER_UNAVAILABLE', message: 'Synthetic support read failure', traceId: randomUUID(), retryable: true }) });
  };
  const casesRoute = async route => {
    if (route.request().method() === 'GET' && failCases) { failCases = false; await unavailable(route); }
    else await route.continue();
  };
  const messagesRoute = async route => {
    if (route.request().method() === 'GET' && failThread) { failThread = false; await unavailable(route); }
    else await route.continue();
  };
  const evidence = async () => (await fetch('http://127.0.0.1:4499/__synthetic_support_evidence')).json();
  page.on('request', capture); page.on('pageerror', pageError);
  await page.route(casesPattern, casesRoute); await page.route(messagesPattern, messagesRoute);
  try {
    const before = await evidence();
    expect(before).toMatchObject({ incidents: 1, messages: 1, customer_messages: 1, staff_messages: 0, order_status: 'DELIVERED' });
    await page.bringToFront();
    const console = page.getByRole('region', { name: 'Staff support console', exact: true });
    await console.getByRole('button', { name: 'Load support cases', exact: true }).click();
    await expect(console.getByRole('alert')).toContainText('Support read failed');
    await expect(console.getByText('No support cases were returned.', { exact: true })).toHaveCount(0);
    await console.getByRole('button', { name: 'Load support cases', exact: true }).click();
    const selectCase = console.getByRole('button', { name: 'Synthetic quality concern after recorded delivery', exact: true });
    await selectCase.click();
    const thread = console.getByRole('region', { name: 'Staff support thread', exact: true });
    await expect(thread.getByRole('alert')).toContainText('Messages could not be read');
    await expect(thread.getByText('No messages recorded yet.', { exact: true })).toHaveCount(0);
    await expect(thread.getByRole('button', { name: 'Send staff reply', exact: true })).toBeDisabled();
    await thread.getByRole('button', { name: 'Refresh case messages', exact: true }).click();
    await expect(thread.getByText('Synthetic customer follow-up without a replacement case.', { exact: true })).toBeVisible();
    await expect(thread.getByRole('button', { name: 'Send staff reply', exact: true })).toBeDisabled();
    const body = 'Synthetic operator acknowledgement; no refund or rewash promised.';
    await thread.getByLabel('Staff reply', { exact: true }).fill(body);
    await thread.getByRole('button', { name: 'Send staff reply', exact: true }).click();
    await expect(thread.getByRole('button', { name: 'Retry retained staff reply', exact: true })).toBeVisible();
    await expect(thread.getByLabel('Staff reply', { exact: true })).toBeDisabled();
    await expect(selectCase).toBeDisabled();
    await expect(console.getByRole('button', { name: 'Refresh support cases', exact: true })).toBeDisabled();
    await thread.getByRole('button', { name: 'Retry retained staff reply', exact: true }).click();
    await expect(thread.getByText('Staff reply recorded. This does not close the case or change the order.', { exact: true })).toBeVisible();
    await expect(thread.getByRole('button', { name: 'Retry retained staff reply', exact: true })).toHaveCount(0);
    await expect(thread.getByText(body, { exact: true })).toBeVisible();
    expect(calls).toHaveLength(2); expect(calls[0].key).toBeTruthy(); expect(calls[0]).toEqual(calls[1]);
    expect(JSON.parse(calls[0].body)).toEqual({ body, mediaIds: [] });
    await page.setViewportSize(reviewViewport({ width: 390, height: 844 }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await console.screenshot({ path: resolve(output, 'ops-support-mobile.png') });
    await page.setViewportSize(reviewViewport({ width: 1280, height: 900 }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await console.screenshot({ path: resolve(output, 'ops-support-desktop.png') });
    expect(await evidence()).toEqual({ ...before, messages: 2, staff_messages: 1, message_audits: 2 });
    expect(errors).toEqual([]);
    return { staffConsoleBrowserProven: true, staffConsoleFailedReadsNotEmpty: true, sameStaffReplyKeyAndBody: true, staffConsoleBrowserErrors: errors };
  } finally {
    page.off('request', capture); page.off('pageerror', pageError);
    await page.unroute(casesPattern, casesRoute); await page.unroute(messagesPattern, messagesRoute);
  }
}
module.exports = { opsSupportJourney };
