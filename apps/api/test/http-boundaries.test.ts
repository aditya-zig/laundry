import 'reflect-metadata';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { configureHttpBody } from '../src/http-body';
import { EnvelopeFilter } from '../src/filters/http-exception.filter';
import { initializeDb } from '../../../modules/shared/src/db';
import { resolveCorsOrigins } from '../src/runtime-config';

let app: NestExpressApplication, base: string;
const previousDemo = process.env.DEMO_MODE, previousPaymentSecret = process.env.RAZORPAY_KEY_SECRET;
beforeAll(async () => {
  process.env.DEMO_MODE = 'true';
  await initializeDb();
  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, rawBody: true });
  configureHttpBody(app);
  app.enableCors({ origin: resolveCorsOrigins({ NODE_ENV: 'production', CORS_ORIGIN: 'https://customer.example.invalid' }) });
  app.useGlobalFilters(new EnvelopeFilter());
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
  if (previousDemo === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = previousDemo;
  if (previousPaymentSecret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = previousPaymentSecret;
});

it('separates ordinary JSON bounds from an explicitly nonproduction voice fixture', async () => {
  const body = JSON.stringify({ mime: 'audio/ogg', base64: 'x'.repeat(70_000) });
  const post = (path: string) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body });
  expect((await post('/v2/identity/otp')).status).toBe(413);
  // No authenticated actor: a valid large demo parser reaches the real guard,
  // not a speech provider. No media/model/commercial call is made.
  expect((await post('/v1/demo/conversations/voice-notes')).status).toBe(401);
  process.env.DEMO_MODE = 'false';
  try { expect((await post('/v1/demo/conversations/voice-notes')).status).toBe(413); }
  finally { process.env.DEMO_MODE = 'true'; }
});

it('retains exact raw webhook bytes while limiting JSON and refusing forgery', async () => {
  const secret = 'synthetic-webhook-key-not-a-provider-credential';
  process.env.RAZORPAY_KEY_SECRET = secret;
  const body = '{\n  "event": "payment.captured",\n  "payload": {}\n}';
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  const post = (value: string) => fetch(base + '/v1/webhooks/payments/razorpay', { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': value }, body });
  const valid = await post(signature);
  expect(valid.status).toBe(400);
  expect((await valid.json()).message).toBe('Unsupported webhook payload');
  expect((await post('0'.repeat(64))).status).toBe(403);
});

it('actual CORS headers permit the configured frontend without trusting development origins', async () => {
  const allowed = await fetch(base + '/health', { headers: { origin: 'https://customer.example.invalid' } });
  expect(allowed.headers.get('access-control-allow-origin')).toBe('https://customer.example.invalid');
  const development = await fetch(base + '/health', { headers: { origin: 'http://localhost:8081' } });
  expect(development.headers.get('access-control-allow-origin')).toBeNull();
});

it('liveness cannot be confused with product readiness and demo flags are explicit', async () => {
  const live = await fetch(base + '/health');
  expect(live.status).toBe(200);
  expect((await live.json()).productionReady).toBe(false);
  const ready = await fetch(base + '/health/ready');
  expect(ready.status).toBe(503);
  expect(await ready.json()).toMatchObject({ productionReady: false, productApiEnabled: false });
  expect(ready.headers.get('cache-control')).toBe('no-store');
  delete process.env.DEMO_MODE;
  try { expect((await (await fetch(base + '/v1/health')).json()).demoMode).toBe(false); }
  finally { process.env.DEMO_MODE = 'true'; }
});
