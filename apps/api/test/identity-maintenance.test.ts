import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { IdentityService, maintainIdentity, type OtpDelivery } from '../../../modules/identity/src';
import { initializeDb, getPool, closePool } from '../../../modules/shared/src/db';

let now: Date, service: IdentityService, code: string;
const keys = { hashKey: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex') };
const phone = '+919000018888';
const key = () => randomUUID();
let sends = 0;
const provider: OtpDelivery = { mode: 'FAKE', async send(input) { sends++; code = input.code; return { reference: 'synthetic-' + input.challengeId }; } };
async function login() {
  const challenge = await service.requestOtp({ phone }, key(), 'maintenance-peer');
  return service.verifyOtp({ challengeId: challenge.challengeId, code }, key(), 'maintenance-peer');
}
beforeAll(initializeDb);
beforeEach(async () => {
  await getPool().query('TRUNCATE identity_profiles, identity_otp_challenges, identity_rate_buckets, identity_session_families, identity_sessions, identity_command_results, identity_addresses, identity_audit CASCADE');
  now = new Date('2026-10-25T10:00:00Z'); sends = 0;
  service = new IdentityService({ db: getPool(), provider, ...keys, clock: () => now });
});
afterAll(closePool);

it('erases expired challenge PII/secrets while retaining a send-deduplication tombstone', async () => {
  const requestKey = key(), challenge = await service.requestOtp({ phone }, requestKey, 'maintenance-peer');
  now = new Date(now.getTime() + 300_000);
  const result = await maintainIdentity(getPool(), { now });
  expect(result.challengesRedacted).toBe(1);
  const row = (await getPool().query('SELECT * FROM identity_otp_challenges')).rows[0];
  expect(row.phone).toBeNull(); expect(row.code_hash).toBeNull(); expect(row.provider_reference).toBeNull();
  expect(row.redacted_at).toEqual(now);
  expect(row.request_scope).toMatch(/^[a-f0-9]{64}$/);
  await expect(service.requestOtp({ phone }, requestKey, 'changed-peer')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  await expect(service.verifyOtp({ challengeId: challenge.challengeId, code }, key(), 'maintenance-peer')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  expect(sends).toBe(1);
  expect((await maintainIdentity(getPool(), { now })).challengesRedacted).toBe(0);
});

it('redacts expired encrypted replay payloads without permitting key reuse or session resurrection', async () => {
  const challenge = await service.requestOtp({ phone }, key(), 'maintenance-peer');
  const verifyKey = key(), verify = { challengeId: challenge.challengeId, code };
  const session = await service.verifyOtp(verify, verifyKey, 'maintenance-peer');
  now = new Date(now.getTime() + 8 * 24 * 60 * 60_000);
  expect((await maintainIdentity(getPool(), { now })).commandSecretsRedacted).toBe(1);
  const row = (await getPool().query('SELECT * FROM identity_command_results')).rows[0];
  expect(row.sealed_result).toBeNull(); expect(row.session_id).toBeNull();
  await expect(service.verifyOtp(verify, verifyKey, 'maintenance-peer')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  await expect(service.authenticate(session.accessToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  expect((await getPool().query('SELECT count(*)::int AS n FROM identity_sessions')).rows[0].n).toBe(1);
});

it('bounds each replica batch, skips active locks and converges after restart', async () => {
  const session = await login();
  await getPool().query(`INSERT INTO identity_rate_buckets (key_hash,bucket_start,attempts)
    SELECT 'synthetic-'||n, $1::timestamptz-interval '2 hours',1 FROM generate_series(1,5) n`, [now]);
  const lock = await getPool().connect();
  try {
    await lock.query('BEGIN');
    await lock.query('SELECT id FROM identity_otp_challenges FOR UPDATE');
    now = new Date(now.getTime() + 300_000);
    const concurrent = await Promise.all([maintainIdentity(getPool(), { now, batchSize: 2 }), maintainIdentity(getPool(), { now, batchSize: 2 })]);
    expect(concurrent.reduce((sum, item) => sum + item.challengesRedacted, 0)).toBe(0);
    expect(concurrent.reduce((sum, item) => sum + item.obsoleteRateBucketsDeleted, 0)).toBe(4);
    expect((await service.authenticate(session.accessToken)).actor.id).toBe(session.actor.id);
    await lock.query('COMMIT');
  } finally { await lock.query('ROLLBACK'); lock.release(); }
  const recovered = await maintainIdentity(getPool(), { now, batchSize: 2 });
  expect(recovered.challengesRedacted).toBe(1); expect(recovered.obsoleteRateBucketsDeleted).toBe(1);
  expect((await maintainIdentity(getPool(), { now })).obsoleteRateBucketsDeleted).toBe(0);
});

it('caps sliding refresh families at their original absolute deadline', async () => {
  let session = await login();
  const original = now.getTime();
  for (let day = 6; day <= 24; day += 6) {
    now = new Date(original + day * 24 * 60 * 60_000);
    session = await service.refresh({ refreshToken: session.refreshToken }, key(), 'maintenance-peer');
  }
  now = new Date(original + 30 * 24 * 60 * 60_000 - 60_000);
  session = await service.refresh({ refreshToken: session.refreshToken }, key(), 'maintenance-peer');
  expect(session.expiresAt).toBe(new Date(original + 30 * 24 * 60 * 60_000).toISOString());
  expect((await service.authenticate(session.accessToken)).actor.id).toBe(session.actor.id);
  now = new Date(original + 30 * 24 * 60 * 60_000);
  await expect(service.authenticate(session.accessToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  await expect(service.refresh({ refreshToken: session.refreshToken }, key(), 'maintenance-peer')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  expect((await maintainIdentity(getPool(), { now })).expiredFamiliesRevoked).toBe(1);
  expect((await getPool().query('SELECT revoke_reason FROM identity_session_families')).rows[0].revoke_reason).toBe('ABSOLUTE_EXPIRY');
});

it('does not persist unlimited distinct rate-limited attacker keys', async () => {
  const challenge = await service.requestOtp({ phone }, key(), 'maintenance-peer');
  // First attempt creates the actual keyed verification-rate bucket.
  await expect(service.verifyOtp({ challengeId: challenge.challengeId, code: code === '000000' ? '111111' : '000000' }, key(), 'maintenance-peer')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  await getPool().query('UPDATE identity_rate_buckets SET attempts=100');
  const before = (await getPool().query('SELECT count(*)::int AS n FROM identity_command_results')).rows[0].n;
  for (let i = 0; i < 10; i++) await expect(service.verifyOtp({ challengeId: randomUUID(), code: '000000' }, key(), 'maintenance-peer')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  expect((await getPool().query('SELECT count(*)::int AS n FROM identity_command_results')).rows[0].n).toBe(before);
});

it('refuses unbounded batches and invalid trusted clock values', async () => {
  for (const size of [0, -1, 1001, 1.5]) await expect(maintainIdentity(getPool(), { batchSize: size })).rejects.toThrow(/bounds/);
  await expect(maintainIdentity(getPool(), { now: new Date('invalid') })).rejects.toThrow(/bounds/);
});
