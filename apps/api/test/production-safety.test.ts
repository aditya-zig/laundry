import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { EnvelopeFilter } from '../src/filters/http-exception.filter';
import { closePool, getPool, initializeDb, DEMO_IDS } from '../../../modules/shared/src/db';
import { demoMode, demoAuth, requestOtp, verifyOtp } from '../../../modules/shared/src/auth';
import { getPayment, listReceipts, requestRefund } from '../../../modules/billing/src/billing';

let app: NestExpressApplication;
let base: string;
const original = { ...process.env };
const orderId = randomUUID(), paymentId = randomUUID();
beforeAll(async () => {
  const db = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost'].includes(db.hostname) || !db.pathname.startsWith('/laundry_verify_')) throw new Error('A disposable local verification database is required');
  await initializeDb();
  await getPool().query(`INSERT INTO orders (id,customer_id,lines,total_minor,pickup_window,promised_return,address_snapshot)
    VALUES ($1,$2,'[]',100,'{}','{}','{}')`, [orderId, DEMO_IDS.customerId]);
  await getPool().query(`INSERT INTO payments (id,order_id,quote_id,amount_minor,payment_url,expires_at)
    VALUES ($1,$2,$3,100,'https://synthetic.invalid',now()+interval '5 minutes')`, [paymentId, orderId, randomUUID()]);
  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, rawBody: true });
  app.useGlobalFilters(new EnvelopeFilter());
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
afterEach(() => {
  for (const name of ['DEMO_MODE', 'NODE_ENV', 'DEMO_CUSTOMER_PHONE', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET']) {
    if (original[name] === undefined) delete process.env[name]; else process.env[name] = original[name];
  }
  vi.restoreAllMocks();
});
afterAll(async () => {
  await app?.close();
  await getPool().query('DELETE FROM payments WHERE id=$1', [paymentId]);
  await getPool().query('DELETE FROM orders WHERE id=$1', [orderId]);
  await closePool();
});

test('production cannot enable demo identity even with DEMO_MODE=true', async () => {
  process.env.NODE_ENV = 'production';
  process.env.DEMO_MODE = 'true';
  expect(demoMode()).toBe(false);
  await expect(demoAuth(getPool(), 'operator')).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
test('legacy demo sessions cannot authenticate after switching to real mode', async () => {
  process.env.DEMO_MODE = 'true';
  const { token } = await demoAuth(getPool(), 'operator');
  process.env.DEMO_MODE = 'false';
  const result = await fetch(base + '/v1/me', { headers: { authorization: `Bearer ${token}` } });
  expect(result.status).toBe(401);
  expect((await result.json()).code).toBe('UNAUTHENTICATED');
});
test('real-mode OTP requests fail before persisting undeliverable or plaintext challenges', async () => {
  process.env.DEMO_MODE = 'false';
  const before = (await getPool().query('SELECT count(*)::int AS n FROM otp_challenges')).rows[0].n;
  await expect(requestOtp(getPool(), '+919000012345')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  expect((await getPool().query('SELECT count(*)::int AS n FROM otp_challenges')).rows[0].n).toBe(before);
});
test('a demo OTP challenge cannot be redeemed after real mode is selected', async () => {
  process.env.DEMO_MODE = 'true';
  const challenge = await requestOtp(getPool(), '+919000012346');
  process.env.DEMO_MODE = 'false';
  const before = (await getPool().query('SELECT count(*)::int AS n FROM sessions')).rows[0].n;
  await expect(verifyOtp(getPool(), challenge.challengeId, challenge.demoCode!)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  expect((await getPool().query('SELECT count(*)::int AS n FROM sessions')).rows[0].n).toBe(before);
});
test('an unset demo flag cannot seed or overwrite demo identities', async () => {
  const before = (await getPool().query('SELECT phone FROM users WHERE id=$1', [DEMO_IDS.customerId])).rows[0].phone;
  delete process.env.DEMO_MODE;
  process.env.DEMO_CUSTOMER_PHONE = '+919000012347';
  try {
    await initializeDb();
    expect((await getPool().query('SELECT phone FROM users WHERE id=$1', [DEMO_IDS.customerId])).rows[0].phone).toBe(before);
  } finally { await getPool().query('UPDATE users SET phone=$1 WHERE id=$2', [before, DEMO_IDS.customerId]); }
});
test('legacy live refunds fail closed before recording false success or calling a provider', async () => {
  process.env.DEMO_MODE = 'false';
  process.env.RAZORPAY_KEY_ID = 'not-a-live-key';
  process.env.RAZORPAY_KEY_SECRET = 'not-a-live-secret';
  const network = vi.spyOn(globalThis, 'fetch');
  const before = (await getPool().query('SELECT count(*)::int AS n FROM refunds')).rows[0].n;
  await expect(requestRefund(getPool(), { id: DEMO_IDS.operatorId, role: 'operator', scopes: [] }, {
    orderId: randomUUID(), paymentId: randomUUID(), amountMinor: 100, reason: 'synthetic test',
  })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  expect(network).not.toHaveBeenCalled();
  expect((await getPool().query('SELECT count(*)::int AS n FROM refunds')).rows[0].n).toBe(before);
});
test('riders and facility identities cannot read private billing resources', async () => {
  for (const role of ['rider', 'facility', 'system']) {
    const actor = { id: DEMO_IDS.riderId, role, scopes: [] };
    await expect(getPayment(getPool(), actor, paymentId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(listReceipts(getPool(), actor, orderId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  }
});
test('manual logistics has no unsigned public event-write endpoint', async () => {
  const result = await fetch(base + '/v1/webhooks/logistics/manual', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ eventId: randomUUID(), jobId: randomUUID(), status: 'COMPLETED' }) });
  expect(result.status).toBe(403);
  expect((await result.json()).code).toBe('FORBIDDEN');
});
test('a signed-in customer cannot claim WhatsApp drafts for another phone', async () => {
  process.env.DEMO_MODE = 'true';
  const auth = await demoAuth(getPool(), 'customer');
  const result = await fetch(base + '/v1/account-links/whatsapp', { method: 'POST', headers: {
    'content-type': 'application/json', authorization: `Bearer ${auth.token}`,
  }, body: JSON.stringify({ senderPhone: '+919999999999' }) });
  expect(result.status).toBe(403);
  expect((await result.json()).code).toBe('FORBIDDEN');
});
