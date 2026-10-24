import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { demoHandoverCodesSchema } from '@laundry/contracts';
import { AppModule } from '../src/app.module';
import { EnvelopeFilter } from '../src/filters/http-exception.filter';
import { closePool, getPool, initializeDb } from '../../modules/shared/src/db';

let app: NestExpressApplication;
let origin: string;
let customer: string;
let rider: string;
let operator: string;
let orderId: string;

async function request(method: string, path: string, token?: string, body?: unknown, key = randomUUID()) {
  const response = await fetch(`${origin}/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Idempotency-Key': key },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? 'invalid:');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/laundry_verify_')) {
    throw new Error('Customer handover tests require a disposable loopback verification database');
  }
  await initializeDb();
  app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, logger: false });
  app.useGlobalFilters(new EnvelopeFilter());
  await app.listen(0, '127.0.0.1');
  origin = await app.getUrl();
  customer = (await request('POST', '/auth/demo', undefined, { role: 'customer' })).body.token;
  rider = (await request('POST', '/auth/demo', undefined, { role: 'rider' })).body.token;
  operator = (await request('POST', '/auth/demo', undefined, { role: 'operator' })).body.token;
  const addresses = await request('GET', '/addresses', customer);
  const start = Date.now() + 86_400_000;
  const quote = await request('POST', '/quotes', customer, {
    addressId: addresses.body[0].id,
    lines: [{ serviceId: '11111111-1111-4111-8111-111111111111', garmentTypeId: '22222222-2222-4222-8222-222222222222', quantity: 1 }],
    pickupWindow: { start: new Date(start).toISOString(), end: new Date(start + 3_600_000).toISOString(), timezone: 'Asia/Kolkata' },
    requestedReturnBy: new Date(start + 5 * 86_400_000).toISOString(),
    timezone: 'Asia/Kolkata',
  });
  expect(quote.status).toBe(201);
  const checkout = await request('POST', '/checkouts', customer, { quoteId: quote.body.id });
  expect(checkout.status).toBe(201);
  orderId = checkout.body.orderId;
  expect((await request('POST', `/demo/payments/${checkout.body.paymentId}/capture`, customer, {})).status).toBe(201);
});

afterAll(async () => {
  await app?.close();
  await closePool();
});

test('owner can retrieve the existing demo pickup code but not an early return code', async () => {
  const response = await request('GET', `/orders/${orderId}/handover-code`, customer);
  expect(response.status).toBe(200);
  expect(demoHandoverCodesSchema.safeParse(response.body).success).toBe(true);
  expect(response.body.pickupOtp).toMatch(/^\d{6}$/);
  expect(response.body.returnOtp).toBeUndefined();
  const stored = (await getPool().query('SELECT pickup_otp FROM orders WHERE id = $1', [orderId])).rows[0];
  expect(response.body.pickupOtp).toBe(stored.pickup_otp);
});

test('rider, staff, another customer and unauthenticated requests cannot retrieve customer codes', async () => {
  for (const token of [rider, operator]) {
    expect((await request('GET', `/orders/${orderId}/handover-code`, token)).status).toBe(404);
  }
  const userId = randomUUID();
  const token = `test_${randomUUID()}`;
  await getPool().query("INSERT INTO users (id, role, name, phone) VALUES ($1, 'customer', 'Synthetic other owner', $2)", [userId, randomUUID()]);
  await getPool().query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]);
  expect((await request('GET', `/orders/${orderId}/handover-code`, token)).status).toBe(404);
  expect((await request('GET', `/orders/${orderId}/handover-code`)).status).toBe(401);
});

test('operator dispatch actually assigns the rider and replays the original command once', async () => {
  const job = (await getPool().query("SELECT id, version FROM delivery_jobs WHERE order_id = $1 AND leg = 'PICKUP'", [orderId])).rows[0];
  const body = { assignedTo: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', expectedVersion: job.version };
  const key = randomUUID();
  const first = await request('POST', `/ops/deliveries/${job.id}/dispatch`, operator, body, key);
  expect(first.status).toBe(201);
  expect(first.body.assignedTo).toBe(body.assignedTo);
  expect(first.body.status).toBe('ASSIGNED');
  const replay = await request('POST', `/ops/deliveries/${job.id}/dispatch`, operator, body, key);
  expect(replay.body).toEqual(first.body);
  const jobs = await request('GET', '/partner/jobs', rider);
  const detail = await request('GET', `/partner/jobs/${job.id}`, rider);
  expect(jobs.body.find((entry: { id: string }) => entry.id === job.id)).toEqual(detail.body);
  expect(detail.body.assignedTo).toBe(body.assignedTo);
  expect((await getPool().query("SELECT id FROM v2_audit WHERE aggregate_id = $1 AND action = 'delivery.assigned.v1'", [job.id])).rowCount).toBe(1);
});

test('dispatch rejects stale versions, non-riders and completed legs without changing assignment', async () => {
  const job = (await getPool().query("SELECT * FROM delivery_jobs WHERE order_id = $1 AND leg = 'PICKUP'", [orderId])).rows[0];
  const assignedTo = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  expect((await request('POST', `/ops/deliveries/${job.id}/dispatch`, operator, { assignedTo, expectedVersion: job.version - 1 })).status).toBe(409);
  expect((await request('POST', `/ops/deliveries/${job.id}/dispatch`, operator, { assignedTo: 'eeeeeee1-eeee-4eee-8eee-eeeeeeeeeee1', expectedVersion: job.version })).status).toBe(400);
  await getPool().query("UPDATE delivery_jobs SET status = 'COMPLETED' WHERE id = $1", [job.id]);
  expect((await request('POST', `/ops/deliveries/${job.id}/dispatch`, operator, { assignedTo, expectedVersion: job.version })).status).toBe(409);
  const current = (await getPool().query('SELECT status, assigned_to, version FROM delivery_jobs WHERE id = $1', [job.id])).rows[0];
  expect(current).toEqual({ status: 'COMPLETED', assigned_to: job.assigned_to, version: job.version });
});

test('demo code retrieval is disabled when demo mode is off', async () => {
  const previous = process.env.DEMO_MODE;
  process.env.DEMO_MODE = 'false';
  try {
    const response = await request('GET', `/orders/${orderId}/handover-code`, customer);
    // Legacy sessions are demo identities too: real mode rejects them at the
    // authentication boundary, before reaching the code-disclosure route.
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHENTICATED');
    expect(response.body.pickupOtp).toBeUndefined();
    expect(response.body.returnOtp).toBeUndefined();
  } finally {
    if (previous === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = previous;
  }
});
