import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes, randomUUID } from 'node:crypto';
import { v2 } from '@laundry/contracts';
import { IdentityModule } from '../src/features/identity/identity.module';
import { configureHttpBody } from '../src/http-body';
import { EnvelopeFilter } from '../src/filters/http-exception.filter';
import { createV2Client } from '../../../packages/api-client/src/v2';
import { closePool, getPool, initializeDb } from '../../../modules/shared/src/db';
import { IdentityService, type OtpDelivery } from '../../../modules/identity/src';

const customerPhone = '+919000040001';
const otherPhone = '+919000040002';
const riderPhone = '+919000040003';
const keys = { hashKey: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex') };
const clock = () => now;
const key = () => randomUUID();
let now: Date;
let service: IdentityService;
let deliveries: { phone: string; code: string; challengeId: string }[];
const TRUNCATE = 'TRUNCATE identity_profiles, identity_otp_challenges, identity_rate_buckets, identity_session_families, identity_sessions, identity_command_results, identity_addresses, identity_audit, identity_staff, identity_staff_facilities, identity_staff_invitations, identity_staff_mfa, identity_staff_mfa_enrollments, identity_whatsapp_links CASCADE';
function nextTime(ms: number) { now = new Date(now.getTime() + ms); }
function wrong(code: string) { return code === '000000' ? '111111' : '000000'; }
async function signin(number: string) {
  const challenge = await service.requestOtp({ phone: number }, key(), 'test-peer');
  const delivery = deliveries.find(item => item.challengeId === challenge.challengeId)!;
  return service.verifyOtp({ challengeId: challenge.challengeId, code: delivery.code }, key(), 'test-peer');
}
async function freshChallenge(number: string) {
  nextTime(61_000);
  const challenge = await service.requestOtp({ phone: number }, key(), 'test-peer');
  const delivery = deliveries.find(item => item.challengeId === challenge.challengeId)!;
  return { challengeId: challenge.challengeId, code: delivery.code };
}
async function provisionStaff(phone: string, role: string) {
  await getPool().query('INSERT INTO identity_staff (id,phone,role,created_at) VALUES ($1,$2,$3,$4)', [randomUUID(), phone, role, now]);
}
const challengeRow = async (id: string) => (await getPool().query('SELECT * FROM identity_otp_challenges WHERE id=$1', [id])).rows[0];
const linkRow = async () => (await getPool().query('SELECT * FROM identity_whatsapp_links')).rows[0];

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/laundry_verify_')) throw new Error('Disposable local PostgreSQL required');
  await initializeDb();
});
beforeEach(async () => {
  await getPool().query(TRUNCATE);
  now = new Date('2026-10-25T10:00:00Z');
  deliveries = [];
  const provider: OtpDelivery = { mode: 'FAKE', async send(input) { deliveries.push(input); return { reference: `fake-${input.challengeId}` }; } };
  service = new IdentityService({ db: getPool(), provider, ...keys, clock });
});
afterAll(closePool);

describe('B01 verified WhatsApp channel binding', () => {
  it('links the account phone with a fresh code and stores no session or plaintext secret', async () => {
    const session = await signin(customerPhone);
    const challenge = await freshChallenge(customerPhone);
    const result = await service.linkWhatsApp(session.accessToken, challenge, key());
    expect(result).toEqual({ linked: true, linkedAt: now.toISOString() });
    expect(await linkRow()).toMatchObject({ profile_id: session.actor.id, phone: customerPhone });
    expect((await challengeRow(challenge.challengeId)).status).toBe('USED');
    expect((await getPool().query('SELECT count(*)::int AS n FROM identity_sessions')).rows[0].n).toBe(1);
    const audit = (await getPool().query("SELECT action,profile_id FROM identity_audit WHERE action='WHATSAPP_LINKED'")).rows;
    expect(audit).toEqual([{ action: 'WHATSAPP_LINKED', profile_id: session.actor.id }]);
    const cached = JSON.stringify((await getPool().query('SELECT sealed_result FROM identity_command_results WHERE scope LIKE $1', [`whatsapp-link:${session.actor.id}`])).rows);
    expect(cached).not.toContain(challenge.code);
    expect(cached).not.toContain(customerPhone);
  });

  it('replays one idempotent link and refuses the same key with a changed code', async () => {
    const session = await signin(customerPhone);
    const challenge = await freshChallenge(customerPhone);
    const linkKey = key();
    const first = await service.linkWhatsApp(session.accessToken, challenge, linkKey);
    const replayed = await service.linkWhatsApp(session.accessToken, challenge, linkKey);
    expect(replayed).toEqual(first);
    expect((await getPool().query("SELECT count(*)::int AS n FROM identity_audit WHERE action='WHATSAPP_LINKED'")).rows[0].n).toBe(1);
    expect((await getPool().query('SELECT count(*)::int AS n FROM identity_whatsapp_links')).rows[0].n).toBe(1);
    await expect(service.linkWhatsApp(session.accessToken, { ...challenge, code: wrong(challenge.code) }, linkKey)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('refuses a verified challenge for another phone without consuming its attempts', async () => {
    const session = await signin(customerPhone);
    const foreign = await freshChallenge(otherPhone);
    await expect(service.linkWhatsApp(session.accessToken, foreign, key())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const row = await challengeRow(foreign.challengeId);
    expect(row.status).toBe('ACCEPTED');
    expect(row.attempts).toBe(0);
    expect(await linkRow()).toBeUndefined();
    const own = await freshChallenge(customerPhone);
    await expect(service.linkWhatsApp(session.accessToken, own, key())).resolves.toMatchObject({ linked: true });
  });

  it('locks a leaking challenge after five bad codes and rejects reuse after success', async () => {
    const session = await signin(customerPhone);
    const challenge = await freshChallenge(customerPhone);
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(service.linkWhatsApp(session.accessToken, { ...challenge, code: wrong(challenge.code) }, key())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    }
    expect((await challengeRow(challenge.challengeId)).attempts).toBe(5);
    await expect(service.linkWhatsApp(session.accessToken, challenge, key())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const renewed = await freshChallenge(customerPhone);
    await service.linkWhatsApp(session.accessToken, renewed, key());
    await expect(service.linkWhatsApp(session.accessToken, renewed, key())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await challengeRow(renewed.challengeId)).status).toBe('USED');
  });

  it('rejects expired challenges and non-customer staff sessions', async () => {
    const session = await signin(customerPhone);
    const expired = await freshChallenge(customerPhone);
    nextTime(6 * 60_000);
    await expect(service.linkWhatsApp(session.accessToken, expired, key())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await provisionStaff(riderPhone, 'RIDER');
    const rider = await signin(riderPhone);
    const riderChallenge = await freshChallenge(riderPhone);
    await expect(service.linkWhatsApp(rider.accessToken, riderChallenge, key())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(await linkRow()).toBeUndefined();
  });
});

describe('B01 WhatsApp linking through the real SDK over HTTP', () => {
  let app: NestExpressApplication;
  let base: string;
  beforeEach(async () => {
    app = await NestFactory.create<NestExpressApplication>(IdentityModule.register(() => service), { logger: false, rawBody: true });
    configureHttpBody(app);
    app.useGlobalFilters(new EnvelopeFilter());
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()) + '/v2';
  });
  afterEach(async () => { await app?.close(); });

  it('serves the published route with contract envelopes and scopes the proof to the caller', async () => {
    let bearer: string | undefined;
    const client = createV2Client({ baseUrl: base, getToken: () => bearer });
    const sessionChallenge = await client.requestOtp(customerPhone);
    const session = await client.verifyOtp(sessionChallenge.challengeId, deliveries[0].code);
    bearer = session.accessToken;
    const challenge = await freshChallenge(customerPhone);
    const linked = await client.linkWhatsApp(challenge);
    expect(linked).toEqual({ linked: true, linkedAt: now.toISOString() });
    const foreign = await freshChallenge(otherPhone);
    await expect(client.linkWhatsApp(foreign)).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(await linkRow()).toMatchObject({ phone: customerPhone });
    const anonymous = await fetch(base + '/identity/whatsapp/link', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key() }, body: JSON.stringify(challenge) });
    expect(anonymous.status).toBe(401);
    expect(v2.errorEnvelopeSchema.parse(await anonymous.json()).code).toBe('UNAUTHENTICATED');
    const missingKey = await fetch(base + '/identity/whatsapp/link', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify(challenge) });
    expect(missingKey.status).toBe(400);
    expect(v2.errorEnvelopeSchema.parse(await missingKey.json()).code).toBe('INVALID_INPUT');
    const malformed = await fetch(base + '/identity/whatsapp/link', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}`, 'idempotency-key': key() }, body: JSON.stringify({ challengeId: 'nope' }) });
    expect(malformed.status).toBe(400);
    const error = v2.errorEnvelopeSchema.parse(await malformed.json());
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.fieldErrors?.challengeId).toBeInstanceOf(Array);
    expect(malformed.headers.get('cache-control')).toBe('no-store');
  });
});
