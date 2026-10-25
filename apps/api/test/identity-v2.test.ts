import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createV2Client } from '../../../packages/api-client/src/v2';
import { v2 } from '@laundry/contracts';
import { IdentityModule } from '../src/features/identity/identity.module';
import { configureHttpBody } from '../src/http-body';
import { EnvelopeFilter } from '../src/filters/http-exception.filter';
import { randomBytes, randomUUID } from 'node:crypto';
import { closePool, getPool, initializeDb } from '../../../modules/shared/src/db';
import { IdentityService, IdentityFault, type OtpDelivery } from '../../../modules/identity/src';

const phone = '+919000011111';
const keys = { hashKey: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex') };
let now: Date;
let service: IdentityService;
let deliveries: { phone: string; code: string; challengeId: string }[];
let provider: OtpDelivery;
const key = () => randomUUID();
const address = { label: 'Home', line1: 'Synthetic address', city: 'Test city', postalCode: '560001', coordinates: { lat: 12.97, lng: 77.59 } };
const clock = () => now;
function nextTime(ms: number) { now = new Date(now.getTime() + ms); }
async function signin(number = phone) {
  const challenge = await service.requestOtp({ phone: number }, key(), 'test-peer');
  const delivery = deliveries.find(item => item.challengeId === challenge.challengeId)!;
  return service.verifyOtp({ challengeId: challenge.challengeId, code: delivery.code }, key(), 'test-peer');
}
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/laundry_verify_')) throw new Error('Disposable local PostgreSQL required');
  await initializeDb();
});
beforeEach(async () => {
  await getPool().query('TRUNCATE identity_profiles, identity_otp_challenges, identity_rate_buckets, identity_session_families, identity_sessions, identity_command_results, identity_addresses, identity_audit CASCADE');
  now = new Date('2026-10-24T10:00:00Z');
  deliveries = [];
  provider = { mode: 'FAKE', async send(input) { deliveries.push(input); return { reference: `fake-${input.challengeId}` }; } };
  service = new IdentityService({ db: getPool(), provider, ...keys, clock });
});
afterAll(closePool);

describe('B01 production-v2 identity persistence (external delivery is a fake)', () => {
  it('issues a private expiring challenge and stores only a keyed code hash', async () => {
    const challenge = await service.requestOtp({ phone }, key(), 'peer-a');
    expect(challenge).toMatchObject({ challengeId: expect.any(String), expiresAt: '2026-10-24T10:05:00.000Z' });
    expect(Object.keys(challenge)).not.toContain('demoCode');
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].code).toMatch(/^\d{6}$/);
    const row = (await getPool().query('SELECT * FROM identity_otp_challenges')).rows[0];
    expect(row.code_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.code_hash).not.toBe(deliveries[0].code);
  });

  it('replays OTP request intent across network changes without sending twice or crossing phone scopes', async () => {
    const requestKey = key();
    const first = await service.requestOtp({ phone }, requestKey, 'peer-a');
    expect(await service.requestOtp({ phone }, requestKey, 'peer-b')).toEqual(first);
    expect(deliveries).toHaveLength(1);
    const other = await service.requestOtp({ phone: '+919000011112' }, requestKey, 'peer-a');
    expect(other.challengeId).not.toBe(first.challengeId);
    expect(deliveries).toHaveLength(2);
  });

  it('persists failed attempts, deduplicates retries and locks after five distinct failures', async () => {
    const challenge = await service.requestOtp({ phone }, key(), 'peer-a');
    const correct = deliveries[0].code;
    const input = { challengeId: challenge.challengeId, code: correct === '000000' ? '111111' : '000000' };
    const retryKey = key();
    for (let i = 0; i < 3; i++) await expect(service.verifyOtp(input, retryKey, 'peer-a')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await getPool().query('SELECT attempts FROM identity_otp_challenges')).rows[0].attempts).toBe(1);
    await expect(service.verifyOtp({ ...input, code: correct }, retryKey, 'peer-a')).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    for (let i = 0; i < 4; i++) await expect(service.verifyOtp(input, key(), 'peer-a')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(service.verifyOtp({ challengeId: challenge.challengeId, code: correct }, key(), 'peer-a')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await getPool().query('SELECT count(*)::int AS n FROM identity_sessions')).rows[0].n).toBe(0);
  });

  it('rejects expired challenges at the trusted server clock', async () => {
    const challenge = await service.requestOtp({ phone }, key(), 'peer-a');
    nextTime(300_000);
    await expect(service.verifyOtp({ challengeId: challenge.challengeId, code: deliveries[0].code }, key(), 'peer-a')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('concurrent verification commits one session and replays encrypted credentials', async () => {
    const challenge = await service.requestOtp({ phone }, key(), 'peer-a');
    const verifyKey = key();
    const input = { challengeId: challenge.challengeId, code: deliveries[0].code };
    const [first, second] = await Promise.all([service.verifyOtp(input, verifyKey, 'peer-a'), service.verifyOtp(input, verifyKey, 'peer-a')]);
    expect(second).toEqual(first);
    expect((await service.authenticate(first.accessToken)).actor.role).toBe('CUSTOMER');
    await expect(service.verifyOtp(input, key(), 'peer-a')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const stored = JSON.stringify((await getPool().query('SELECT row_to_json(s) AS data FROM identity_sessions s')).rows);
    const cached = JSON.stringify((await getPool().query('SELECT row_to_json(c) AS data FROM identity_command_results c')).rows);
    for (const secret of [first.accessToken, first.refreshToken, deliveries[0].code]) {
      expect(stored).not.toContain(secret);
      expect(cached).not.toContain(secret);
    }
    expect((await getPool().query('SELECT count(*)::int AS n FROM identity_sessions')).rows[0].n).toBe(1);
  });

  it('rotates refresh credentials and revokes the entire family on a new-key replay', async () => {
    const first = await signin();
    const refreshKey = key();
    const second = await service.refresh({ refreshToken: first.refreshToken }, refreshKey, 'peer-a');
    expect(second.accessToken).not.toBe(first.accessToken);
    expect(await service.refresh({ refreshToken: first.refreshToken }, refreshKey, 'peer-a')).toEqual(second);
    await expect(service.authenticate(first.accessToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(service.refresh({ refreshToken: first.refreshToken }, key(), 'peer-a')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(service.authenticate(second.accessToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await getPool().query('SELECT count(*)::int AS n FROM identity_sessions')).rows[0].n).toBe(2);
    expect((await getPool().query('SELECT revoked_at FROM identity_session_families')).rows[0].revoked_at).not.toBeNull();
  });

  it('enforces access/refresh expiry and does not accept legacy tokens', async () => {
    const session = await signin();
    await expect(service.authenticate('demo_operator_token')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    nextTime(15 * 60_000);
    await expect(service.authenticate(session.accessToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    nextTime(8 * 24 * 60 * 60_000);
    await expect(service.refresh({ refreshToken: session.refreshToken }, key(), 'peer-a')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rechecks persisted account deactivation rather than trusting a cached actor', async () => {
    const session = await signin();
    await service.createAddress(session.accessToken, address, key());
    await getPool().query('UPDATE identity_profiles SET active=false WHERE id=$1', [session.actor.id]);
    await expect(service.authenticate(session.accessToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(service.listAddresses(session.accessToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(service.refresh({ refreshToken: session.refreshToken }, key(), 'peer-a')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('logout persists revocation and cannot be undone by a cached login replay', async () => {
    const challenge = await service.requestOtp({ phone }, key(), 'peer-a');
    const verifyKey = key(), input = { challengeId: challenge.challengeId, code: deliveries[0].code };
    const session = await service.verifyOtp(input, verifyKey, 'peer-a');
    const logoutKey = key();
    expect(await service.logout(session.accessToken, logoutKey)).toEqual({ revoked: true });
    expect(await service.logout(session.accessToken, logoutKey)).toEqual({ revoked: true });
    await expect(service.authenticate(session.accessToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(service.verifyOtp(input, verifyKey, 'peer-a')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('cannot revoke another customer device or read/change their addresses', async () => {
    const alice = await signin(), bob = await signin('+919000011112');
    const owned = await service.createAddress(alice.accessToken, address, key());
    expect(await service.listAddresses(bob.accessToken)).toEqual([]);
    await expect(service.revoke(bob.accessToken, alice.sessionId, key())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.updateAddress(bob.accessToken, owned.id, { ...address, expectedVersion: 1 }, key())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.deleteAddress(bob.accessToken, owned.id, 1, key())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await service.listAddresses(alice.accessToken))[0].ownerId).toBe(alice.actor.id);
  });

  it('versions address mutations, replays one create and preserves deletion', async () => {
    const session = await signin(), createKey = key();
    const first = await service.createAddress(session.accessToken, address, createKey);
    expect(await service.createAddress(session.accessToken, address, createKey)).toEqual(first);
    await expect(service.createAddress(session.accessToken, { ...address, label: 'Changed' }, createKey)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const second = await service.updateAddress(session.accessToken, first.id, { ...address, label: 'Office', expectedVersion: 1 }, key());
    expect(second.version).toBe(2);
    await expect(service.updateAddress(session.accessToken, first.id, { ...address, expectedVersion: 1 }, key())).rejects.toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 2 });
    expect(await service.deleteAddress(session.accessToken, first.id, 2, key())).toEqual({ id: first.id, deleted: true });
    expect(await service.listAddresses(session.accessToken)).toEqual([]);
    await expect(service.createAddress(session.accessToken, address, createKey)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('cannot silently omit active addresses from its bounded wire list', async () => {
    const session = await signin();
    await getPool().query(`INSERT INTO identity_addresses (id,owner_id,address,created_at,updated_at)
      SELECT gen_random_uuid(),$1,$2,now(),now() FROM generate_series(1,100)`, [session.actor.id, JSON.stringify(address)]);
    expect(await service.listAddresses(session.accessToken)).toHaveLength(100);
    await expect(service.createAddress(session.accessToken, address, key())).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('bounds total commercial-send exposure atomically across replicas and arbitrary phones/peers', async () => {
    const first = new IdentityService({ db: getPool(), provider, ...keys, clock, maxOtpPerHour: 2 });
    const second = new IdentityService({ db: getPool(), provider, ...keys, clock, maxOtpPerHour: 2 });
    const outcomes = await Promise.allSettled([
      first.requestOtp({ phone }, key(), 'peer-a'),
      second.requestOtp({ phone: '+919000011112' }, key(), 'peer-b'),
      first.requestOtp({ phone: '+919000011113' }, key(), 'peer-c'),
    ]);
    expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(2);
    const rejected = outcomes.filter(item => item.status === 'rejected');
    expect(rejected).toHaveLength(1);
    for (const item of rejected) if (item.status === 'rejected') expect(item.reason.code).toBe('RATE_LIMITED');
    expect(deliveries).toHaveLength(2);
    expect((await getPool().query('SELECT count(*)::int AS n FROM identity_otp_challenges')).rows[0].n).toBe(2);
  });

  it('enforces phone cooldown and request quotas across service restarts', async () => {
    await service.requestOtp({ phone }, key(), 'peer-a');
    await expect(service.requestOtp({ phone }, key(), 'peer-a')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    for (let i = 0; i < 4; i++) { nextTime(61_000); await service.requestOtp({ phone }, key(), 'peer-a'); }
    nextTime(61_000);
    service = new IdentityService({ db: getPool(), provider, ...keys, clock });
    await expect(service.requestOtp({ phone }, key(), 'peer-b')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(deliveries).toHaveLength(5);
  });

  it('does not accept an undelivered challenge or resend an unknown provider outcome', async () => {
    let calls = 0;
    service = new IdentityService({ db: getPool(), ...keys, clock, provider: { mode: 'FAKE', async send(input) { calls++; deliveries.push(input); throw new Error('fake provider uncertain result'); } } });
    const requestKey = key();
    await expect(service.requestOtp({ phone }, requestKey, 'peer-a')).rejects.toMatchObject({ code: 'PROVIDER_OUTCOME_UNKNOWN' });
    await expect(service.requestOtp({ phone }, requestKey, 'peer-a')).rejects.toMatchObject({ code: 'PROVIDER_OUTCOME_UNKNOWN' });
    expect(calls).toBe(1);
    expect((await getPool().query('SELECT status FROM identity_otp_challenges')).rows[0].status).toBe('UNKNOWN');
    await expect(service.verifyOtp({ challengeId: deliveries[0].challengeId, code: deliveries[0].code }, key(), 'peer-a')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('records definite provider refusal separately from an unknown outcome', async () => {
    service = new IdentityService({ db: getPool(), ...keys, clock, provider: { mode: 'FAKE', async send() { throw new IdentityFault('PROVIDER_UNAVAILABLE', 'Synthetic refusal'); } } });
    await expect(service.requestOtp({ phone }, key(), 'peer-a')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect((await getPool().query('SELECT status FROM identity_otp_challenges')).rows[0].status).toBe('FAILED');
  });

  it('survives process-state loss without storing bearer secrets in plaintext', async () => {
    const session = await signin();
    service = new IdentityService({ db: getPool(), provider, ...keys, clock });
    expect((await service.authenticate(session.accessToken)).actor.id).toBe(session.actor.id);
    const second = await service.refresh({ refreshToken: session.refreshToken }, key(), 'peer-a');
    expect(second.actor.id).toBe(session.actor.id);
  });

  it('never upgrades a fake-delivered OTP into a live session', async () => {
    const challenge = await service.requestOtp({ phone }, key(), 'peer-a');
    const live = new IdentityService({ db: getPool(), ...keys, clock, provider: { mode: 'LIVE', async send() { throw new Error('No live network calls in tests'); } } });
    await expect(live.verifyOtp({ challengeId: challenge.challengeId, code: deliveries[0].code }, key(), 'peer-a')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await getPool().query('SELECT count(*)::int AS n FROM identity_sessions')).rows[0].n).toBe(0);
  });

  it('refuses fake production configuration and weak/shared persistence keys', () => {
    const original = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      expect(() => new IdentityService({ db: getPool(), provider, ...keys })).toThrow(/Fake identity/);
    } finally { process.env.NODE_ENV = original; }
    expect(() => new IdentityService({ db: getPool(), provider, ...keys, hashKey: '0'.repeat(64) })).toThrow(/independent random/);
    expect(() => new IdentityService({ db: getPool(), provider, ...keys, encryptionKey: keys.hashKey })).toThrow(/must differ/);
    expect(() => new IdentityService({ db: getPool(), provider, ...keys, encryptionKey: keys.hashKey.toUpperCase() })).toThrow(/must differ/);
  });

  it('serializes competing refresh intents and invalidates the compromised family', async () => {
    const session = await signin();
    const results = await Promise.allSettled([
      service.refresh({ refreshToken: session.refreshToken }, key(), 'peer-a'),
      service.refresh({ refreshToken: session.refreshToken }, key(), 'peer-a'),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    for (const result of results) if (result.status === 'fulfilled') await expect(service.authenticate(result.value.accessToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await getPool().query('SELECT count(*)::int AS n FROM identity_sessions')).rows[0].n).toBe(2);
  });

  it('never accepts fake-issued sessions in a live-configured identity service', async () => {
    const session = await signin();
    const live = new IdentityService({ db: getPool(), ...keys, clock, provider: { mode: 'LIVE', async send() { throw new Error('No live network calls in tests'); } } });
    await expect(live.authenticate(session.accessToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(live.refresh({ refreshToken: session.refreshToken }, key(), 'peer-a')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('B01 real SDK to HTTP to PostgreSQL', () => {
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

  it('completes verified signup, owned addresses, rotation and logout through the first-party SDK', async () => {
    let bearer: string | undefined;
    const client = createV2Client({ baseUrl: base, getToken: () => bearer });
    const challenge = await client.requestOtp(phone);
    const session = await client.verifyOtp(challenge.challengeId, deliveries[0].code);
    bearer = session.accessToken;
    expect(await client.me()).toEqual(session.actor);
    const owned = await client.createAddress(address);
    expect(await client.listAddresses()).toEqual([owned]);
    const edited = await client.updateAddress(owned.id, { ...address, label: 'Office' }, 1);
    expect(edited.version).toBe(2);
    await expect(client.updateAddress(owned.id, address, 1)).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT', currentVersion: 2 });
    expect(await client.deleteAddress(owned.id, 2)).toEqual({ id: owned.id, deleted: true });
    const refreshed = await client.refreshSession(session.refreshToken);
    await expect(client.me()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    bearer = refreshed.accessToken;
    expect((await client.me()).id).toBe(session.actor.id);
    expect(await client.logout()).toEqual({ revoked: true });
    await expect(client.me()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('returns contract-valid array field errors and refuses missing keys or caller-selected staff roles', async () => {
    for (const input of [{ phone, role: 'ADMIN' }, { phone: 'invalid' }]) {
      const response = await fetch(base + '/identity/otp', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key() }, body: JSON.stringify(input) });
      expect(response.status).toBe(400);
      const error = v2.errorEnvelopeSchema.parse(await response.json());
      expect(error.code).toBe('INVALID_INPUT');
      expect(Object.values(error.fieldErrors ?? {}).every(Array.isArray)).toBe(true);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    const missing = await fetch(base + '/identity/otp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone }) });
    expect(missing.status).toBe(400);
    expect(deliveries).toHaveLength(0);
    const legacy = await fetch(base + '/identity/me', { headers: { authorization: 'Bearer demo_operator_token' } });
    expect(legacy.status).toBe(401);
  });

  it('bounds identity JSON before validation and redacts malformed parser failures', async () => {
    const oversized = await fetch(base + '/identity/otp', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key() }, body: JSON.stringify({ phone, padding: 'x'.repeat(70_000) }) });
    expect(oversized.status).toBe(413);
    expect(v2.errorEnvelopeSchema.parse(await oversized.json()).code).toBe('INVALID_INPUT');
    const secret = 'synthetic-private-parser-value';
    const malformed = await fetch(base + '/identity/otp', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key() }, body: '{"phone":"' + secret });
    expect(malformed.status).toBe(400);
    const body = await malformed.text();
    expect(body).not.toContain(secret);
    expect(v2.errorEnvelopeSchema.parse(JSON.parse(body)).code).toBe('INVALID_INPUT');
    expect(deliveries).toHaveLength(0);
  });

  it('does not cache credential responses and rejects tampered encrypted replay data', async () => {
    const client = createV2Client({ baseUrl: base });
    const challenge = await client.requestOtp(phone);
    const verifyKey = key();
    await client.verifyOtp(challenge.challengeId, deliveries[0].code, { idempotencyKey: verifyKey });
    await getPool().query("UPDATE identity_command_results SET sealed_result='tampered' WHERE scope=$1", [`verify:${challenge.challengeId}`]);
    await expect(client.verifyOtp(challenge.challengeId, deliveries[0].code, { idempotencyKey: verifyKey })).rejects.toMatchObject({ status: 503, code: 'PROVIDER_UNAVAILABLE' });
    const response = await fetch(base + '/identity/otp', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key() }, body: JSON.stringify({ phone: '+919000011113' }) });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await getPool().query('SELECT count(*)::int AS n FROM identity_sessions')).rows[0].n).toBe(1);
  });

  it('disabled identity returns an explicit provider error rather than issuing demo credentials', async () => {
    const disabled = await NestFactory.create<NestExpressApplication>(IdentityModule.register(() => null), { logger: false });
    try {
      await disabled.listen(0, '127.0.0.1');
      const client = createV2Client({ baseUrl: (await disabled.getUrl()) + '/v2' });
      await expect(client.requestOtp(phone)).rejects.toMatchObject({ status: 503, code: 'PROVIDER_UNAVAILABLE' });
      expect(deliveries).toHaveLength(0);
    } finally { await disabled.close(); }
  });
});
