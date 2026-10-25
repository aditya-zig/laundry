import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { ReviewsService } from '../../../modules/reviews/src';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { v2 } from '@laundry/contracts';
import { BillingService, createObligationForOrder } from '../../../modules/billing/src';
import { completeReturnWhenSettled } from '../../../modules/orders/src/completion';
import { LogisticsV2Module } from '../src/features/logistics-v2/logistics.module';
import { configureHttpBody } from '../src/http-body';
import { EnvelopeFilter } from '../src/filters/http-exception.filter';
import { closePool, getPool, initializeDb } from '../../../modules/shared/src/db';
import { IdentityService, type OtpDelivery } from '../../../modules/identity/src';
import {
  FakeDistanceEtaCalculator,
  HmacLogisticsProviderVerifier,
  LogisticsService,
  RecordingCustodyCodeNotifier,
  createFakeAutoAssignmentPort,
} from '../../../modules/logistics/src';

const customerPhone = '+919000080001';
const otherCustomerPhone = '+919000080002';
const operatorPhone = '+919000080003';
const riderOnePhone = '+919000080004';
const riderTwoPhone = '+919000080005';
const keys = { hashKey: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex') };
const verifierSecret = 'b06-test-provider-signature-secret';
const key = () => randomUUID();
const pickupWindow = { start: '2026-10-26T03:30:00.000Z', end: '2026-10-26T04:30:00.000Z', timezone: 'Asia/Kolkata' };
const returnWindow = { start: '2026-10-28T04:30:00.000Z', end: '2026-10-28T05:30:00.000Z', timezone: 'Asia/Kolkata' };
const proposalPath = join(__dirname, '../../../modules/schema/proposals/B06.sql');

let now: Date;
let identity: IdentityService;
let logistics: LogisticsService;
let notifier: RecordingCustodyCodeNotifier;
let verifier: HmacLogisticsProviderVerifier;
let deliveries: { phone: string; code: string; challengeId: string }[];
const clock = () => now;

// Only proposal-owned tables are dropped, because orders_v2_orders comes from
// the canonical migration sequence and the proposal adds foreign keys to it.
const PROPOSAL_TABLES = `logistics_handovers, logistics_positions, logistics_provider_events,
  logistics_assignment_events, logistics_assignments, logistics_leg_attempts`;

const TABLES = `${PROPOSAL_TABLES},
  orders_v2_timeline, orders_v2_adjustments, orders_v2_orders, orders_v2_quotes,
  v2_command_results, v2_audit, v2_outbox, v2_inbox,
  identity_profiles, identity_otp_challenges, identity_rate_buckets, identity_session_families,
  identity_sessions, identity_command_results, identity_addresses, identity_audit,
  identity_staff, identity_staff_facilities, identity_staff_invitations, identity_staff_mfa,
  identity_staff_mfa_enrollments, identity_whatsapp_links`;

function nextTime(ms: number) { now = new Date(now.getTime() + ms); }

async function provisionStaff(phone: string, role = 'OPERATOR') {
  await getPool().query('INSERT INTO identity_staff (id,phone,role,created_at) VALUES ($1,$2,$3,$4)', [randomUUID(), phone, role, now]);
}

async function signin(phone: string) {
  const challenge = await identity.requestOtp({ phone }, key(), 'test-peer');
  const delivery = deliveries.find(item => item.challengeId === challenge.challengeId)!;
  return identity.verifyOtp({ challengeId: challenge.challengeId, code: delivery.code }, key(), 'test-peer');
}

async function rider(phone: string): Promise<{ token: string; id: string }> {
  await provisionStaff(phone, 'RIDER');
  const session = await signin(phone);
  return { token: session.accessToken, id: session.actor.id };
}

/** Orders are seeded with SQL. The B06 suite never calls OrdersService. */
async function seedOrder(options: {
  customerId: string;
  status?: v2.OrderStatus;
  measured?: boolean;
  qualityPassed?: boolean;
  facilityId?: string;
}): Promise<string> {
  const quoteId = randomUUID();
  const lines = [{
    serviceId: randomUUID(),
    billingUnit: 'KG',
    estimatedWeightGrams: 1201,
    declaredGarmentCount: 6,
    unitPriceMinor: 4000,
    lineTotalMinor: 6000,
    provisional: true,
  }];
  const containers = [
    { id: randomUUID(), sealed: true, condition: 'GOOD', garmentCount: 5 },
    { id: randomUUID(), sealed: false, condition: 'GOOD', garmentCount: 1 },
  ];
  await getPool().query(`INSERT INTO orders_v2_quotes
    (id,version,customer_id,status,area_id,address_id,address_snapshot,lines,rate_cards,breakdown,
     total_minor,currency,provisional,pickup_window,return_window,hold_reference,hold_expires_at,
     catalog_version,expires_at,created_at)
    VALUES ($1,1,$2,'BOOKED',$3,$4,$5,$6,'[]'::jsonb,'[]'::jsonb,6000,'INR',true,$7,$8,NULL,NULL,1,$9,$9)`, [
    quoteId, options.customerId, randomUUID(), randomUUID(),
    JSON.stringify({ label: 'Home', line1: '1 Synthetic Road', city: 'Bengaluru', postalCode: '560001', coordinates: { lat: 12.95, lng: 77.6 } }),
    JSON.stringify(lines), JSON.stringify(pickupWindow), JSON.stringify(returnWindow), now,
  ]);
  const orderId = randomUUID();
  await getPool().query(`INSERT INTO orders_v2_orders
    (id,version,status,customer_id,facility_id,quote_id,area_id,address_snapshot,lines,rate_cards,
     containers,measured_lines,total_minor,currency,payment_model,pickup_window,return_window,hold_id,
     resume_status,quality_check_passed,created_at,updated_at)
    VALUES ($1,3,$2,$3,$4,$5,$6,$7,$8,'[]'::jsonb,$9,$10,6000,'INR','DUE_AT_RETURN',$11,$12,NULL,NULL,$13,$14,$14)`, [
    orderId, options.status ?? 'CONFIRMED', options.customerId, options.facilityId ?? null, quoteId, randomUUID(),
    JSON.stringify({ label: 'Home', line1: '1 Synthetic Road', city: 'Bengaluru', postalCode: '560001', coordinates: { lat: 12.95, lng: 77.6 } }),
    JSON.stringify(lines), JSON.stringify(containers),
    options.measured === true ? JSON.stringify([{ orderLineId: randomUUID(), measuredWeightGrams: 1201, countedQuantity: 6, condition: 'GOOD' }]) : null,
    JSON.stringify(pickupWindow), JSON.stringify(returnWindow), options.qualityPassed ?? false, now,
  ]);
  return orderId;
}

const activeAssignments = async (orderId: string) => (await getPool().query(
  'SELECT count(*)::int AS n FROM logistics_assignments WHERE order_id=$1 AND released_at IS NULL AND cancelled_at IS NULL',
  [orderId])).rows[0].n as number;

async function handoverInput(job: v2.RiderJob, code: string, actionId = randomUUID()): Promise<v2.RiderHandover> {
  return {
    jobId: job.id,
    legAttemptId: job.id,
    expectedVersion: job.version,
    actionId,
    method: 'CODE',
    code,
    capturedAt: now.toISOString(),
    containerIds: job.containerIds,
    garmentCount: 6,
    condition: 'GOOD',
  };
}

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/laundry_verify_')) {
    throw new Error('Disposable local PostgreSQL required');
  }
  await initializeDb();
  await getPool().query(`DROP TABLE IF EXISTS ${PROPOSAL_TABLES} CASCADE`);
  await getPool().query(readFileSync(proposalPath, 'utf8'));
});

beforeEach(async () => {
  await getPool().query(`TRUNCATE ${TABLES} CASCADE`);
  now = new Date('2026-10-26T02:00:00Z');
  deliveries = [];
  notifier = new RecordingCustodyCodeNotifier();
  verifier = new HmacLogisticsProviderVerifier(verifierSecret);
  const provider: OtpDelivery = { mode: 'FAKE', async send(input) { deliveries.push(input); return { reference: `fake-${input.challengeId}` }; } };
  identity = new IdentityService({ db: getPool(), provider, ...keys, clock });
  logistics = new LogisticsService({
    db: getPool(),
    authenticate: token => identity.authenticate(token),
    clock,
    // Shorter code lifetime keeps the expiry scenario inside the 15-minute
    // access-token window of the test identity service.
    custodyCodeMinutes: 5,
    custodyCodeSecret: 'b06-test-custody-code-secret',
    custodyNotifier: notifier,
    verifier,
  });
});

afterAll(closePool);

async function actors() {
  const customer = await signin(customerPhone);
  await provisionStaff(operatorPhone);
  const operator = await signin(operatorPhone);
  const riderOne = await rider(riderOnePhone);
  const riderTwo = await rider(riderTwoPhone);
  return { customer, operator, riderOne, riderTwo };
}

async function assignedPickup() {
  const who = await actors();
  const orderId = await seedOrder({ customerId: who.customer.actor.id });
  const attempt = await logistics.openLegAttempt(orderId, 'PICKUP', { scheduledWindow: v2.windowSchema.parse(pickupWindow) });
  const assignment = await logistics.assign(who.operator.accessToken, {
    legAttemptId: attempt.id, riderId: who.riderOne.id, expectedVersion: attempt.version, reason: 'Nearest rider',
  }, key());
  return { ...who, orderId, attempt, assignment };
}

describe('composed custody and final settlement', () => {
  async function preparedReturn() {
    const who = await actors();
    logistics = new LogisticsService({ db: getPool(), authenticate: token => identity.authenticate(token), clock,
      custodyCodeSecret: 'b06-test-custody-code-secret', custodyNotifier: notifier,
      onReturnAccepted: (orderId, tx, context) => completeReturnWhenSettled(tx, orderId, context),
    });
    const billing = new BillingService({ db: getPool(), authenticate: token => identity.authenticate(token), clock,
      onSettled: (orderId, tx, context) => completeReturnWhenSettled(tx, orderId, context),
    });
    const orderId = await seedOrder({ customerId: who.customer.actor.id, status: 'READY_FOR_RETURN', measured: true, qualityPassed: true });
    const obligation = await createObligationForOrder(getPool(), { orderId, clock });
    const attempt = await logistics.openLegAttempt(orderId, 'RETURN', { scheduledWindow: returnWindow });
    await logistics.assign(who.operator.accessToken, { legAttemptId: attempt.id, riderId: who.riderOne.id,
      expectedVersion: attempt.version, reason: 'Composed return test' }, key());
    const job = await logistics.getRiderJob(who.riderOne.token, attempt.id);
    const body = await handoverInput(job, notifier.latest()!.code);
    const settleInput: v2.ManualPaymentConfirmation = { method: 'CASH', currency: 'INR', amountMinor: 6000, expectedVersion: obligation.version, reason: 'Cash received at return' };
    return { ...who, billing, orderId, obligation, attempt, job, body, settleInput };
  }
  async function status(orderId: string) { return (await getPool().query('SELECT status FROM orders_v2_orders WHERE id=$1', [orderId])).rows[0].status; }

  it.each(['custody-first', 'payment-first'] as const)('delivers once when both facts arrive: %s', async order => {
    const p = await preparedReturn();
    const custodyKey = key(), receiptKey = key();
    const custody = () => logistics.recordHandover(p.riderOne.token, p.body, custodyKey);
    const settle = () => p.billing.confirmManual(p.operator.accessToken, p.obligation.id, p.settleInput, receiptKey);
    if (order === 'custody-first') { await custody(); expect(await status(p.orderId)).toBe('RETURNING'); await settle(); }
    else { await settle(); expect(await status(p.orderId)).toBe('READY_FOR_RETURN'); await custody(); }
    expect(await status(p.orderId)).toBe('DELIVERED');
    await Promise.all([custody(), settle()]);
    expect((await getPool().query("SELECT count(*)::int n FROM orders_v2_timeline WHERE order_id=$1 AND status='DELIVERED'", [p.orderId])).rows[0].n).toBe(1);
    const events = (await getPool().query("SELECT envelope FROM v2_outbox WHERE aggregate_id=$1 AND event_type='order.delivered.v2'", [p.orderId])).rows;
    expect(events).toHaveLength(1);
    expect(v2.domainEventSchema.parse(events[0].envelope).eventType).toBe('order.delivered.v2');
  });

  it('does not mistake a partial receipt for final settlement', async () => {
    const p = await preparedReturn();
    await logistics.recordHandover(p.riderOne.token, p.body, key());
    await p.billing.confirmManual(p.operator.accessToken, p.obligation.id, { ...p.settleInput, amountMinor: 1000 }, key());
    expect(await status(p.orderId)).toBe('RETURNING');
    const current = (await getPool().query('SELECT version FROM billing_obligations WHERE id=$1', [p.obligation.id])).rows[0];
    await p.billing.confirmManual(p.operator.accessToken, p.obligation.id, { ...p.settleInput, amountMinor: 5000, expectedVersion: current.version }, key());
    expect(await status(p.orderId)).toBe('DELIVERED');
  });

  it('serializes simultaneous custody and settlement without duplicate delivery', async () => {
    const p = await preparedReturn();
    await Promise.all([logistics.recordHandover(p.riderOne.token, p.body, key()),
      p.billing.confirmManual(p.operator.accessToken, p.obligation.id, p.settleInput, key())]);
    expect(await status(p.orderId)).toBe('DELIVERED');
    expect((await getPool().query("SELECT count(*)::int n FROM v2_outbox WHERE aggregate_id=$1 AND event_type='order.delivered.v2'", [p.orderId])).rows[0].n).toBe(1);
  });

  it('holds delivery while an unknown gateway attempt could still capture, then recovers after reconciliation', async () => {
    const p = await preparedReturn();
    const attempt = await p.billing.recordAttempt({ obligationId: p.obligation.id, method: 'GATEWAY', amountMinor: 6000 });
    await p.billing.resolveAttempt(attempt.id, 'OUTCOME_UNKNOWN');
    await logistics.recordHandover(p.riderOne.token, p.body, key());
    await p.billing.confirmManual(p.operator.accessToken, p.obligation.id, p.settleInput, key());
    expect(await status(p.orderId)).toBe('RETURNING');
    await p.billing.resolveAttempt(attempt.id, 'FAILED', { failureReason: 'Authoritative test adapter reconciliation' });
    expect(await status(p.orderId)).toBe('DELIVERED');
  });

  it('requires an actual audited zero-due resolution, never a fabricated receipt', async () => {
    const p = await preparedReturn();
    // Synthetic zero-price fixture only; not an approved commercial rate.
    await getPool().query('UPDATE orders_v2_orders SET total_minor=0 WHERE id=$1', [p.orderId]);
    await getPool().query('UPDATE billing_obligations SET amount_due_minor=0 WHERE id=$1', [p.obligation.id]);
    await logistics.recordHandover(p.riderOne.token, p.body, key());
    expect(await status(p.orderId)).toBe('RETURNING');
    await p.billing.voidZeroDue({ obligationId: p.obligation.id, actor: p.operator.actor,
      resolution: { auditId: key(), reason: 'Audited synthetic zero-due resolution' } });
    expect(await status(p.orderId)).toBe('DELIVERED');
    expect((await getPool().query('SELECT count(*)::int n FROM billing_receipts WHERE order_id=$1', [p.orderId])).rows[0].n).toBe(0);
  });

  it('rolls back receipt, settlement and events if the composed delivery step fails', async () => {
    const p = await preparedReturn();
    await logistics.recordHandover(p.riderOne.token, p.body, key());
    const broken = new BillingService({ db: getPool(), authenticate: token => identity.authenticate(token), clock,
      onSettled: async () => { throw new Error('Synthetic completion failure'); } });
    const receiptKey = key();
    await expect(broken.confirmManual(p.operator.accessToken, p.obligation.id, p.settleInput, receiptKey)).rejects.toThrow('Synthetic completion failure');
    expect((await getPool().query('SELECT count(*)::int n FROM billing_receipts WHERE order_id=$1', [p.orderId])).rows[0].n).toBe(0);
    expect((await getPool().query("SELECT count(*)::int n FROM v2_outbox WHERE event_type='payment.settled.v2'")).rows[0].n).toBe(0);
    expect(await status(p.orderId)).toBe('RETURNING');
    await p.billing.confirmManual(p.operator.accessToken, p.obligation.id, p.settleInput, receiptKey);
    expect(await status(p.orderId)).toBe('DELIVERED');
  });

  it('unlocks an owned post-delivery review only after real custody and final settlement', async () => {
    const p = await preparedReturn();
    const reviews = new ReviewsService({ db: getPool(), authenticate: token => identity.authenticate(token), clock });
    expect((await reviews.eligibility(p.customer.accessToken, p.orderId)).eligible).toBe(false);
    await logistics.recordHandover(p.riderOne.token, p.body, key());
    expect((await reviews.eligibility(p.customer.accessToken, p.orderId)).eligible).toBe(false);
    await p.billing.confirmManual(p.operator.accessToken, p.obligation.id, p.settleInput, key());
    expect((await reviews.eligibility(p.customer.accessToken, p.orderId)).eligible).toBe(true);
    const version = (await getPool().query('SELECT version FROM orders_v2_orders WHERE id=$1', [p.orderId])).rows[0].version;
    const review = await reviews.create(p.customer.accessToken, p.orderId, { orderId: p.orderId, expectedVersion: version,
      overall: 5, mediaIds: [], publishConsent: false }, key());
    expect(review).toMatchObject({ orderId: p.orderId, publication: 'PENDING', publishConsent: false });
  });

  it('completes from a signed capture and ignores webhook replay', async () => {
    const p = await preparedReturn();
    const secret = 'synthetic-capture-signing-key-for-test';
    const billing = new BillingService({ db: getPool(), authenticate: token => identity.authenticate(token), clock,
      webhookSecrets: { synthetic: secret }, onSettled: (id, tx, context) => completeReturnWhenSettled(tx, id, context) });
    const attempt = await billing.recordAttempt({ obligationId: p.obligation.id, method: 'GATEWAY', amountMinor: 6000 });
    await logistics.recordHandover(p.riderOne.token, p.body, key());
    const raw = Buffer.from(JSON.stringify({ eventId: key(), paymentId: attempt.id, providerReference: 'synthetic-capture',
      outcome: 'SUCCEEDED', amountMinor: 6000, currency: 'INR', occurredAt: now.toISOString() }));
    const signature = createHmac('sha256', secret).update(raw).digest('hex');
    expect(await billing.processWebhook('synthetic', raw, signature)).toMatchObject({ accepted: true, duplicate: false });
    expect(await status(p.orderId)).toBe('DELIVERED');
    expect(await billing.processWebhook('synthetic', raw, signature)).toMatchObject({ accepted: true, duplicate: true });
    expect((await getPool().query("SELECT count(*)::int n FROM v2_outbox WHERE event_type='payment.settled.v2'")).rows[0].n).toBe(1);
  });

  it('does not deliver for a rejected custody code even when paid', async () => {
    const p = await preparedReturn();
    await p.billing.confirmManual(p.operator.accessToken, p.obligation.id, p.settleInput, key());
    await expect(logistics.recordHandover(p.riderOne.token, { ...p.body, code: p.body.code === '000000' ? '111111' : '000000' }, key())).rejects.toBeDefined();
    expect(await status(p.orderId)).toBe('READY_FOR_RETURN');
    expect((await getPool().query("SELECT count(*)::int n FROM v2_outbox WHERE aggregate_id=$1 AND event_type='order.delivered.v2'", [p.orderId])).rows[0].n).toBe(0);
  });
});

describe('B06-01 assignment visibility', () => {
  it('lists and reads exactly the jobs a rider holds', async () => {
    const who = await actors();
    const orderId = await seedOrder({ customerId: who.customer.actor.id });
    const attempt = await logistics.openLegAttempt(orderId, 'PICKUP', { scheduledWindow: v2.windowSchema.parse(pickupWindow) });

    expect(await logistics.listRiderJobs(who.riderOne.token)).toEqual([]);

    const assignment = await logistics.assign(who.operator.accessToken, {
      legAttemptId: attempt.id, riderId: who.riderOne.id, expectedVersion: attempt.version, reason: 'Nearest rider',
    }, key());
    expect(assignment).toMatchObject({ legAttemptId: attempt.id, riderId: who.riderOne.id, version: 1, reason: 'Nearest rider' });
    expect(v2.assignmentSchema.parse(assignment)).toEqual(assignment);

    const jobs = await logistics.listRiderJobs(who.riderOne.token);
    expect(jobs.map(job => job.id)).toEqual([attempt.id]);
    expect(jobs[0]).toMatchObject({
      orderId,
      leg: 'PICKUP',
      status: 'ASSIGNED',
      containerCount: 2,
      addressLine1: '1 Synthetic Road',
      addressCity: 'Bengaluru',
    });
    expect(jobs[0].contactPhone).toBe(customerPhone);
    expect(jobs[0].assignmentActive).toBe(true);
    expect(v2.riderJobSchema.parse(jobs[0])).toEqual(jobs[0]);

    const detail = await logistics.getRiderJob(who.riderOne.token, attempt.id);
    expect(detail.id).toBe(jobs[0].id);
    expect(detail.customerName).not.toContain(customerPhone);
    expect(detail.customerName.length).toBeGreaterThan(1);

    const accepted = await logistics.acceptJob(who.riderOne.token, attempt.id, { expectedVersion: detail.version }, key());
    expect(accepted.acceptedAt).toBe(now.toISOString());
    const replay = await logistics.acceptJob(who.riderOne.token, attempt.id, { expectedVersion: detail.version }, key());
    expect(replay.acceptedAt).toBe(accepted.acceptedAt);
    expect((await getPool().query("SELECT count(*)::int AS n FROM logistics_assignment_events WHERE kind='ACCEPTED'")).rows[0].n).toBe(1);
  });

  it('refuses customer tokens on ops and rider surfaces and unassigned orders stay invisible', async () => {
    const who = await actors();
    const unassignedOrder = await seedOrder({ customerId: who.customer.actor.id });
    const unassigned = await logistics.openLegAttempt(unassignedOrder, 'PICKUP');
    await expect(logistics.listRiderJobs(who.customer.accessToken)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(logistics.getRiderJob(who.riderOne.token, unassigned.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(logistics.assign(who.customer.accessToken, {
      legAttemptId: unassigned.id, riderId: who.riderOne.id, expectedVersion: unassigned.version, reason: 'Not allowed',
    }, key())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('B06-02 reassignment', () => {
  it('releases the old rider and keeps one active assignment', async () => {
    const { operator, riderOne, riderTwo, orderId, attempt, assignment } = await assignedPickup();
    const second = await logistics.reassign(operator.accessToken, assignment.id, {
      riderId: riderTwo.id, expectedVersion: assignment.version, reason: 'Rider one is delayed',
    }, key());

    expect(second).toMatchObject({ legAttemptId: attempt.id, riderId: riderTwo.id, version: 1 });
    expect(second.id).not.toBe(assignment.id);
    expect(await activeAssignments(orderId)).toBe(1);
    expect((await getPool().query('SELECT count(*)::int AS n FROM logistics_assignments WHERE order_id=$1', [orderId])).rows[0].n).toBe(2);

    expect(await logistics.listRiderJobs(riderOne.token)).toEqual([]);
    await expect(logistics.getRiderJob(riderOne.token, attempt.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(logistics.recordHandover(riderOne.token, {
      jobId: attempt.id, legAttemptId: attempt.id, expectedVersion: attempt.version, actionId: randomUUID(),
      method: 'CODE', code: '123456', capturedAt: now.toISOString(), containerIds: [], garmentCount: 0, condition: 'GOOD',
    }, key())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(logistics.acceptJob(riderOne.token, attempt.id, { expectedVersion: attempt.version }, key()))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });

    const riderTwoJobs = await logistics.listRiderJobs(riderTwo.token);
    expect(riderTwoJobs.map(job => job.id)).toEqual([attempt.id]);
    expect(riderTwoJobs[0].version).toBe(3);
  });
});

describe('B06-03 handover proof and replay', () => {
  it('rejects a wrong code without writing custody or leaking the expected code', async () => {
    const { riderOne, orderId, attempt } = await assignedPickup();
    const job = await logistics.getRiderJob(riderOne.token, attempt.id);
    const code = notifier.latest()!.code;
    const wrong = code === '000000' ? '111111' : '000000';

    await expect(logistics.recordHandover(riderOne.token, await handoverInput(job, wrong), key()))
      .rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'Custody code did not match' });
    expect((await getPool().query('SELECT count(*)::int AS n FROM logistics_handovers')).rows[0].n).toBe(0);
    expect((await getPool().query('SELECT code_attempts FROM logistics_assignments WHERE order_id=$1', [orderId])).rows[0].code_attempts).toBe(1);
    expect((await getPool().query('SELECT status FROM orders_v2_orders WHERE id=$1', [orderId])).rows[0].status).toBe('CONFIRMED');
  });

  it('records one custody event, moves the guarded order status and replays without a second audit', async () => {
    const { riderOne, orderId, attempt } = await assignedPickup();
    const job = await logistics.getRiderJob(riderOne.token, attempt.id);
    const code = notifier.latest()!.code;
    const actionId = randomUUID();
    const handoverKey = key();

    const first = await logistics.recordHandover(riderOne.token, await handoverInput(job, code, actionId), handoverKey);
    expect(first).toMatchObject({ legAttemptId: attempt.id, accepted: true, attemptCount: 1, nextAttemptAllowed: false });
    expect(first.custodyEventId).toBeDefined();

    const replay = await logistics.recordHandover(riderOne.token, await handoverInput(job, code, actionId), handoverKey);
    const replayOffline = await logistics.recordHandover(riderOne.token, await handoverInput(job, code, actionId), key());
    expect(replay.custodyEventId).toBe(first.custodyEventId);
    expect(replayOffline.custodyEventId).toBe(first.custodyEventId);

    expect((await getPool().query('SELECT count(*)::int AS n FROM logistics_handovers')).rows[0].n).toBe(1);
    expect((await getPool().query("SELECT count(*)::int AS n FROM v2_audit WHERE action='LOGISTICS_PICKUP_CUSTODY_RECORDED'")).rows[0].n).toBe(1);
    expect((await getPool().query("SELECT count(*)::int AS n FROM orders_v2_timeline WHERE label='Rider collected the laundry'")).rows[0].n).toBe(1);
    expect((await getPool().query('SELECT status,version FROM orders_v2_orders WHERE id=$1', [orderId])).rows[0]).toMatchObject({ status: 'PICKUP_PENDING', version: 4 });
    expect((await getPool().query('SELECT status FROM logistics_leg_attempts WHERE id=$1', [attempt.id])).rows[0].status).toBe('COMPLETED');

    const stored = (await getPool().query('SELECT * FROM logistics_handovers')).rows[0];
    expect(stored.code_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.container_ids).toHaveLength(2);
    expect(stored.garment_count).toBe(6);
    expect(stored.condition).toBe('GOOD');
    expect(stored.captured_lat).toBeNull();
    expect(stored.photo_media_id).toBeNull();
    expect(JSON.stringify(stored)).not.toContain(code);
    const audit = (await getPool().query('SELECT before_value,after_value FROM v2_audit')).rows;
    expect(JSON.stringify(audit)).not.toContain(code);
  });

  it('expires a code and reissues one on reassignment', async () => {
    const { operator, riderOne, riderTwo, attempt, assignment } = await assignedPickup();
    const firstCode = notifier.latest()!.code;
    const oldJob = await logistics.getRiderJob(riderOne.token, attempt.id);
    nextTime(6 * 60_000);
    await expect(logistics.recordHandover(riderOne.token, await handoverInput(oldJob, firstCode), key()))
      .rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'The custody code has expired' });

    const replacement = await logistics.reassign(operator.accessToken, assignment.id, {
      riderId: riderTwo.id, expectedVersion: assignment.version, reason: 'Code expired before handover',
    }, key());
    const secondCode = notifier.latest()!.code;
    expect(secondCode).not.toBe(firstCode);
    const job = await logistics.getRiderJob(riderTwo.token, attempt.id);
    const result = await logistics.recordHandover(riderTwo.token, await handoverInput(job, secondCode), key());
    expect(result.accepted).toBe(true);
    expect(replacement.riderId).toBe(riderTwo.id);
  });

  it('locks custody proof entry after the bounded attempt count', async () => {
    const { riderOne, orderId, attempt } = await assignedPickup();
    const job = await logistics.getRiderJob(riderOne.token, attempt.id);
    const code = notifier.latest()!.code;
    const wrong = code === '000000' ? '111111' : '000000';
    for (const guess of [1, 2, 3, 4, 5].map(() => wrong)) {
      await expect(logistics.recordHandover(riderOne.token, await handoverInput(job, guess), key()))
        .rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'Custody code did not match' });
    }
    // Even the correct code is refused once the guess budget is spent.
    await expect(logistics.recordHandover(riderOne.token, await handoverInput(job, code), key()))
      .rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'The custody code is locked after too many attempts' });
    expect((await getPool().query('SELECT count(*)::int AS n FROM logistics_handovers')).rows[0].n).toBe(0);
    expect((await getPool().query('SELECT code_attempts FROM logistics_assignments WHERE order_id=$1', [orderId])).rows[0].code_attempts).toBe(5);
    expect((await getPool().query('SELECT status FROM orders_v2_orders WHERE id=$1', [orderId])).rows[0].status).toBe('CONFIRMED');
    expect((await getPool().query('SELECT count(*)::int AS n FROM logistics_assignments WHERE order_id=$1 AND code_attempts>0', [orderId])).rows[0].n).toBe(1);
  });
});

describe('B06-04 return custody', () => {
  it('records return proof, reuses containers and keeps one live attempt per leg', async () => {
    const who = await actors();
    const orderId = await seedOrder({ customerId: who.customer.actor.id, status: 'READY_FOR_RETURN', measured: true, qualityPassed: true });
    const pickup = await logistics.openLegAttempt(orderId, 'PICKUP', { scheduledWindow: v2.windowSchema.parse(pickupWindow) });
    await getPool().query("UPDATE logistics_leg_attempts SET status='COMPLETED',completed_at=$2,version=version+1 WHERE id=$1", [pickup.id, now]);
    const ret = await logistics.openLegAttempt(orderId, 'RETURN', { scheduledWindow: v2.windowSchema.parse(returnWindow) });
    await logistics.assign(who.operator.accessToken, { legAttemptId: ret.id, riderId: who.riderOne.id, expectedVersion: ret.version, reason: 'Return run' }, key());
    const job = await logistics.getRiderJob(who.riderOne.token, ret.id);
    const code = notifier.latest()!.code;
    const handover = await logistics.recordHandover(who.riderOne.token, await handoverInput(job, code), key());

    expect(handover.accepted).toBe(true);
    expect((await getPool().query('SELECT status FROM orders_v2_orders WHERE id=$1', [orderId])).rows[0].status).toBe('RETURNING');
    const stored = (await getPool().query('SELECT custody_kind,container_ids,garment_count FROM logistics_handovers WHERE id=$1', [handover.custodyEventId])).rows[0];
    expect(stored.custody_kind).toBe('RETURN_COMPLETED');
    expect(stored.container_ids).toEqual(job.containerIds);
    expect(stored.garment_count).toBe(6);

    const live = (await getPool().query(
      "SELECT leg,count(*)::int AS n FROM logistics_leg_attempts WHERE order_id=$1 AND status NOT IN ('COMPLETED','FAILED','CANCELLED') GROUP BY leg", [orderId],
    )).rows;
    expect(live).toEqual([]);

    const receipt = await logistics.getCustodyReceipt(who.customer.accessToken, orderId);
    expect(receipt).toMatchObject({ orderId, sealedContainerCount: 1, amountDueAtReturnMinor: 6000, currency: 'INR' });
    expect(receipt.currentHandoff).toBe('RETURNED');
    expect(receipt.countedQuantity).toBe(6);
  });

  it('refuses a second live attempt while the order leg still has one', async () => {
    const who = await actors();
    const orderId = await seedOrder({ customerId: who.customer.actor.id });
    const first = await logistics.openLegAttempt(orderId, 'PICKUP');
    await expect(logistics.openLegAttempt(orderId, 'PICKUP'))
      .rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'This order leg already has a live attempt' });
    expect((await getPool().query(
      "SELECT count(*)::int AS n FROM logistics_leg_attempts WHERE order_id=$1 AND leg='PICKUP'", [orderId])).rows[0].n).toBe(1);
    expect(first.attemptNumber).toBe(1);
  });
});

describe('B06-05 provider events and stale location', () => {
  it('applies a duplicate provider event once and never shows a stale position as live', async () => {
    const who = await actors();
    const orderId = await seedOrder({ customerId: who.customer.actor.id });
    const attempt = await logistics.openLegAttempt(orderId, 'PICKUP', {
      provider: 'fake-logistics', providerReference: 'fake-ref-1', scheduledWindow: v2.windowSchema.parse(pickupWindow),
    });
    const assignment = await logistics.assign(who.operator.accessToken, {
      legAttemptId: attempt.id, riderId: who.riderOne.id, expectedVersion: attempt.version, reason: 'Provider leg',
    }, key());
    const eventId = randomUUID();
    const event = { eventId, providerReference: 'fake-ref-1', status: 'AT_PICKUP' as const, occurredAt: now.toISOString() };
    const signature = verifier.sign('fake-logistics', event);
    const headers = { 'x-logistics-signature': signature };

    const first = await logistics.handleProviderEvent('fake-logistics', event, headers);
    const duplicate = await logistics.handleProviderEvent('fake-logistics', event, headers);
    expect(first).toEqual({ accepted: true, duplicate: false });
    expect(duplicate).toEqual({ accepted: true, duplicate: true });
    expect((await getPool().query('SELECT count(*)::int AS n FROM logistics_provider_events')).rows[0].n).toBe(1);
    expect((await getPool().query("SELECT count(*)::int AS n FROM v2_audit WHERE action='LOGISTICS_PROVIDER_EVENT'")).rows[0].n).toBe(1);
    expect((await getPool().query('SELECT status FROM logistics_leg_attempts WHERE id=$1', [attempt.id])).rows[0].status).toBe('AT_PICKUP');

    await expect(logistics.handleProviderEvent('fake-logistics', event, { 'x-logistics-signature': 'f'.repeat(64) }))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    const job = await logistics.getRiderJob(who.riderOne.token, attempt.id);
    const fresh = await logistics.reportLocation(who.riderOne.token, {
      jobId: job.id, expectedVersion: job.version, lat: 12.95, lng: 77.6, reportedAt: now.toISOString(),
    }, key());
    expect(fresh.stale).toBe(false);
    const older = await logistics.reportLocation(who.riderOne.token, {
      jobId: job.id, expectedVersion: job.version, lat: 12.90, lng: 77.50, reportedAt: new Date(now.getTime() - 10 * 60_000).toISOString(),
    }, key());
    expect(older.stale).toBe(true);

    const tracking = await logistics.getTracking(who.customer.accessToken, orderId);
    expect(tracking.status).toBe('CONFIRMED');
    expect(tracking.locationUpdatedAt).toBe(now.toISOString());
    expect(tracking.locationSource).toBe('RIDER_REPORTED');
    expect(tracking.steps[0]).toMatchObject({ label: 'Status CONFIRMED', state: 'CURRENT' });

    nextTime(6 * 60_000);
    const later = await logistics.getTracking(who.customer.accessToken, orderId);
    expect(later.locationUpdatedAt).toBeUndefined();
    expect(later.locationSource).toBeUndefined();
    expect((await getPool().query('SELECT count(*)::int AS n FROM logistics_positions')).rows[0].n).toBe(2);
    expect(assignment.riderId).toBe(who.riderOne.id);
  });
});

describe('B06 tracking and custody ownership', () => {
  it('hides another customer order and reports only stored events', async () => {
    const who = await actors();
    const other = await signin(otherCustomerPhone);
    const orderId = await seedOrder({ customerId: who.customer.actor.id });
    await expect(logistics.getTracking(other.accessToken, orderId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(logistics.getCustodyReceipt(other.accessToken, orderId)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const tracking = await logistics.getTracking(who.customer.accessToken, orderId);
    expect(tracking.status).toBe('CONFIRMED');
    // Step ids are contract GUIDs; only the label carries the milestone text.
    expect(tracking.steps.map(step => ({ label: step.label, state: step.state })))
      .toEqual([{ label: 'Status CONFIRMED', state: 'CURRENT' }]);
    for (const step of tracking.steps) expect(v2.trackingStepSchema.parse(step)).toEqual(step);
    expect((await logistics.getTracking(who.customer.accessToken, orderId)).steps).toEqual(tracking.steps);
    const receipt = await logistics.getCustodyReceipt(who.customer.accessToken, orderId);
    expect(receipt.currentHandoff).toBe('NONE');
    expect(receipt.amountDueAtReturnMinor).toBe(6000);
    expect(receipt.estimatedQuantity).toBe(6);
    expect(receipt.sealedContainerCount).toBe(1);
  });

  it('serves the customer tracking route over HTTP with the contract envelope', async () => {
    const who = await actors();
    const orderId = await seedOrder({ customerId: who.customer.actor.id });
    const app = await NestFactory.create<NestExpressApplication>(LogisticsV2Module.register(() => logistics), { logger: false });
    configureHttpBody(app);
    app.useGlobalFilters(new EnvelopeFilter());
    await app.listen(0, '127.0.0.1');
    const base = (await app.getUrl()) + '/v2';
    try {
      const ok = await fetch(`${base}/orders/${orderId}/tracking`, { headers: { authorization: `Bearer ${who.customer.accessToken}` } });
      expect(ok.status).toBe(200);
      const body = v2.customerTrackingSchema.parse(await ok.json());
      expect(body.orderId).toBe(orderId);

      const forbidden = await fetch(`${base}/rider/jobs`, { headers: { authorization: `Bearer ${who.customer.accessToken}` } });
      expect(forbidden.status).toBe(403);
      expect(v2.errorEnvelopeSchema.parse(await forbidden.json()).code).toBe('FORBIDDEN');

      const missingKey = await fetch(`${base}/ops/logistics/assignments`, {
        method: 'POST',
        headers: { authorization: `Bearer ${who.operator.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ legAttemptId: randomUUID(), riderId: who.riderOne.id, expectedVersion: 1, reason: 'No key' }),
      });
      expect(missingKey.status).toBe(400);
      expect(v2.errorEnvelopeSchema.parse(await missingKey.json()).code).toBe('INVALID_INPUT');

      const unsigned = await fetch(`${base}/webhooks/logistics/fake-logistics`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventId: 'e1', providerReference: 'ref', status: 'BOOKED', occurredAt: now.toISOString() }),
      });
      expect(unsigned.status).toBe(401);
      expect(v2.errorEnvelopeSchema.parse(await unsigned.json()).code).toBe('UNAUTHENTICATED');
    } finally {
      await app.close();
    }
  });
});

describe('B06 fake assignment port', () => {
  it('ranks riders with the fake distance calculator only', async () => {
    const calculator = new FakeDistanceEtaCalculator();
    const port = createFakeAutoAssignmentPort(calculator);
    const chosen = await port.propose({
      orderId: randomUUID(),
      leg: 'PICKUP',
      origin: { lat: 12.95, lng: 77.6 },
      candidates: [
        { riderId: 'far-rider', location: { lat: 13.20, lng: 77.8 } },
        { riderId: 'near-rider', location: { lat: 12.96, lng: 77.61 } },
      ],
    });
    expect(chosen?.riderId).toBe('near-rider');
    const eta = calculator.estimate({ lat: 12.95, lng: 77.6 }, { lat: 12.96, lng: 77.61 });
    expect(eta.distanceMeters).toBeGreaterThan(0);
    expect(eta.etaMinutes).toBeGreaterThanOrEqual(1);
  });
});
