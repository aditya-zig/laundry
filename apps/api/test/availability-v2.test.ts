import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes, randomUUID } from 'node:crypto';
import { v2 } from '@laundry/contracts';
import { AvailabilityModule } from '../src/features/availability/availability.module';
import { configureHttpBody } from '../src/http-body';
import { EnvelopeFilter } from '../src/filters/http-exception.filter';
import { createV2Client } from '../../../packages/api-client/src/v2';
import { closePool, getPool, initializeDb } from '../../../modules/shared/src/db';
import { AvailabilityService } from '../../../modules/availability/src';
import { IdentityService, type OtpDelivery } from '../../../modules/identity/src';

const operatorPhone = '+919000060001';
const customerPhone = '+919000060002';
const keys = { hashKey: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex') };
const key = () => randomUUID();
const postalCode = '560001';
let now: Date;
let identity: IdentityService;
let availability: AvailabilityService;
let deliveries: { phone: string; code: string; challengeId: string }[];
const clock = () => now;
const TRUNCATE = `TRUNCATE availability_areas, availability_area_postal_codes, availability_buckets, availability_holds,
  catalog_services, catalog_garments, catalog_rate_cards,
  v2_command_results, v2_audit, v2_outbox, v2_inbox,
  identity_profiles, identity_otp_challenges, identity_rate_buckets, identity_session_families,
  identity_sessions, identity_command_results, identity_addresses, identity_audit,
  identity_staff, identity_staff_facilities, identity_staff_invitations, identity_staff_mfa,
  identity_staff_mfa_enrollments, identity_whatsapp_links CASCADE`;

function nextTime(ms: number) { now = new Date(now.getTime() + ms); }

const weekdays = [1, 2, 3, 4, 5, 6].map(dayOfWeek => ({ dayOfWeek, start: '09:00', end: '18:00' }));

async function provisionStaff(phone: string, role = 'OPERATOR') {
  await getPool().query('INSERT INTO identity_staff (id,phone,role,created_at) VALUES ($1,$2,$3,$4)', [randomUUID(), phone, role, now]);
}

async function signin(phone: string) {
  const challenge = await identity.requestOtp({ phone }, key(), 'test-peer');
  const delivery = deliveries.find(item => item.challengeId === challenge.challengeId)!;
  return identity.verifyOtp({ challengeId: challenge.challengeId, code: delivery.code }, key(), 'test-peer');
}

interface AreaOverrides {
  hours?: unknown;
  slotMinutes?: number;
  leadMinutes?: number;
  horizonDays?: number;
  active?: boolean;
}

async function insertArea(overrides: AreaOverrides = {}) {
  const id = randomUUID();
  await getPool().query(`INSERT INTO availability_areas
    (id,name,timezone,polygon,hours,slot_minutes,pickup_lead_minutes,booking_horizon_days,version,active,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,$10)`, [
    id,
    'Synthetic service area',
    'Asia/Kolkata',
    JSON.stringify([{ lat: 12.9, lng: 77.5 }, { lat: 13.0, lng: 77.5 }, { lat: 13.0, lng: 77.7 }]),
    JSON.stringify(overrides.hours ?? weekdays),
    overrides.slotMinutes ?? 60,
    overrides.leadMinutes ?? 120,
    overrides.horizonDays ?? 14,
    overrides.active ?? true,
    now,
  ]);
  await getPool().query('INSERT INTO availability_area_postal_codes (postal_code,area_id) VALUES ($1,$2)', [postalCode, id]);
  return id;
}

async function insertService(turnaroundHours = 48, code = 'WASH_FOLD') {
  const id = randomUUID();
  await getPool().query(`INSERT INTO catalog_services
    (id,version,code,name,description,image_url,billing_unit,turnaround_hours,features,care_exclusions,active,created_at,updated_at)
    VALUES ($1,1,$2,$3,'Synthetic','https://assets.example.test/service.png','PIECE',$4,'[]','[]',true,$5,$5)`,
  [id, code, `Synthetic service ${turnaroundHours}`, turnaroundHours, now]);
  return id;
}

async function insertBucket(areaId: string, start: string, end: string, capacity: number) {
  const id = randomUUID();
  await getPool().query(`INSERT INTO availability_buckets
    (id,facility_id,area_id,starts_at,ends_at,timezone,capacity,reserved,version,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,'Asia/Kolkata',$6,0,1,$7,$7)`,
  [id, randomUUID(), areaId, new Date(start), new Date(end), capacity, now]);
  return id;
}

const reserved = async (bucketId: string) => (await getPool().query('SELECT reserved FROM availability_buckets WHERE id=$1', [bucketId])).rows[0].reserved as number;

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/laundry_verify_')) {
    throw new Error('Disposable local PostgreSQL required');
  }
  await initializeDb();
});
beforeEach(async () => {
  await getPool().query(TRUNCATE);
  now = new Date('2026-10-26T02:00:00Z');
  deliveries = [];
  const provider: OtpDelivery = { mode: 'FAKE', async send(input) { deliveries.push(input); return { reference: `fake-${input.challengeId}` }; } };
  identity = new IdentityService({ db: getPool(), provider, ...keys, clock });
  availability = new AvailabilityService({ db: getPool(), authenticate: token => identity.authenticate(token), clock });
});
afterAll(closePool);

describe('B03 published service areas and slot pairs', () => {
  it('resolves an active area by postal code and hides unserved codes', async () => {
    const areaId = await insertArea();
    expect(await availability.checkArea(postalCode)).toMatchObject({ id: areaId, timezone: 'Asia/Kolkata', active: true });
    await expect(availability.checkArea('999999')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(availability.checkArea('abc')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await getPool().query('UPDATE availability_areas SET active=false WHERE id=$1', [areaId]);
    await expect(availability.checkArea(postalCode)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('honours the lead time and publishes one pair per open slot with the slowest care time', async () => {
    const areaId = await insertArea();
    const fast = await insertService(24, 'WASH_PRESS');
    const slow = await insertService(48);
    await insertBucket(areaId, '2026-10-26T04:30:00.000Z', '2026-10-26T05:30:00.000Z', 2);

    const pairs = await availability.listSlots({
      areaId, serviceIds: [fast, slow], from: '2026-10-26T00:00:00.000Z', to: '2026-10-27T00:00:00.000Z',
    });
    // 09:00 IST is only 90 minutes away at 07:30 IST with a 120-minute lead.
    expect(pairs).toHaveLength(8);
    expect(pairs[0]).toMatchObject({
      pickupWindow: { start: '2026-10-26T04:30:00.000Z', end: '2026-10-26T05:30:00.000Z', timezone: 'Asia/Kolkata' },
      returnWindow: { start: '2026-10-28T05:30:00.000Z', end: '2026-10-28T06:30:00.000Z' },
      available: true,
    });
    expect(pairs[1]).toMatchObject({ available: false, unavailableReason: 'NO_CAPACITY' });
    expect(v2.slotPairListSchema.parse(pairs)).toEqual(pairs);
  });

  it('publishes nothing on closed days and marks a missed requested deadline explicitly', async () => {
    const areaId = await insertArea();
    const serviceId = await insertService(48);
    await insertBucket(areaId, '2026-10-26T04:30:00.000Z', '2026-10-26T05:30:00.000Z', 2);

    const sunday = await availability.listSlots({
      areaId, serviceIds: [serviceId], from: '2026-10-31T18:30:00.000Z', to: '2026-11-01T18:29:00.000Z',
    });
    expect(sunday).toEqual([]);

    const missed = await availability.listSlots({
      areaId, serviceIds: [serviceId], from: '2026-10-26T00:00:00.000Z', to: '2026-10-26T12:00:00.000Z',
      requestedReturnBy: '2026-10-28T05:30:00.000Z',
    });
    expect(missed[0]).toMatchObject({ available: true });
    expect(missed[1]).toMatchObject({ available: false, unavailableReason: 'DEADLINE_UNAVAILABLE' });
  });

  it('crosses local midnight for an overnight window', async () => {
    const areaId = await insertArea({
      hours: [{ dayOfWeek: 1, start: '22:00', end: '02:00' }],
      slotMinutes: 60,
      leadMinutes: 0,
    });
    const serviceId = await insertService(1);
    const pairs = await availability.listSlots({
      areaId, serviceIds: [serviceId], from: '2026-10-26T00:00:00.000Z', to: '2026-10-26T23:59:00.000Z',
    });
    expect(pairs.map(pair => pair.pickupWindow.start)).toEqual([
      '2026-10-26T16:30:00.000Z', // 22:00 IST Monday
      '2026-10-26T17:30:00.000Z',
      '2026-10-26T18:30:00.000Z', // 00:00 IST Tuesday
      '2026-10-26T19:30:00.000Z',
    ]);
    expect(pairs[2].pickupWindow.end).toBe('2026-10-26T19:30:00.000Z');
  });
});

describe('B03 atomic capacity, holds and reservations', () => {
  async function seed() {
    const areaId = await insertArea();
    const serviceId = await insertService(48);
    const bucketId = await insertBucket(areaId, '2026-10-26T04:30:00.000Z', '2026-10-26T05:30:00.000Z', 1);
    return { areaId, serviceId, bucketId };
  }
  const window = { start: '2026-10-26T04:30:00.000Z', end: '2026-10-26T05:30:00.000Z', timezone: 'Asia/Kolkata' };

  it('turns two concurrent last-slot holds into exactly one reservation', async () => {
    const { areaId, serviceId, bucketId } = await seed();
    const results = await Promise.allSettled([availability.hold(areaId, window), availability.hold(areaId, window)]);
    const fulfilled = results.filter(result => result.status === 'fulfilled');
    const rejected = results.filter(result => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'NO_CAPACITY' });
    expect(await reserved(bucketId)).toBe(1);
    const pairs = await availability.listSlots({
      areaId, serviceIds: [serviceId], from: '2026-10-26T00:00:00.000Z', to: '2026-10-26T06:00:00.000Z',
    });
    expect(pairs[0]).toMatchObject({ available: false, unavailableReason: 'NO_CAPACITY' });
  });

  it('returns capacity once on release and reserves a held window for one order', async () => {
    const { areaId, bucketId } = await seed();
    const hold = await availability.hold(areaId, window);
    expect(hold.expiresAt).toBe(new Date(now.getTime() + 15 * 60_000).toISOString());
    const orderId = randomUUID();
    expect(await availability.reserve(hold.holdId, orderId)).toEqual({ reservationId: hold.holdId });
    expect(await availability.reserve(hold.holdId, orderId)).toEqual({ reservationId: hold.holdId });
    await expect(availability.reserve(hold.holdId, randomUUID())).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });

    expect(await availability.release(hold.holdId, 'Customer cancelled')).toEqual({ released: true });
    expect(await reserved(bucketId)).toBe(0);
    expect(await availability.release(hold.holdId, 'Customer cancelled')).toEqual({ released: false });
    expect(await reserved(bucketId)).toBe(0);
  });

  it('expires holds after a restart without releasing capacity twice', async () => {
    const { areaId, bucketId } = await seed();
    await availability.hold(areaId, window);
    expect(await reserved(bucketId)).toBe(1);
    nextTime(16 * 60_000);
    const restarted = new AvailabilityService({ db: getPool(), authenticate: token => identity.authenticate(token), clock });
    expect(await restarted.expireHolds()).toBe(1);
    expect(await restarted.expireHolds()).toBe(0);
    expect(await reserved(bucketId)).toBe(0);
  });

  it('versions operator capacity edits and refuses a capacity below reservations', async () => {
    const { areaId, bucketId } = await seed();
    await provisionStaff(operatorPhone);
    const operator = await signin(operatorPhone);
    const customer = await signin(customerPhone);

    await expect(availability.setCapacity(customer.accessToken, { bucketId, capacity: 3, expectedVersion: 1, reason: 'Nope' }, key()))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    const raised = await availability.setCapacity(operator.accessToken, { bucketId, capacity: 3, expectedVersion: 1, reason: 'Add a van' }, key());
    expect(raised).toMatchObject({ capacity: 3, reserved: 0, version: 2 });
    await expect(availability.setCapacity(operator.accessToken, { bucketId, capacity: 4, expectedVersion: 1, reason: 'Stale edit' }, key()))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 2 });

    await availability.hold(areaId, window);
    await expect(availability.setCapacity(operator.accessToken, { bucketId, capacity: 0, expectedVersion: 2, reason: 'Too low' }, key()))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });

    const audit = await getPool().query("SELECT action, reason FROM v2_audit WHERE action='CAPACITY_UPDATED'");
    expect(audit.rows).toEqual([{ action: 'CAPACITY_UPDATED', reason: 'Add a van' }]);
    const calendar = await availability.operationsCalendar(operator.accessToken, { areaId });
    expect(calendar.buckets).toHaveLength(1);
    expect(calendar.buckets[0]).toMatchObject({ capacity: 3, reserved: 1, version: 2 });
    await expect(availability.operationsCalendar(customer.accessToken)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('B03 availability through the real SDK over HTTP', () => {
  let app: NestExpressApplication;
  let base: string;
  beforeEach(async () => {
    app = await NestFactory.create<NestExpressApplication>(AvailabilityModule.register(() => availability), { logger: false });
    configureHttpBody(app);
    app.useGlobalFilters(new EnvelopeFilter());
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()) + '/v2';
  });
  afterEach(async () => { await app?.close(); });

  it('serves public area and slot reads and scopes the ops calendar and capacity', async () => {
    const areaId = await insertArea();
    const serviceId = await insertService(48);
    const bucketId = await insertBucket(areaId, '2026-10-26T04:30:00.000Z', '2026-10-26T05:30:00.000Z', 1);
    await provisionStaff(operatorPhone);
    const operator = await signin(operatorPhone);
    let bearer: string | undefined;
    const client = createV2Client({ baseUrl: base, getToken: () => bearer });

    expect(await client.checkServiceArea(postalCode)).toMatchObject({ id: areaId });
    const pairs = await client.listSlots({
      areaId, serviceIds: [serviceId], from: '2026-10-26T00:00:00.000Z', to: '2026-10-27T00:00:00.000Z',
    });
    expect(pairs[0]).toMatchObject({ available: true });

    const anonymous = await fetch(base + '/ops/availability/calendar');
    expect(anonymous.status).toBe(401);
    expect(v2.errorEnvelopeSchema.parse(await anonymous.json()).code).toBe('UNAUTHENTICATED');

    bearer = operator.accessToken;
    expect((await client.getOperationsCalendar({ areaId })).buckets).toHaveLength(1);
    const updated = await client.setCapacity({ bucketId, capacity: 2, expectedVersion: 1, reason: 'Add a van over HTTP' });
    expect(updated).toMatchObject({ capacity: 2, version: 2 });
    const stale = await fetch(base + '/ops/availability/capacity', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}`, 'idempotency-key': key() },
      body: JSON.stringify({ bucketId, capacity: 1, expectedVersion: 1, reason: 'Stale' }),
    });
    expect(stale.status).toBe(409);
    expect(stale.headers.get('cache-control')).toBe('no-store');
    expect(v2.errorEnvelopeSchema.parse(await stale.json())).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 2 });
  });
});
