import { test, expect } from '@playwright/test';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

// Real app screens, real HTTP handlers and a disposable PostgreSQL database.
// Authentication/payment are explicitly the existing demo adapters, not live providers.
test('E2E-FULFILLMENT: customer booking, both rider legs, facility care and one verified review', async ({ page: customer, context }) => {
  test.setTimeout(120_000);
  const ops = await context.newPage();
  await ops.setViewportSize({ width: 1280, height: 800 });
  const rider = await context.newPage();
  const bag = `e2e-${randomUUID()}`;
  let orderId: string;
  let pickupJobId: string;
  let returnJobId: string;
  let pickupCode: string;
  let returnCode: string;

  async function dispatch(leg: 'PICKUP' | 'RETURN'): Promise<string> {
    await ops.getByRole('link', { name: 'Dispatch', exact: true }).click();
    await expect(ops.getByRole('heading', { name: 'Dispatch board' })).toBeVisible();
    await ops.getByLabel('Provisioned rider ID').fill('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    const card = ops.locator('.card').filter({ hasText: orderId.slice(0, 8) }).filter({ hasText: leg });
    const dispatched = ops.waitForResponse(response => response.request().method() === 'POST' && /\/ops\/deliveries\/[^/]+\/dispatch$/.test(new URL(response.url()).pathname));
    await card.getByRole('button', { name: 'Assign and dispatch' }).click();
    const response = await dispatched;
    expect(response.ok()).toBeTruthy();
    const job = await response.json();
    expect(job.orderId).toBe(orderId);
    expect(job.leg).toBe(leg);
    return job.id;
  }

  async function handover(jobId: string, code: string, leg: 'PICKUP' | 'RETURN', wrongCodeFirst = false) {
    // Navigate within the already signed-in app; do not bypass its session or API.
    await rider.goto('http://localhost:8082');
    if (leg === 'PICKUP') await rider.getByRole('button', { name: '[DEMO] Sign in as Rider', exact: true }).click();
    else await expect(rider.getByText(/Assigned Tasks \(\d+\)/)).toBeVisible();
    const job = rider.getByRole('button', { name: 'View job for Demo Customer', exact: true }).filter({ has: rider.getByText(leg, { exact: true }) });
    await expect(job).toHaveCount(1);
    await job.click();
    await expect(rider).toHaveURL(new RegExp(`/jobs/${jobId}`));
    await expect(rider.getByText('Customer handover codes are never displayed', { exact: false })).toBeVisible();
    await expect(rider.getByText(`Pickup code: ${code}`, { exact: true })).toHaveCount(0);
    const bagField = rider.getByLabel('Sealed bag IDs', { exact: true });
    if (await bagField.count()) await bagField.fill(bag);
    const input = rider.getByLabel('Customer Handover OTP', { exact: true });
    if (wrongCodeFirst) {
      await input.fill(code === '111111' ? '222222' : '111111');
      const rejected = rider.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/partner/jobs/${jobId}/handover`));
      await rider.getByRole('button', { name: 'Verify and Complete Handover', exact: true }).click();
      expect((await rejected).status()).toBe(400);
      await expect(rider.getByText('Status: COMPLETED', { exact: true })).toHaveCount(0);
    }
    await input.fill(code);
    const accepted = rider.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/partner/jobs/${jobId}/handover`));
    await rider.getByRole('button', { name: 'Verify and Complete Handover', exact: true }).click();
    expect((await accepted).ok()).toBeTruthy();
    await expect(rider.getByText('Status: COMPLETED', { exact: true })).toBeVisible();
  }

  await test.step('Customer creates a real quote and checkout from the app', async () => {
    await customer.goto('http://localhost:8081');
    await customer.getByRole('link', { name: 'Details for Wash and Fold, T-shirt', exact: true }).click();
    await customer.getByLabel('Quantity for T-shirt', { exact: true }).fill('2');
    await customer.getByRole('button', { name: 'Add T-shirt to basket', exact: true }).click();
    await customer.getByRole('button', { name: 'Review basket', exact: true }).click();
    await customer.getByRole('button', { name: 'Get server quote and continue', exact: true }).click();
    await expect(customer.getByRole('button', { name: 'Use address Home (demo)', exact: true })).toBeVisible();
    await customer.getByRole('button', { name: 'Request quote', exact: true }).click();
    await customer.getByRole('button', { name: 'Pay with demo simulator', exact: true }).click();
    await customer.getByRole('button', { name: 'Track order', exact: true }).click();
    orderId = new URL(customer.url()).pathname.split('/').at(-1)!;
    expect(orderId).toMatch(/^[a-f0-9-]{36}$/);
    const captured = customer.waitForResponse(response => response.request().method() === 'POST' && /\/demo\/payments\/[^/]+\/capture$/.test(new URL(response.url()).pathname));
    await customer.getByText('Simulate payment capture (DEMO)', { exact: true }).click();
    expect((await captured).ok()).toBeTruthy();
    await expect(customer.getByText('Status: PICKUP_PENDING', { exact: true })).toBeVisible();
    await expect(customer.getByLabel('Overall score 1 to 5')).toHaveCount(0);
    const codesResponse = customer.waitForResponse(response => response.request().method() === 'GET' && response.url().endsWith(`/orders/${orderId}/handover-code`));
    await customer.getByRole('button', { name: 'Show handover codes (DEMO only)', exact: true }).click();
    const codes = await (await codesResponse).json();
    pickupCode = codes.pickupOtp;
    expect(pickupCode).toMatch(/^\d{6}$/);
    expect(codes.returnOtp).toBeUndefined();
  });

  await test.step('Operator dispatches pickup; wrong code fails and valid pickup does not deliver the order', async () => {
    await ops.goto('http://localhost:5173');
    await ops.getByRole('button', { name: 'Continue with demo operator sign-in' }).click();
    pickupJobId = await dispatch('PICKUP');
    await handover(pickupJobId, pickupCode, 'PICKUP', true);
    await customer.getByRole('button', { name: 'Refresh order', exact: true }).click();
    await expect(customer.getByText('Status: DELIVERED', { exact: true })).toHaveCount(0);
    await expect(customer.getByLabel('Overall score 1 to 5')).toHaveCount(0);
  });

  await test.step('Facility records bag intake and completes care and quality checks', async () => {
    await ops.getByRole('link', { name: 'Orders', exact: true }).click();
    await ops.getByRole('link', { name: orderId.slice(0, 8), exact: true }).click();
    await ops.getByLabel('Sealed bag IDs (comma separated)').fill(bag);
    await ops.getByLabel('Reason (required for every override)').fill('Synthetic E2E: counted two shirts and verified sealed bag.');
    await ops.getByRole('button', { name: 'Record intake', exact: true }).click();
    await expect(ops.getByText(/^Status AT_FACILITY/)).toBeVisible();
    for (const state of ['IN_CARE', 'QUALITY_CHECK', 'READY_FOR_RETURN']) {
      await ops.getByRole('main').getByRole('combobox').selectOption(state);
      await ops.getByRole('button', { name: 'Advance care', exact: true }).click();
      await expect(ops.getByText(new RegExp(`^Status ${state}`))).toBeVisible();
    }
    const codesResponse = customer.waitForResponse(response => response.request().method() === 'GET' && response.url().endsWith(`/orders/${orderId}/handover-code`));
    await customer.getByRole('button', { name: 'Show handover codes (DEMO only)', exact: true }).click();
    returnCode = (await (await codesResponse).json()).returnOtp;
    expect(returnCode).toMatch(/^\d{6}$/);
  });

  await test.step('Return handover delivers the order and permits exactly one customer review', async () => {
    returnJobId = await dispatch('RETURN');
    await handover(returnJobId, returnCode, 'RETURN');
    await customer.getByRole('button', { name: 'Refresh order', exact: true }).click();
    await expect(customer.getByText('Status: DELIVERED', { exact: true })).toBeVisible();
    await customer.getByLabel('Overall score 1 to 5').fill('5');
    await customer.getByPlaceholder('How was the service?').fill('Synthetic E2E verification, not a real customer endorsement.');
    const submitted = customer.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/reviews'));
    await customer.getByText('Submit review', { exact: true }).click();
    expect((await submitted).ok()).toBeTruthy();
    const duplicate = customer.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/reviews'));
    await customer.getByText('Submit review', { exact: true }).click();
    const rejected = await duplicate;
    expect(rejected.status()).toBe(400);
    expect((await rejected.json()).message).toBe('One review per order');
  });

  await test.step('Persisted order, payment, custody and review agree with the screens', async () => {
    const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const order = (await db.query('SELECT status, payment_status FROM orders WHERE id = $1', [orderId])).rows[0];
      expect(order).toMatchObject({ status: 'DELIVERED', payment_status: 'CAPTURED' });
      const jobs = (await db.query('SELECT id, leg, status, bag_ids FROM delivery_jobs WHERE order_id = $1 ORDER BY leg', [orderId])).rows;
      expect(jobs).toHaveLength(2);
      expect(jobs.map(job => job.id).sort()).toEqual([pickupJobId, returnJobId].sort());
      expect(jobs.every(job => job.status === 'COMPLETED' && job.bag_ids.includes(bag))).toBeTruthy();
      expect((await db.query('SELECT id FROM payments WHERE order_id = $1 AND status = $2', [orderId, 'CAPTURED'])).rowCount).toBe(1);
      expect((await db.query('SELECT id FROM reviews WHERE order_id = $1', [orderId])).rowCount).toBe(1);
    } finally {
      await db.end();
    }
  });
});
