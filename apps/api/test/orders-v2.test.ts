import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes, randomUUID } from 'node:crypto';
import { v2 } from '@laundry/contracts';
import { OrdersModule } from '../src/features/orders/orders.module';
import { configureHttpBody } from '../src/http-body';
import { EnvelopeFilter } from '../src/filters/http-exception.filter';
import { createV2Client } from '../../../packages/api-client/src/v2';
import { closePool, getPool, initializeDb } from '../../../modules/shared/src/db';
import { AvailabilityService } from '../../../modules/availability/src';
import { CatalogService } from '../../../modules/catalog/src';
import { OrdersService } from '../../../modules/orders/src';
import { IdentityService, type OtpDelivery } from '../../../modules/identity/src';

const customerPhone = '+919000070001';
const operatorPhone = '+919000070002';
const keys = { hashKey: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex') };
const key = () => randomUUID();
const postalCode = '560001';
let now: Date;
let identity: IdentityService;
let catalog: CatalogService;
let availability: AvailabilityService;
let orders: OrdersService;
let deliveries: { phone: string; code: string; challengeId: string }[];
const clock = () => now;
const TRUNCATE = `TRUNCATE orders_v2_quotes, orders_v2_orders, orders_v2_timeline, orders_v2_adjustments,
  availability_areas, availability_area_postal_codes, availability_buckets, availability_holds,
  catalog_services, catalog_garments, catalog_rate_cards,
  v2_command_results, v2_audit, v2_outbox, v2_inbox,
  identity_profiles, identity_otp_challenges, identity_rate_buckets, identity_session_families,
  identity_sessions, identity_command_results, identity_addresses, identity_audit,
  identity_staff, identity_staff_facilities, identity_staff_invitations, identity_staff_mfa,
  identity_staff_mfa_enrollments, identity_whatsapp_links CASCADE`;

const weekdays = [1, 2, 3, 4, 5, 6].map(dayOfWeek => ({ dayOfWeek, start: '09:00', end: '18:00' }));
const pickupWindow = { start: '2026-10-26T03:30:00.000Z', end: '2026-10-26T04:30:00.000Z', timezone: 'Asia/Kolkata' };
const laterWindow = { start: '2026-10-26T05:30:00.000Z', end: '2026-10-26T06:30:00.000Z', timezone: 'Asia/Kolkata' };

function nextTime(ms: number) { now = new Date(now.getTime() + ms); }

async function provisionStaff(phone: string, role = 'OPERATOR') {
  const id = randomUUID();
  await getPool().query('INSERT INTO identity_staff (id,phone,role,created_at) VALUES ($1,$2,$3,$4)', [id, phone, role, now]);
  return id;
}

async function assignFacility(staffId: string, facilityId: string) {
  await getPool().query('INSERT INTO identity_staff_facilities (staff_id,facility_id) VALUES ($1,$2)', [staffId, facilityId]);
}

async function signin(phone: string) {
  const challenge = await identity.requestOtp({ phone }, key(), 'test-peer');
  const delivery = deliveries.find(item => item.challengeId === challenge.challengeId)!;
  return identity.verifyOtp({ challengeId: challenge.challengeId, code: delivery.code }, key(), 'test-peer');
}

async function area(): Promise<string> {
  const id = randomUUID();
  await getPool().query(`INSERT INTO availability_areas
    (id,name,timezone,polygon,hours,slot_minutes,pickup_lead_minutes,booking_horizon_days,version,active,created_at,updated_at)
    VALUES ($1,'Synthetic area','Asia/Kolkata',$2,$3,60,0,14,1,true,$4,$4)`, [
    id,
    JSON.stringify([{ lat: 12.9, lng: 77.5 }, { lat: 13.0, lng: 77.5 }, { lat: 13.0, lng: 77.7 }]),
    JSON.stringify(weekdays), now,
  ]);
  await getPool().query('INSERT INTO availability_area_postal_codes (postal_code,area_id) VALUES ($1,$2)', [postalCode, id]);
  return id;
}

async function bucket(areaId: string, window: { start: string; end: string }, capacity = 1): Promise<string> {
  const id = randomUUID();
  await getPool().query(`INSERT INTO availability_buckets
    (id,facility_id,area_id,starts_at,ends_at,timezone,capacity,reserved,version,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,'Asia/Kolkata',$6,0,1,$7,$7)`, [
    id, randomUUID(), areaId, new Date(window.start), new Date(window.end), capacity, now,
  ]);
  return id;
}

async function service(): Promise<string> {
  const id = randomUUID();
  await getPool().query(`INSERT INTO catalog_services
    (id,version,code,name,description,image_url,billing_unit,turnaround_hours,features,care_exclusions,active,created_at,updated_at)
    VALUES ($1,1,'WASH_FOLD','Synthetic wash and fold','Synthetic','https://assets.example.test/service.png','KG',48,'[]','[]',true,$2,$2)`, [id, now]);
  return id;
}

async function approvedCard(): Promise<string> {
  const id = randomUUID();
  await getPool().query(`INSERT INTO catalog_rate_cards
    (id,version,service_codes,components,weight_increment_grams,minimum_billable_grams,rounding,effective_from,approved_at,activated_at,synthetic,created_at)
    VALUES ($1,1,$2,$3,500,1000,'CEIL','2026-10-01T00:00:00.000Z',$4,$4,true,$4)`, [
    id,
    JSON.stringify(['WASH_FOLD']),
    JSON.stringify([{ label: 'Synthetic per kg', kind: 'PER_KG', amountMinor: 4000, synthetic: true }]),
    now,
  ]);
  return id;
}

async function taxedCard(): Promise<string> {
  const id = randomUUID();
  await getPool().query(`INSERT INTO catalog_rate_cards
    (id,version,service_codes,components,weight_increment_grams,minimum_billable_grams,rounding,effective_from,approved_at,activated_at,synthetic,created_at)
    VALUES ($1,1,$2,$3,500,1000,'CEIL','2026-10-01T00:00:00.000Z',$4,$4,true,$4)`, [
    id,
    JSON.stringify(['WASH_FOLD']),
    JSON.stringify([
      { label: 'Synthetic per kg', kind: 'PER_KG', amountMinor: 4000, synthetic: true },
      { label: 'GST', kind: 'TAX', amountMinor: 500, synthetic: true },
    ]),
    now,
  ]);
  return id;
}

async function seedTaxed() {
  const areaId = await area();
  const bucketId = await bucket(areaId, pickupWindow);
  const serviceId = await service();
  await taxedCard();
  const customer = await signin(customerPhone);
  const addressId = await address(customer.actor.id);
  return { areaId, bucketId, serviceId, customer, addressId };
}

async function address(customerId: string): Promise<string> {
  const id = randomUUID();
  await getPool().query('INSERT INTO identity_addresses (id,owner_id,address,created_at,updated_at) VALUES ($1,$2,$3,$4,$4)', [
    id, customerId, JSON.stringify({
      label: 'Home', line1: '1 Synthetic Road', city: 'Bengaluru', postalCode,
      coordinates: { lat: 12.95, lng: 77.6 },
    }), now,
  ]);
  return id;
}

function quoteInput(serviceId: string, addressId: string, window = pickupWindow): v2.QuoteInput {
  return {
    addressId,
    lines: [{ serviceId, billingUnit: 'KG', estimatedWeightGrams: 1201 }],
    pickupWindow: window,
    requestedReturnBy: '2026-10-29T00:00:00.000Z',
    timezone: 'Asia/Kolkata',
  };
}

const reservedCount = async (bucketId: string) => (await getPool().query('SELECT reserved FROM availability_buckets WHERE id=$1', [bucketId])).rows[0].reserved as number;

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
  catalog = new CatalogService({ db: getPool(), authenticate: token => identity.authenticate(token), clock });
  availability = new AvailabilityService({ db: getPool(), authenticate: token => identity.authenticate(token), clock, holdMinutes: 5 });
  orders = new OrdersService({ db: getPool(), authenticate: token => identity.authenticate(token), catalog, availability, clock });
});
afterAll(closePool);

async function seed() {
  const areaId = await area();
  const bucketId = await bucket(areaId, pickupWindow);
  const serviceId = await service();
  await approvedCard();
  const customer = await signin(customerPhone);
  const addressId = await address(customer.actor.id);
  return { areaId, bucketId, serviceId, customer, addressId };
}

describe('B04 quotes and booking', () => {
  it('snapshots server prices and holds capacity for the quoted window', async () => {
    const { bucketId, serviceId, customer, addressId } = await seed();
    const quoted = await orders.createQuote(customer.accessToken, quoteInput(serviceId, addressId), key());

    expect(quoted).toMatchObject({
      version: 1,
      currency: 'INR',
      provisional: true,
      totalMinor: 6000,
      catalogVersion: 1,
      addressSnapshotId: addressId,
    });
    expect(quoted.lines[0]).toMatchObject({ estimatedWeightGrams: 1201, unitPriceMinor: 4000, lineTotalMinor: 6000, provisional: true });
    expect(quoted.promisedReturnWindow).toMatchObject({ start: '2026-10-28T04:30:00.000Z', timezone: 'Asia/Kolkata' });
    expect(quoted.holdReference).toBeDefined();
    expect(quoted.expiresAt).toBe(quoted.holdExpiresAt);
    expect(await reservedCount(bucketId)).toBe(1);
    expect(v2.quoteSchema.parse(quoted)).toEqual(quoted);
  });

  it('creates one order and one reservation after an identical retry', async () => {
    const { bucketId, serviceId, customer, addressId } = await seed();
    const bookingKey = key();
    const quoted = await orders.createQuote(customer.accessToken, quoteInput(serviceId, addressId), key());

    const first = await orders.bookOrder(customer.accessToken, { quoteId: quoted.id, expectedVersion: 1, paymentModel: 'DUE_AT_RETURN' }, bookingKey);
    const replay = await orders.bookOrder(customer.accessToken, { quoteId: quoted.id, expectedVersion: 1, paymentModel: 'DUE_AT_RETURN' }, bookingKey);

    expect(replay.id).toBe(first.id);
    expect(first).toMatchObject({ status: 'CONFIRMED', totalMinor: 6000, paymentModel: 'DUE_AT_RETURN', permittedActions: ['REQUEST_CANCEL'] });
    expect(first.timeline).toEqual([{ status: 'CONFIRMED', label: 'Order confirmed', at: now.toISOString() }]);
    expect((await getPool().query('SELECT count(*)::int AS n FROM orders_v2_orders')).rows[0].n).toBe(1);
    expect((await getPool().query("SELECT count(*)::int AS n FROM availability_holds WHERE status='RESERVED'")).rows[0].n).toBe(1);
    expect(await reservedCount(bucketId)).toBe(1);

    await expect(orders.bookOrder(customer.accessToken, { quoteId: quoted.id, expectedVersion: 1, paymentModel: 'DUE_AT_RETURN' }, key()))
      .rejects.toMatchObject({ code: 'QUOTE_EXPIRED' });
  });

  it('refuses an expired quote, a stale quote version and an unpublished window', async () => {
    const { serviceId, customer, addressId } = await seed();
    const quoted = await orders.createQuote(customer.accessToken, quoteInput(serviceId, addressId), key());
    await expect(orders.bookOrder(customer.accessToken, { quoteId: quoted.id, expectedVersion: 2, paymentModel: 'DUE_AT_RETURN' }, key()))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' });

    nextTime(6 * 60_000);
    await expect(orders.bookOrder(customer.accessToken, { quoteId: quoted.id, expectedVersion: 1, paymentModel: 'DUE_AT_RETURN' }, key()))
      .rejects.toMatchObject({ code: 'QUOTE_EXPIRED' });

    await expect(orders.createQuote(customer.accessToken, quoteInput(serviceId, addressId, {
      start: '2026-10-26T09:00:00.000Z', end: '2026-10-26T10:00:00.000Z', timezone: 'Asia/Kolkata',
    }), key())).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    await expect(orders.createQuote(customer.accessToken, quoteInput(serviceId, randomUUID()), key()))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns the original quote when the same key is replayed after capacity is taken', async () => {
    const { serviceId, customer, addressId } = await seed();
    const quoteKey = key();
    const first = await orders.createQuote(customer.accessToken, quoteInput(serviceId, addressId), quoteKey);
    const replay = await orders.createQuote(customer.accessToken, quoteInput(serviceId, addressId), quoteKey);
    expect(replay.id).toBe(first.id);
    expect((await getPool().query('SELECT count(*)::int AS n FROM availability_holds')).rows[0].n).toBe(1);
    expect((await getPool().query('SELECT count(*)::int AS n FROM orders_v2_quotes')).rows[0].n).toBe(1);
  });
});

describe('B04 measured intake, adjustments and care', () => {
  async function booked() {
    const seeded = await seed();
    await provisionStaff(operatorPhone);
    const operator = await signin(operatorPhone);
    const quoted = await orders.createQuote(seeded.customer.accessToken, quoteInput(seeded.serviceId, seeded.addressId), key());
    const booked = await orders.bookOrder(seeded.customer.accessToken, { quoteId: quoted.id, expectedVersion: 1, paymentModel: 'DUE_AT_RETURN' }, key());
    const order = await orders.markPickupPending(operator.accessToken, booked.id);
    return { ...seeded, order, operator };
  }

  it('proposes the measured difference and blocks care until it is accepted', async () => {
    const { customer, order, operator } = await booked();

    const intake = await orders.recordIntake(operator.accessToken, order.id, {
      expectedVersion: order.version,
      lines: [{ orderLineId: order.lines[0].orderLineId, measuredWeightGrams: 2400, condition: 'GOOD' }],
      containers: [{ id: randomUUID(), sealed: true, condition: 'GOOD', garmentCount: 12 }],
      mediaIds: [],
    }, key());

    expect(intake).toMatchObject({ status: 'AWAITING_ADJUSTMENT', totalMinor: 6000 });
    expect(intake.adjustment).toMatchObject({ state: 'PROPOSED', previousTotalMinor: 6000, newTotalMinor: 10000, deltaMinor: 4000 });
    expect(intake.permittedActions).toEqual(['ACCEPT_ADJUSTMENT', 'DECLINE_ADJUSTMENT', 'REQUEST_CANCEL']);

    // The proposal moved the order to AWAITING_ADJUSTMENT, so care is not an
    // available transition until the customer decides.
    await expect(orders.recordCare(operator.accessToken, order.id, { expectedVersion: intake.version, target: 'IN_CARE' }, key()))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });

    const accepted = await orders.decideAdjustment(customer.accessToken, order.id, {
      adjustmentId: intake.adjustment!.id,
      adjustmentVersion: 1,
      expectedVersion: intake.version,
      decision: 'ACCEPT',
    }, key());
    expect(accepted).toMatchObject({ status: 'AT_FACILITY', totalMinor: 10000 });
    expect(accepted.adjustment).toMatchObject({ state: 'ACCEPTED' });
    expect(accepted.adjustment?.decidedAt).toBeDefined();
    expect(accepted.adjustment?.version).toBe(2);

    const care = await orders.recordCare(operator.accessToken, order.id, { expectedVersion: accepted.version, target: 'IN_CARE' }, key());
    expect(care.status).toBe('IN_CARE');
  });

  it('never invents a charge when the measured weight is lower', async () => {
    const { order, operator } = await booked();

    const lighter = await orders.recordIntake(operator.accessToken, order.id, {
      expectedVersion: order.version,
      lines: [{ orderLineId: order.lines[0].orderLineId, measuredWeightGrams: 500, condition: 'GOOD' }],
      containers: [{ id: randomUUID(), sealed: true, condition: 'GOOD', garmentCount: 3 }],
      mediaIds: [],
    }, key());
    expect(lighter).toMatchObject({ status: 'AT_FACILITY', totalMinor: 4000 });
    expect(lighter.adjustment).toBeUndefined();
    expect(lighter.timeline.at(-1)?.label).toBe('Measured intake recorded');

    const care = await orders.recordCare(operator.accessToken, order.id, { expectedVersion: lighter.version, target: 'IN_CARE' }, key());
    expect(care.status).toBe('IN_CARE');
  });

  it('declines into a hold without charging the measured difference', async () => {
    const { customer, order, operator } = await booked();

    const heavier = await orders.recordIntake(operator.accessToken, order.id, {
      expectedVersion: order.version,
      lines: [{ orderLineId: order.lines[0].orderLineId, measuredWeightGrams: 2400, condition: 'GOOD' }],
      containers: [{ id: randomUUID(), sealed: true, condition: 'GOOD', garmentCount: 12 }],
      mediaIds: [],
    }, key());
    expect(heavier).toMatchObject({ status: 'AWAITING_ADJUSTMENT', totalMinor: 6000 });
    expect(heavier.adjustment).toMatchObject({ previousTotalMinor: 6000, newTotalMinor: 10000 });

    const declined = await orders.decideAdjustment(customer.accessToken, order.id, {
      adjustmentId: heavier.adjustment!.id,
      adjustmentVersion: 1,
      expectedVersion: heavier.version,
      decision: 'DECLINE',
    }, key());
    expect(declined).toMatchObject({ status: 'ON_HOLD', totalMinor: 6000 });
    expect(declined.adjustment).toMatchObject({ state: 'DECLINED' });
    await expect(orders.recordCare(operator.accessToken, order.id, { expectedVersion: declined.version, target: 'IN_CARE' }, key()))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });

    // The refused proposal is history, not pending consent: once the order
    // resumes at the quoted price, care can start.
    const resumed = await orders.resolveException(operator.accessToken, order.id, {
      expectedVersion: declined.version, action: 'RESUME', reason: 'Customer accepted the quoted price',
    }, key());
    expect(resumed).toMatchObject({ status: 'AT_FACILITY', totalMinor: 6000 });
    const care = await orders.recordCare(operator.accessToken, order.id, { expectedVersion: resumed.version, target: 'IN_CARE' }, key());
    expect(care.status).toBe('IN_CARE');
  });

  it('expires an unanswered adjustment into a hold exactly once', async () => {
    const { customer, order, operator } = await booked();
    await orders.recordIntake(operator.accessToken, order.id, {
      expectedVersion: order.version,
      lines: [{ orderLineId: order.lines[0].orderLineId, measuredWeightGrams: 2400, condition: 'GOOD' }],
      containers: [{ id: randomUUID(), sealed: true, condition: 'GOOD', garmentCount: 12 }],
      mediaIds: [],
    }, key());

    nextTime(31 * 60_000);
    const renewedCustomer = await signin(customerPhone);
    const renewedOperator = await signin(operatorPhone);
    expect(await orders.expireAdjustments()).toBe(1);
    expect(await orders.expireAdjustments()).toBe(0);
    expect((await getPool().query("SELECT count(*)::int AS n FROM v2_audit WHERE action='ADJUSTMENT_EXPIRED'")).rows[0].n).toBe(1);
    const view = await orders.getOrder(renewedCustomer.accessToken, order.id);
    expect(view).toMatchObject({ status: 'ON_HOLD', totalMinor: 6000 });
    expect(view.adjustment).toMatchObject({ state: 'EXPIRED' });
    expect(view.timeline.at(-1)).toMatchObject({ status: 'ON_HOLD', label: 'Adjustment expired unanswered' });

    const resumed = await orders.resolveException(renewedOperator.accessToken, order.id, { expectedVersion: view.version, action: 'RESUME', reason: 'Customer approved by phone' }, key());
    expect(resumed.status).toBe('AT_FACILITY');
  });
});

describe('B04 cancellation and reschedule', () => {
  it('releases capacity once before pickup and preserves the record after it', async () => {
    const { bucketId, serviceId, customer, addressId } = await seed();
    await provisionStaff(operatorPhone);
    const operator = await signin(operatorPhone);
    const quoted = await orders.createQuote(customer.accessToken, quoteInput(serviceId, addressId), key());
    const order = await orders.bookOrder(customer.accessToken, { quoteId: quoted.id, expectedVersion: 1, paymentModel: 'DUE_AT_RETURN' }, key());

    const cancelKey = key();
    const cancelled = await orders.cancel(customer.accessToken, order.id, { expectedVersion: 1, reason: 'Change of plans' }, cancelKey);
    expect(cancelled.status).toBe('CANCELLED');
    expect(await reservedCount(bucketId)).toBe(0);
    const replay = await orders.cancel(customer.accessToken, order.id, { expectedVersion: 1, reason: 'Change of plans' }, cancelKey);
    expect(replay.status).toBe('CANCELLED');
    expect(await reservedCount(bucketId)).toBe(0);
    expect(cancelled.timeline.map(event => event.label)).toEqual(['Order confirmed', 'Order cancelled']);

    const second = await orders.createQuote(customer.accessToken, quoteInput(serviceId, addressId), key());
    const live = await orders.bookOrder(customer.accessToken, { quoteId: second.id, expectedVersion: 1, paymentModel: 'DUE_AT_RETURN' }, key());
    const pickedUp = await orders.markPickupPending(operator.accessToken, live.id);
    const intake = await orders.recordIntake(operator.accessToken, live.id, {
      expectedVersion: pickedUp.version,
      lines: [{ orderLineId: live.lines[0].orderLineId, measuredWeightGrams: 1201, condition: 'GOOD' }],
      containers: [{ id: randomUUID(), sealed: true, condition: 'GOOD', garmentCount: 6 }],
      mediaIds: [],
    }, key());
    const requested = await orders.cancel(customer.accessToken, live.id, { expectedVersion: intake.version, reason: 'Picked up already' }, key());
    expect(requested.status).toBe('CANCEL_REQUESTED');
    expect(await reservedCount(bucketId)).toBe(0);
    await expect(orders.cancel(customer.accessToken, live.id, { expectedVersion: intake.version, reason: 'Stale' }, key()))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('moves the reservation to the replacement window and keeps the old timeline', async () => {
    const { areaId, bucketId, serviceId, customer, addressId } = await seed();
    const laterBucket = await bucket(areaId, laterWindow);
    const quoted = await orders.createQuote(customer.accessToken, quoteInput(serviceId, addressId), key());
    const order = await orders.bookOrder(customer.accessToken, { quoteId: quoted.id, expectedVersion: 1, paymentModel: 'DUE_AT_RETURN' }, key());

    const replacement = await orders.createQuote(customer.accessToken, quoteInput(serviceId, addressId, laterWindow), key());
    const moved = await orders.reschedule(customer.accessToken, order.id, {
      expectedVersion: 1, newQuoteId: replacement.id, quoteVersion: 1,
    }, key());

    expect(moved).toMatchObject({ status: 'CONFIRMED', pickupWindow: laterWindow });
    expect(await reservedCount(bucketId)).toBe(0);
    expect(await reservedCount(laterBucket)).toBe(1);
    expect(moved.timeline.map(event => event.label)).toEqual(['Order confirmed', 'Order rescheduled']);
    expect((await getPool().query('SELECT status FROM orders_v2_quotes WHERE id=$1', [quoted.id])).rows[0].status).toBe('EXPIRED');
  });
});

describe('B04 quality checks, evidence and access boundaries', () => {
  async function live() {
    const seeded = await seed();
    await provisionStaff(operatorPhone);
    const operator = await signin(operatorPhone);
    const quoted = await orders.createQuote(seeded.customer.accessToken, quoteInput(seeded.serviceId, seeded.addressId), key());
    const bookedOrder = await orders.bookOrder(seeded.customer.accessToken, { quoteId: quoted.id, expectedVersion: 1, paymentModel: 'DUE_AT_RETURN' }, key());
    const order = await orders.markPickupPending(operator.accessToken, bookedOrder.id);
    return { ...seeded, order, operator };
  }

  async function qualityCheckStage() {
    const seeded = await live();
    const intake = await orders.recordIntake(seeded.operator.accessToken, seeded.order.id, {
      expectedVersion: seeded.order.version,
      lines: [{ orderLineId: seeded.order.lines[0].orderLineId, measuredWeightGrams: 1201, condition: 'GOOD' }],
      containers: [{ id: randomUUID(), sealed: true, condition: 'GOOD' as const, garmentCount: 6 }],
      mediaIds: [],
    }, key());
    const care = await orders.recordCare(seeded.operator.accessToken, seeded.order.id, { expectedVersion: intake.version, target: 'IN_CARE' }, key());
    const checking = await orders.recordCare(seeded.operator.accessToken, seeded.order.id, { expectedVersion: care.version, target: 'QUALITY_CHECK' }, key());
    return { ...seeded, checking };
  }

  it('passes a quality check into return-ready', async () => {
    const { operator, order, checking } = await qualityCheckStage();
    const passed = await orders.recordQualityCheck(operator.accessToken, order.id, {
      expectedVersion: checking.version,
      passed: true,
      containers: [{ id: randomUUID(), sealed: true, condition: 'GOOD', garmentCount: 6 }],
      mediaIds: [],
    }, key());
    expect(passed.status).toBe('READY_FOR_RETURN');
    expect(passed.timeline.at(-1)).toMatchObject({ status: 'READY_FOR_RETURN', label: 'Quality check passed' });
  });

  it('sends a failed quality check back to care with the reason recorded', async () => {
    const { operator, order, checking } = await qualityCheckStage();
    const rework = await orders.recordQualityCheck(operator.accessToken, order.id, {
      expectedVersion: checking.version,
      passed: false,
      note: 'Stains remain on two shirts',
      containers: [{ id: randomUUID(), sealed: false, condition: 'GOOD', garmentCount: 6 }],
      mediaIds: [],
    }, key());
    expect(rework.status).toBe('IN_CARE');
    const trail = await orders.getTimeline(operator.accessToken, order.id);
    expect(trail.at(-1)).toMatchObject({ label: 'Quality check failed', reason: 'Stains remain on two shirts' });
  });

  it('keeps another customer and another facility out of an order', async () => {
    const { customer, order, operator } = await live();
    expect(order.facilityId).toBeDefined();

    const stranger = await signin('+919000070009');
    await expect(orders.getOrder(stranger.accessToken, order.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await orders.listOrders(stranger.accessToken)).items).toEqual([]);

    const staffId = await provisionStaff('+919000070010', 'FACILITY');
    await assignFacility(staffId, randomUUID());
    const otherFacility = await signin('+919000070010');
    await expect(orders.recordIntake(otherFacility.accessToken, order.id, {
      expectedVersion: order.version,
      lines: [{ orderLineId: order.lines[0].orderLineId, measuredWeightGrams: 1201, condition: 'GOOD' }],
      containers: [{ id: randomUUID(), sealed: true, condition: 'GOOD', garmentCount: 6 }],
      mediaIds: [],
    }, key())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await orders.opsQueue(otherFacility.accessToken)).items).toEqual([]);
    expect((await orders.opsQueue(operator.accessToken)).items.map(item => item.id)).toEqual([order.id]);
    void customer;
  });

  it('refuses a reused key whose payload changed', async () => {
    const { serviceId, customer, addressId } = await seed();
    const quoteKey = key();
    await orders.createQuote(customer.accessToken, quoteInput(serviceId, addressId), quoteKey);
    await expect(orders.createQuote(customer.accessToken, {
      ...quoteInput(serviceId, addressId),
      lines: [{ serviceId, billingUnit: 'KG', estimatedWeightGrams: 5000 }],
    }, quoteKey)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect((await getPool().query('SELECT count(*)::int AS n FROM orders_v2_quotes')).rows[0].n).toBe(1);
  });

  it('charges a flat tax once for a basket that shares one rate card', async () => {
    const { serviceId, customer, addressId } = await seedTaxed();
    const quoted = await orders.createQuote(customer.accessToken, {
      addressId,
      lines: [
        { serviceId, billingUnit: 'KG', estimatedWeightGrams: 1201 },
        { serviceId, billingUnit: 'KG', estimatedWeightGrams: 1201 },
      ],
      pickupWindow,
      requestedReturnBy: '2026-10-29T00:00:00.000Z',
      timezone: 'Asia/Kolkata',
    }, key());
    expect(quoted.totalMinor).toBe(12_500);
    expect(quoted.breakdown.filter(component => component.kind === 'TAX')).toHaveLength(1);
  });

  it('refuses a reschedule with a stale quote version or after intake', async () => {
    const { areaId, serviceId, customer, addressId } = await seed();
    const laterBucket = await bucket(areaId, laterWindow);
    await provisionStaff(operatorPhone);
    const operator = await signin(operatorPhone);
    const quoted = await orders.createQuote(customer.accessToken, quoteInput(serviceId, addressId), key());
    const order = await orders.bookOrder(customer.accessToken, { quoteId: quoted.id, expectedVersion: 1, paymentModel: 'DUE_AT_RETURN' }, key());
    const replacement = await orders.createQuote(customer.accessToken, quoteInput(serviceId, addressId, laterWindow), key());

    await expect(orders.reschedule(customer.accessToken, order.id, {
      expectedVersion: order.version, newQuoteId: replacement.id, quoteVersion: 2,
    }, key())).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });

    const pickedUp = await orders.markPickupPending(operator.accessToken, order.id);
    const intake = await orders.recordIntake(operator.accessToken, order.id, {
      expectedVersion: pickedUp.version,
      lines: [{ orderLineId: order.lines[0].orderLineId, measuredWeightGrams: 1201, condition: 'GOOD' }],
      containers: [{ id: randomUUID(), sealed: true, condition: 'GOOD', garmentCount: 6 }],
      mediaIds: [],
    }, key());
    await expect(orders.reschedule(customer.accessToken, order.id, {
      expectedVersion: intake.version, newQuoteId: replacement.id, quoteVersion: 1,
    }, key())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await reservedCount(laterBucket)).toBe(1);
  });

  it('rejects a cursor that does not carry a uuid', async () => {
    const { customer } = await seed();
    const cursor = Buffer.from('2026-10-26T02:00:00.000Z|not-a-uuid').toString('base64url');
    await expect(orders.listOrders(customer.accessToken, { cursor })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('stops a cancellation at CANCEL_REQUESTED while an unverified obligation exists', async () => {
    const { bucketId, serviceId, customer, addressId } = await seed();
    const quoted = await orders.createQuote(customer.accessToken, quoteInput(serviceId, addressId), key());
    const order = await orders.bookOrder(customer.accessToken, { quoteId: quoted.id, expectedVersion: 1, paymentModel: 'DUE_AT_RETURN' }, key());
    const blocking = new OrdersService({
      db: getPool(),
      authenticate: token => identity.authenticate(token),
      catalog,
      availability,
      clock,
      reconciliation: { async activeAssignment() { return true; }, async openObligation() { return false; } },
    });

    const requested = await blocking.cancel(customer.accessToken, order.id, { expectedVersion: order.version, reason: 'Change of plans' }, key());
    expect(requested.status).toBe('CANCEL_REQUESTED');
    expect(requested.permittedActions).toEqual([]);
    expect(await reservedCount(bucketId)).toBe(0);
    await expect(blocking.confirmCancellationBy(customer.actor, order.id, 'Reconciled with logistics'))
      .rejects.toMatchObject({ code: 'REQUIRES_APPROVAL' });
  });
});

describe('B04 orders through the real SDK over HTTP', () => {
  let app: NestExpressApplication;
  let base: string;
  beforeEach(async () => {
    app = await NestFactory.create<NestExpressApplication>(OrdersModule.register(() => orders), { logger: false });
    configureHttpBody(app);
    app.useGlobalFilters(new EnvelopeFilter());
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()) + '/v2';
  });
  afterEach(async () => { await app?.close(); });

  it('serves the quote, booking, list and timeline with contract envelopes', async () => {
    const { serviceId, customer, addressId } = await seed();
    await provisionStaff(operatorPhone);
    const operator = await signin(operatorPhone);
    let bearer: string | undefined = customer.accessToken;
    const client = createV2Client({ baseUrl: base, getToken: () => bearer });

    const quoted = await client.createQuote(quoteInput(serviceId, addressId));
    const booked = await client.bookOrder({ quoteId: quoted.id, expectedVersion: 1, paymentModel: 'DUE_AT_RETURN' });
    expect((await client.listOrders()).items.map(item => item.id)).toEqual([booked.id]);
    expect(await client.getOrderTimeline(booked.id)).toHaveLength(1);

    bearer = operator.accessToken;
    expect((await client.listOpsOrders()).items.map(item => item.id)).toEqual([booked.id]);

    bearer = customer.accessToken;
    const anonymous = await fetch(base + `/orders/${booked.id}`);
    expect(anonymous.status).toBe(401);
    expect(v2.errorEnvelopeSchema.parse(await anonymous.json()).code).toBe('UNAUTHENTICATED');

    const forbidden = await fetch(base + `/ops/orders/queue`, { headers: { authorization: `Bearer ${bearer}` } });
    expect(forbidden.status).toBe(403);
    expect(v2.errorEnvelopeSchema.parse(await forbidden.json()).code).toBe('FORBIDDEN');
  });
});
