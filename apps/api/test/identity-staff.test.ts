import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { v2 } from '@laundry/contracts';
import { IdentityModule } from '../src/features/identity/identity.module';
import { configureHttpBody } from '../src/http-body';
import { EnvelopeFilter } from '../src/filters/http-exception.filter';
import { createV2Client } from '../../../packages/api-client/src/v2';
import { closePool, getPool, initializeDb } from '../../../modules/shared/src/db';
import { IdentityService, totpCode, type OtpDelivery } from '../../../modules/identity/src';

const operatorPhone = '+919000030001';
const riderPhone = '+919000030002';
const customerPhone = '+919000030003';
const invitedPhone = '+919000030004';
const facilityIds = [randomUUID(), randomUUID()].sort();
const keys = { hashKey: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex') };
const clock = () => now;
const key = () => randomUUID();
let now: Date;
let service: IdentityService;
let deliveries: { phone: string; code: string; challengeId: string }[];
let provider: OtpDelivery;
const PROPOSAL = readFileSync(new URL('../../../modules/schema/proposals/B01-staff-sessions.sql', import.meta.url), 'utf8');
const TRUNCATE = 'TRUNCATE identity_profiles, identity_otp_challenges, identity_rate_buckets, identity_session_families, identity_sessions, identity_command_results, identity_addresses, identity_audit, identity_staff, identity_staff_facilities, identity_staff_invitations, identity_staff_mfa, identity_staff_mfa_enrollments, identity_session_staff_bindings, identity_staff_mfa_steps CASCADE';
function nextTime(ms: number) { now = new Date(now.getTime() + ms); }
async function signin(number: string) {
  const challenge = await service.requestOtp({ phone: number }, key(), 'test-peer');
  const delivery = deliveries.find(item => item.challengeId === challenge.challengeId)!;
  return service.verifyOtp({ challengeId: challenge.challengeId, code: delivery.code }, key(), 'test-peer');
}
async function provisionStaff(phone: string, role: string, facilities: string[]) {
  const staff = (await getPool().query('INSERT INTO identity_staff (id,phone,role,created_at) VALUES ($1,$2,$3,$4) RETURNING id', [randomUUID(), phone, role, now])).rows[0];
  for (const facilityId of facilities) await getPool().query('INSERT INTO identity_staff_facilities (staff_id,facility_id) VALUES ($1,$2)', [staff.id, facilityId]);
  return staff.id as string;
}
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
const invitation = { phone: invitedPhone, role: 'FACILITY', facilityIds, reason: 'Opening candidate facility coverage roll' } as const;

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
  service = new IdentityService({ db: getPool(), provider, ...keys, clock });
});
afterAll(closePool);

describe('B01 staff invitation lifecycle (provisioning vs runtime separation)', () => {
  it('rejects invitations from a plain customer session with the published FORBIDDEN code', async () => {
    const customer = await signin(customerPhone);
    await expect(service.inviteStaff(customer.accessToken, invitation, key())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await getPool().query('SELECT count(*)::int AS n FROM identity_staff_invitations')).rows[0].n).toBe(0);
  });

  it('records an expiring pending invitation attributed to the caller with only contract facts', async () => {
    await provisionStaff(operatorPhone, 'OPERATOR', facilityIds);
    const operator = await signin(operatorPhone);
    const result = await service.inviteStaff(operator.accessToken, invitation, key());
    expect(result).toEqual({ invitationId: result.invitationId, expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString() });
    const row = (await getPool().query('SELECT * FROM identity_staff_invitations')).rows[0];
    expect(row).toMatchObject({ id: result.invitationId, phone: invitedPhone, role: 'FACILITY', status: 'PENDING', created_by: expect.any(String), reason: invitation.reason });
    expect(row.facility_ids.sort()).toEqual(facilityIds);
    const audit = (await getPool().query("SELECT action,profile_id,resource_id FROM identity_audit WHERE action='STAFF_INVITATION_CREATED'")).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].resource_id).toBe(result.invitationId);
    expect(JSON.stringify((await getPool().query('SELECT row_to_json(i) AS data FROM identity_command_results i')).rows)).not.toContain(invitedPhone);
  });

  it('refuses a duplicate pending intent and lazily retires an expired one on the server clock', async () => {
    await provisionStaff(operatorPhone, 'OPERATOR', []);
    const operator = await signin(operatorPhone);
    const first = await service.inviteStaff(operator.accessToken, invitation, key());
    await expect(service.inviteStaff(operator.accessToken, invitation, key())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await getPool().query('SELECT count(*)::int AS n FROM identity_staff_invitations')).rows[0].n).toBe(1);
    nextTime(8 * 24 * 60 * 60_000);
    const operatorAgain = await signin(operatorPhone);
    const second = await service.inviteStaff(operatorAgain.accessToken, invitation, key());
    expect(second.invitationId).not.toBe(first.invitationId);
    expect((await getPool().query("SELECT status, count(*)::int AS n FROM identity_staff_invitations GROUP BY status ORDER BY status")).rows).toEqual([
      { status: 'EXPIRED', n: 1 }, { status: 'PENDING', n: 1 },
    ]);
  });

  it('refuses inviting a phone that already carries any staff provisioning record', async () => {
    await provisionStaff(operatorPhone, 'OPERATOR', []);
    const operator = await signin(operatorPhone);
    await expect(service.inviteStaff(operator.accessToken, { ...invitation, phone: operatorPhone }, key())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('never promotes an invited phone: sign-in stays a customer actor until provisioning', async () => {
    await provisionStaff(operatorPhone, 'OPERATOR', []);
    const operator = await signin(operatorPhone);
    await service.inviteStaff(operator.accessToken, invitation, key());
    const session = await signin(invitedPhone);
    expect(session.actor).toEqual({ id: session.actor.id, role: 'CUSTOMER', facilityIds: [], scope: { facilityIds: [] } });
  });

  it('binds role and facility scope only from provisioning-created active staff rows', async () => {
    await provisionStaff(operatorPhone, 'FACILITY', facilityIds);
    const staff = await signin(operatorPhone);
    expect(staff.actor).toEqual({ id: staff.actor.id, role: 'FACILITY', facilityIds, scope: { facilityIds } });
    const refreshed = await service.refresh({ refreshToken: staff.refreshToken }, key(), 'test-peer');
    expect(refreshed.actor.role).toBe('FACILITY');
    expect(refreshed.actor.facilityIds).toEqual(facilityIds);
    await getPool().query('UPDATE identity_staff SET active=false,deactivated_at=$2 WHERE phone=$1', [operatorPhone, now]);
    nextTime(60_000);
    // A privileged token never falls back to a customer actor: the bound
    // family is revoked and every held token fails.
    await expect(service.authenticate(refreshed.accessToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(service.refresh({ refreshToken: staff.refreshToken }, key(), 'test-peer')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const plain = await signin(operatorPhone);
    expect(plain.actor.role).toBe('CUSTOMER');
    expect(plain.actor.facilityIds).toEqual([]);
  });
});

describe('B01 staff MFA lifecycle (RFC 6238 with out-of-band device provisioning)', () => {
  async function enableMfa(phone = operatorPhone) {
    await provisionStaff(phone, 'OPERATOR', []);
    const session = await signin(phone);
    const challenge = await service.configureStaffMfa(session.accessToken, { action: 'ENROLL' }, key());
    expect(challenge).toMatchObject({ status: 'CHALLENGE' });
    const uri = await service.mfaProvisioningUri(challenge.challengeId);
    const provisioning = new URL(uri);
    expect(provisioning.host).toBe('totp');
    expect(decodeURIComponent(provisioning.pathname)).toBe(`/${'Laundry'}:${phone}`);
    expect(provisioning.searchParams.getAll('issuer')).toEqual(['Laundry']);
    const secret = base32Decode(new URL(uri).searchParams.get('secret')!);
    return { session, challenge, secret };
  }

  it('refuses non-staff actors and riders outside the published role set', async () => {
    const customer = await signin(customerPhone);
    await expect(service.configureStaffMfa(customer.accessToken, { action: 'ENROLL' }, key())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await provisionStaff(riderPhone, 'RIDER', facilityIds);
    const rider = await signin(riderPhone);
    expect(rider.actor.role).toBe('RIDER');
    await expect(service.configureStaffMfa(rider.accessToken, { action: 'ENROLL' }, key())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('reuses the pending enrollment challenge, verifies with drift tolerance and enables MFA', async () => {
    const { session, challenge, secret } = await enableMfa();
    const repeated = await service.configureStaffMfa(session.accessToken, { action: 'ENROLL' }, key());
    expect(repeated).toEqual(challenge);
    expect((await getPool().query('SELECT count(*)::int AS n FROM identity_staff_mfa_enrollments')).rows[0].n).toBe(1);
    await expect(service.configureStaffMfa(session.accessToken, { action: 'VERIFY', challengeId: challenge.challengeId, code: '000000' === totpCode(secret, Math.floor(now.getTime() / 30_000)) ? '111111' : '000000' }, key()))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const wrong = totpCode(secret, Math.floor(now.getTime() / 30_000) + 3);
    await expect(service.configureStaffMfa(session.accessToken, { action: 'VERIFY', challengeId: challenge.challengeId, code: wrong }, key())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const enabled = await service.configureStaffMfa(session.accessToken, { action: 'VERIFY', challengeId: challenge.challengeId, code: totpCode(secret, Math.floor(now.getTime() / 30_000) - 1) }, key());
    expect(enabled).toEqual({ status: 'ENABLED', version: 2 });
    const row = (await getPool().query('SELECT status,version FROM identity_staff_mfa')).rows[0];
    expect(row.status).toBe('ENABLED');
    expect((await service.authenticate(session.accessToken)).actor.role).toBe('OPERATOR');
  });

  it('locks a leaking enrollment after five bad attempts and requires a fresh enrollment', async () => {
    const { session, challenge } = await enableMfa();
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(service.configureStaffMfa(session.accessToken, { action: 'VERIFY', challengeId: challenge.challengeId, code: '111111' }, key())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    }
    expect((await getPool().query('SELECT attempts FROM identity_staff_mfa_enrollments')).rows[0].attempts).toBe(5);
    await expect(service.configureStaffMfa(session.accessToken, { action: 'VERIFY', challengeId: challenge.challengeId, code: '222222' }, key())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const renewed = await service.configureStaffMfa(session.accessToken, { action: 'ENROLL' }, key());
    expect(renewed.status).toBe('CHALLENGE');
    expect(renewed.challengeId).not.toBe(challenge.challengeId);
    const attempts = (await getPool().query('SELECT attempts FROM identity_staff_mfa_enrollments ORDER BY created_at DESC LIMIT 1')).rows[0];
    expect(attempts.attempts).toBe(0);
  });

  it('rejects enrollment expiry outside the bounded window', async () => {
    const { session, challenge, secret } = await enableMfa();
    nextTime(11 * 60_000);
    await expect(service.configureStaffMfa(session.accessToken, { action: 'VERIFY', challengeId: challenge.challengeId, code: totpCode(secret, Math.floor(now.getTime() / 30_000)) }, key())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('keeps the idempotent replay stable after enabling', async () => {
    const { session, challenge, secret } = await enableMfa();
    const verifyKey = key();
    await service.configureStaffMfa(session.accessToken, { action: 'VERIFY', challengeId: challenge.challengeId, code: totpCode(secret, Math.floor(now.getTime() / 30_000)) }, verifyKey);
    const replayed = await service.configureStaffMfa(session.accessToken, { action: 'VERIFY', challengeId: challenge.challengeId, code: totpCode(secret, Math.floor(now.getTime() / 30_000)) }, verifyKey);
    expect(replayed).toEqual({ status: 'ENABLED', version: 2 });
    expect((await getPool().query("SELECT count(*)::int AS n FROM identity_audit WHERE action='STAFF_MFA_ENABLED'")).rows[0].n).toBe(1);
  });

  it('disables MFA only with the current code and version, then permits re-enrollment', async () => {
    const { session, challenge, secret } = await enableMfa();
    await service.configureStaffMfa(session.accessToken, { action: 'VERIFY', challengeId: challenge.challengeId, code: totpCode(secret, Math.floor(now.getTime() / 30_000)) }, key());
    const invalidCode = totpCode(secret, Math.floor(now.getTime() / 30_000) + 5);
    await expect(service.configureStaffMfa(session.accessToken, { action: 'DISABLE', challengeId: challenge.challengeId, code: invalidCode, expectedVersion: 2 }, key())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(service.configureStaffMfa(session.accessToken, { action: 'DISABLE', challengeId: challenge.challengeId, code: invalidCode, expectedVersion: 1 }, key())).rejects.toMatchObject({ code: 'FORBIDDEN', currentVersion: 2 });
    const disabled = await service.configureStaffMfa(session.accessToken, { action: 'DISABLE', challengeId: challenge.challengeId, code: totpCode(secret, Math.floor(now.getTime() / 30_000) + 1), expectedVersion: 2 }, key());
    expect(disabled).toEqual({ status: 'DISABLED', version: 3 });
    expect((await getPool().query("SELECT status,version FROM identity_staff_mfa")).rows[0]).toEqual({ status: 'DISABLED', version: 3 });
    const enabledAgain = await service.configureStaffMfa(session.accessToken, { action: 'ENROLL' }, key());
    expect(enabledAgain).toMatchObject({ status: 'CHALLENGE' });
  });
});

describe('B01 staff boundary through the real SDK over HTTP', () => {
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

  it('serves the published staff routes with contract envelopes and forbids customer actors', async () => {
    await provisionStaff(operatorPhone, 'OPERATOR', []);
    const customer = await signin(customerPhone);
    let bearer = customer.accessToken;
    const client = createV2Client({ baseUrl: base, getToken: () => bearer });
    await expect(client.inviteStaff(invitation)).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    const operator = await signin(operatorPhone);
    bearer = operator.accessToken;
    const result = await client.inviteStaff(invitation);
    expect(result).toMatchObject({ invitationId: expect.any(String), expiresAt: expect.any(String) });
    const anonymous = await fetch(base + '/identity/staff/invitations', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key() }, body: JSON.stringify(invitation) });
    expect(anonymous.status).toBe(401);
    expect(v2.errorEnvelopeSchema.parse(await anonymous.json()).code).toBe('UNAUTHENTICATED');
    const malformed = await fetch(base + '/identity/staff/mfa', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}`, 'idempotency-key': key() }, body: JSON.stringify({ action: 'UNKNOWN' }) });
    expect(malformed.status).toBe(400);
  });
});
