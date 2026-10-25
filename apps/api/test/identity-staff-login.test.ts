import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { IdentityService, totpCode, type OtpDelivery } from '../../../modules/identity/src';
import { closePool, getPool, initializeDb } from '../../../modules/shared/src/db';

const staffPhone = '+919000040001';
const riderPhone = '+919000040003';
const reusePhone = '+919000040004';
const customerPhone = '+919000040002';
const facilityId = randomUUID();
const keys = { hashKey: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex') };
const clock = () => now;
const key = () => randomUUID();
let now: Date;
let deliveries: { phone: string; code: string; challengeId: string }[];
let provider: OtpDelivery;
let relaxed: IdentityService;
let strict: IdentityService;
const PROPOSAL = readFileSync(new URL('../../../modules/schema/proposals/B01-staff-sessions.sql', import.meta.url), 'utf8');
const TRUNCATE = 'TRUNCATE identity_profiles, identity_otp_challenges, identity_rate_buckets, identity_session_families, identity_sessions, identity_command_results, identity_addresses, identity_audit, identity_staff, identity_staff_facilities, identity_staff_invitations, identity_staff_mfa, identity_staff_mfa_enrollments, identity_session_staff_bindings, identity_staff_mfa_steps CASCADE';
function nextTime(ms: number) { now = new Date(now.getTime() + ms); }
async function provisionStaff(phone: string, role: string, facilities: string[] = []) {
  const staff = (await getPool().query('INSERT INTO identity_staff (id,phone,role,created_at) VALUES ($1,$2,$3,$4) RETURNING id', [randomUUID(), phone, role, now])).rows[0];
  for (const facility of facilities) await getPool().query('INSERT INTO identity_staff_facilities (staff_id,facility_id) VALUES ($1,$2)', [staff.id, facility]);
  return staff.id as string;
}
async function requestChallenge(service: IdentityService, phone: string) {
  const challenge = await service.requestOtp({ phone }, key(), 'test-peer');
  const delivery = deliveries.find(item => item.challengeId === challenge.challengeId)!;
  return { challengeId: challenge.challengeId, code: delivery.code };
}
async function signin(service: IdentityService, phone: string, secret?: Buffer) {
  // Step past the 60-second phone resend guard on the controlled clock, then
  // derive the TOTP code from the step that is current at verification time.
  nextTime(61_000);
  const challenge = await requestChallenge(service, phone);
  return service.verifyOtp({ challengeId: challenge.challengeId, code: challenge.code, mfaCode: secret ? totpCode(secret, step()) : undefined }, key(), 'test-peer');
}
const step = () => Math.floor(now.getTime() / 30_000);
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Decode(text: string): Buffer {
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const character of text.replace(/=+$/, '')) {
    value = (value << 5) | BASE32.indexOf(character);
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(bytes);
}
/** Owner-provisioned enrollment fixture: seals the TOTP secret exactly like
 * the service stores enabled records, without inventing a runtime route. */
function sealSecret(staffId: string, secret: string): string {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(keys.encryptionKey, 'hex'), iv);
  cipher.setAAD(Buffer.from(`staff-mfa:${staffId}`));
  const body = Buffer.concat([cipher.update(JSON.stringify(secret), 'utf8'), cipher.final()]);
  return [iv, body, cipher.getAuthTag()].map(part => part.toString('base64url')).join('.');
}
async function ownerProvisionMfa(phone: string, role: string): Promise<Buffer> {
  const staffId = await provisionStaff(phone, role, []);
  const secret = randomBytes(20).toString('base64url');
  await getPool().query("INSERT INTO identity_staff_mfa (staff_id,secret_cipher,status,version,created_at,updated_at) VALUES ($1,$2,'ENABLED',2,$3,$3)", [staffId, sealSecret(staffId, secret), now]);
  return Buffer.from(secret, 'base64url');
}
/** Self-service enrollment through the relaxed nonproduction service. */
async function enrollMfa(phone: string) {
  await provisionStaff(phone, 'OPERATOR', [facilityId]);
  const session = await signin(relaxed, phone);
  const challenge = await relaxed.configureStaffMfa(session.accessToken, { action: 'ENROLL' }, key());
  const uri = await relaxed.mfaProvisioningUri(challenge.challengeId);
  const secret = base32Decode(new URL(uri).searchParams.get('secret')!);
  const enabled = await relaxed.configureStaffMfa(session.accessToken, { action: 'VERIFY', challengeId: challenge.challengeId, code: totpCode(secret, step()) }, key());
  expect(enabled).toEqual({ status: 'ENABLED', version: 2 });
  return secret;
}

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/laundry_verify_')) throw new Error('Disposable local PostgreSQL required');
  await initializeDb();
  await getPool().query(PROPOSAL);
});
beforeEach(async () => {
  await getPool().query(TRUNCATE);
  now = new Date('2026-10-25T10:00:00Z');
  deliveries = [];
  provider = { mode: 'FAKE', async send(input) { deliveries.push(input); return { reference: `fake-${input.challengeId}` }; } };
  relaxed = new IdentityService({ db: getPool(), provider, ...keys, clock });
  strict = new IdentityService({ db: getPool(), provider, ...keys, clock, requireStaffMfa: true });
});
afterAll(closePool);

describe('B01 staff login enforcement (phone OTP plus enrolled current TOTP)', () => {
  it('issues a privileged staff session only after the phone OTP and the enrolled TOTP code', async () => {
    const secret = await enrollMfa(staffPhone);
    nextTime(61_000);
    const challenge = await requestChallenge(strict, staffPhone);
    await expect(strict.verifyOtp({ challengeId: challenge.challengeId, code: challenge.code }, key(), 'test-peer'))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const wrong = '000000' === totpCode(secret, step()) ? '111111' : '000000';
    await expect(strict.verifyOtp({ challengeId: challenge.challengeId, code: challenge.code, mfaCode: wrong }, key(), 'test-peer'))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const session = await strict.verifyOtp({ challengeId: challenge.challengeId, code: challenge.code, mfaCode: totpCode(secret, step()) }, key(), 'test-peer');
    expect(session.actor.role).toBe('OPERATOR');
    expect(session.actor.facilityIds).toEqual([facilityId]);
    const binding = (await getPool().query('SELECT role,mfa_version FROM identity_session_staff_bindings ORDER BY created_at DESC LIMIT 1')).rows[0];
    expect(binding).toEqual({ role: 'OPERATOR', mfa_version: 2 });
  });

  it('applies the same second factor to RIDER sessions via owner provisioning', async () => {
    const secret = await ownerProvisionMfa(riderPhone, 'RIDER');
    const challenge = await requestChallenge(strict, riderPhone);
    await expect(strict.verifyOtp({ challengeId: challenge.challengeId, code: challenge.code }, key(), 'test-peer'))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const session = await strict.verifyOtp({ challengeId: challenge.challengeId, code: challenge.code, mfaCode: totpCode(secret, step()) }, key(), 'test-peer');
    expect(session.actor.role).toBe('RIDER');
  });

  it('refuses staff sign-in when no authenticator is enrolled and keeps customer sign-in compatible', async () => {
    await provisionStaff(staffPhone, 'OPERATOR', []);
    const challenge = await requestChallenge(strict, staffPhone);
    await expect(strict.verifyOtp({ challengeId: challenge.challengeId, code: challenge.code, mfaCode: '123456' }, key(), 'test-peer'))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const customer = await signin(strict, customerPhone);
    expect(customer.actor.role).toBe('CUSTOMER');
  });

  it('rejects a reused TOTP step atomically and accepts the next step', async () => {
    const secret = await ownerProvisionMfa(reusePhone, 'OPERATOR');
    const first = await requestChallenge(strict, reusePhone);
    await strict.verifyOtp({ challengeId: first.challengeId, code: first.code, mfaCode: totpCode(secret, step()) }, key(), 'test-peer');
    nextTime(61_000);
    const second = await requestChallenge(strict, reusePhone);
    const drifted = step() + 1;
    await strict.verifyOtp({ challengeId: second.challengeId, code: second.code, mfaCode: totpCode(secret, drifted) }, key(), 'test-peer');
    nextTime(61_000);
    const third = await requestChallenge(strict, reusePhone);
    await expect(strict.verifyOtp({ challengeId: third.challengeId, code: third.code, mfaCode: totpCode(secret, drifted) }, key(), 'test-peer'))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    nextTime(61_000);
    const fourth = await requestChallenge(strict, reusePhone);
    const next = await strict.verifyOtp({ challengeId: fourth.challengeId, code: fourth.code, mfaCode: totpCode(secret, step()) }, key(), 'test-peer');
    expect(next.actor.role).toBe('OPERATOR');
    expect((await getPool().query('SELECT count(*)::int AS n FROM identity_staff_mfa_steps')).rows[0].n).toBe(3);
  });
});

describe('B01 staff session binding (privilege cannot be gained, kept or replayed)', () => {
  it('never lets an existing customer family gain staff privileges after later provisioning', async () => {
    const before = await signin(relaxed, staffPhone);
    expect(before.actor.role).toBe('CUSTOMER');
    await provisionStaff(staffPhone, 'OPERATOR', []);
    expect((await relaxed.authenticate(before.accessToken)).actor.role).toBe('CUSTOMER');
    const refreshed = await relaxed.refresh({ refreshToken: before.refreshToken }, key(), 'test-peer');
    expect(refreshed.actor.role).toBe('CUSTOMER');
  });

  it('fails privileged tokens after deactivation and revokes the family', async () => {
    const secret = await enrollMfa(staffPhone);
    const session = await signin(strict, staffPhone, secret);
    await getPool().query('UPDATE identity_staff SET active=false,deactivated_at=$2 WHERE phone=$1', [staffPhone, now]);
    nextTime(60_000);
    await expect(strict.authenticate(session.accessToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(strict.refresh({ refreshToken: session.refreshToken }, key(), 'test-peer')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const family = (await getPool().query('SELECT revoke_reason FROM identity_session_families WHERE revoked_at IS NOT NULL')).rows[0];
    expect(family.revoke_reason).toBe('STAFF_UNBOUND');
    const plain = await signin(relaxed, staffPhone);
    expect(plain.actor.role).toBe('CUSTOMER');
  });

  it('fails privileged tokens after a role change', async () => {
    const secret = await enrollMfa(staffPhone);
    const session = await signin(strict, staffPhone, secret);
    await getPool().query('UPDATE identity_staff SET role=$2 WHERE phone=$1', [staffPhone, 'SUPPORT']);
    nextTime(60_000);
    await expect(strict.authenticate(session.accessToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('fails privileged tokens after an MFA reset', async () => {
    const secret = await enrollMfa(staffPhone);
    const session = await signin(strict, staffPhone, secret);
    const disabled = await strict.configureStaffMfa(session.accessToken, { action: 'DISABLE', challengeId: randomUUID(), code: totpCode(secret, step() + 1), expectedVersion: 2 }, key());
    expect(disabled.status).toBe('DISABLED');
    nextTime(60_000);
    await expect(strict.authenticate(session.accessToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('refuses a relaxed staff session at an MFA-enforcing boundary', async () => {
    await enrollMfa(staffPhone);
    const relaxedSession = await signin(relaxed, staffPhone);
    await expect(strict.authenticate(relaxedSession.accessToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  for (const kind of ['login', 'refresh'] as const) it(`rechecks the staff binding on cached ${kind} credentials`, async () => {
    const secret = await enrollMfa(staffPhone);
    nextTime(61_000);
    const challenge = await requestChallenge(strict, staffPhone), loginKey = key(), refreshKey = key();
    const verification = { ...challenge, mfaCode: totpCode(secret, step()) };
    const session = await strict.verifyOtp(verification, loginKey, 'test-peer');
    if (kind === 'refresh') await strict.refresh({ refreshToken: session.refreshToken }, refreshKey, 'test-peer');
    await getPool().query('UPDATE identity_staff SET active=false,deactivated_at=$2 WHERE phone=$1', [staffPhone, now]);
    const retry = kind === 'login' ? strict.verifyOtp(verification, loginKey, 'test-peer') : strict.refresh({ refreshToken: session.refreshToken }, refreshKey, 'test-peer');
    await expect(retry).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await getPool().query("SELECT revoke_reason FROM identity_session_families WHERE revoke_reason='STAFF_UNBOUND'")).rows).toHaveLength(1);
  });

  it('rechecks the staff binding on cached credential replay', async () => {
    const secret = await enrollMfa(staffPhone);
    const session = await signin(strict, staffPhone, secret);
    const address = { label: 'Home', line1: '12 MG Road', city: 'Bengaluru', postalCode: '560001', coordinates: { lat: 12.97, lng: 77.59 } };
    const replayKey = key();
    await strict.createAddress(session.accessToken, address, replayKey);
    await getPool().query('UPDATE identity_staff SET active=false,deactivated_at=$2 WHERE phone=$1', [staffPhone, now]);
    nextTime(60_000);
    await expect(strict.createAddress(session.accessToken, address, replayKey)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('B01 production staff login cannot disable MFA enforcement', () => {
  it('requires the enrolled TOTP for staff sessions with requireStaffMfa unset', async () => {
    const secret = await enrollMfa(staffPhone);
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const production = new IdentityService({
        db: getPool(),
        provider: { mode: 'LIVE', async send(input) { deliveries.push(input); return { reference: `fake-live-${input.challengeId}` }; } },
        ...keys, clock, maxOtpPerHour: 100,
      });
      nextTime(61_000);
      const challenge = await requestChallenge(production, staffPhone);
      await expect(production.verifyOtp({ challengeId: challenge.challengeId, code: challenge.code }, key(), 'test-peer'))
        .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      const session = await production.verifyOtp({ challengeId: challenge.challengeId, code: challenge.code, mfaCode: totpCode(secret, step()) }, key(), 'test-peer');
      expect(session.actor.role).toBe('OPERATOR');
    } finally { process.env.NODE_ENV = previousEnv; }
  });
});
