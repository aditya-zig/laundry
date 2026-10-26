import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes, randomUUID } from 'node:crypto';
import { v2 } from '@laundry/contracts';
import { JobsModule } from '../src/features/jobs/jobs.module';
import { configureHttpBody } from '../src/http-body';
import { EnvelopeFilter } from '../src/filters/http-exception.filter';
import { createV2Client } from '../../../packages/api-client/src/v2';
import { closePool, getPool, initializeDb } from '../../../modules/shared/src/db';
import { AvailabilityService } from '../../../modules/availability/src';
import { CatalogService } from '../../../modules/catalog/src';
import { OrdersService } from '../../../modules/orders/src';
import { IdentityService, type OtpDelivery } from '../../../modules/identity/src';
import { JobHandlerRegistry, JobsService, runPrivacySweeps } from '../../../modules/jobs/src';
import type { JobHandlerDescriptor, JobsOptions } from '../../../modules/jobs/src';

const customerPhone = '+919000090001';
const secondCustomerPhone = '+919000090002';
const operatorPhone = '+919000090003';
const keys = { hashKey: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex') };
const key = () => randomUUID();
const postalCode = '560001';
let now: Date;
let identity: IdentityService;
let catalog: CatalogService;
let availability: AvailabilityService;
let orders: OrdersService;
let deliveries: { phone: string; code: string; challengeId: string }[];
let operatorAccessToken: string | undefined;
const clock = () => now;

const TRUNCATE = `TRUNCATE job_runs, job_dead_letters, job_privacy_runs,
  v2_command_results, v2_audit, v2_outbox, v2_inbox,
  orders_v2_quotes, orders_v2_orders, orders_v2_timeline, orders_v2_adjustments,
  availability_areas, availability_area_postal_codes, availability_buckets, availability_holds,
  catalog_services, catalog_garments, catalog_rate_cards,
  identity_profiles, identity_otp_challenges, identity_rate_buckets, identity_session_families,
  identity_sessions, identity_command_results, identity_addresses, identity_audit,
  identity_staff, identity_staff_facilities, identity_staff_invitations, identity_staff_mfa,
  identity_staff_mfa_enrollments, identity_whatsapp_links CASCADE`;

const weekdays = [1, 2, 3, 4, 5, 6].map(dayOfWeek => ({ dayOfWeek, start: '09:00', end: '18:00' }));
const pickupWindow = { start: '2026-10-26T03:30:00.000Z', end: '2026-10-26T04:30:00.000Z', timezone: 'Asia/Kolkata' };

function advance(ms: number) { now = new Date(now.getTime() + ms); }

async function provisionStaff(phone: string, role = 'OPERATOR') {
  await getPool().query('INSERT INTO identity_staff (id,phone,role,created_at) VALUES ($1,$2,$3,$4)', [randomUUID(), phone, role, now]);
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

async function bucket(areaId: string): Promise<string> {
  const id = randomUUID();
  await getPool().query(`INSERT INTO availability_buckets
    (id,facility_id,area_id,starts_at,ends_at,timezone,capacity,reserved,version,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,'Asia/Kolkata',1,0,1,$6,$6)`, [
    id, randomUUID(), areaId, new Date(pickupWindow.start), new Date(pickupWindow.end), now,
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

async function approvedCard(): Promise<void> {
  await getPool().query(`INSERT INTO catalog_rate_cards
    (id,version,service_codes,components,weight_increment_grams,minimum_billable_grams,rounding,effective_from,approved_at,activated_at,synthetic,created_at)
    VALUES ($1,1,$2,$3,500,1000,'CEIL','2026-10-01T00:00:00.000Z',$4,$4,true,$4)`, [
    randomUUID(),
    JSON.stringify(['WASH_FOLD']),
    JSON.stringify([{ label: 'Synthetic per kg', kind: 'PER_KG', amountMinor: 4000, synthetic: true }]),
    now,
  ]);
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

function quoteInput(serviceId: string, addressId: string): v2.QuoteInput {
  return {
    addressId,
    lines: [{ serviceId, billingUnit: 'KG', estimatedWeightGrams: 1201 }],
    pickupWindow,
    requestedReturnBy: '2026-10-29T00:00:00.000Z',
    timezone: 'Asia/Kolkata',
  };
}

/** A real booking through the orders module, so a failing downstream consumer
 * is proved not to touch committed order state. */
async function bookOnce(customer: { accessToken: string; actor: v2.Actor }) {
  const areaId = await area();
  await bucket(areaId);
  const serviceId = await service();
  await approvedCard();
  const addressId = await address(customer.actor.id);
  const quote = await orders.createQuote(customer.accessToken, quoteInput(serviceId, addressId), key());
  const order = await orders.bookOrder(customer.accessToken, { quoteId: quote.id, expectedVersion: 1, paymentModel: 'DUE_AT_RETURN' }, key());
  return { quote, order };
}

function mediaEvent(): v2.DomainEvent {
  const mediaId = randomUUID();
  return v2.domainEventSchema.parse({
    eventId: randomUUID(),
    eventType: 'media.uploaded.v2',
    schemaVersion: 2,
    aggregateId: mediaId,
    aggregateVersion: 1,
    occurredAt: now.toISOString(),
    traceId: randomUUID(),
    payload: {
      media: {
        id: mediaId,
        kind: 'PROOF_IMAGE',
        visibility: 'PRIVATE',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        ownerId: randomUUID(),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
        status: 'AVAILABLE',
      },
    },
  });
}

async function publish(event: v2.DomainEvent, dueAt: Date = now): Promise<void> {
  await getPool().query(
    `INSERT INTO v2_outbox (event_id, aggregate_id, aggregate_version, event_type, envelope, created_at, due_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [event.eventId, event.aggregateId, event.aggregateVersion, event.eventType, JSON.stringify(event), now, dueAt],
  );
}

function makeJobs(descriptors: JobHandlerDescriptor[] = [], overrides: Partial<JobsOptions> = {}): JobsService {
  // These isolated dispatcher tests implement every other required consumer as
  // a real transactional audit effect. They do not claim business-adapter or
  // commercial acceptance. Tests that need a missing registry override it.
  const peers: JobHandlerDescriptor[] = Object.entries(v2.EVENT_CONSUMERS).flatMap(([eventType, consumers]) =>
    consumers.filter(consumer => !descriptors.some(d => d.consumer === consumer && d.eventType === eventType)).map(consumer => ({
      consumer, eventType: v2.eventTypeSchema.parse(eventType), description: 'Dispatcher-test audit consumer',
      handler: async ({ event, scope }) => { await scope.audit({ aggregateId: event.aggregateId,
        action: 'TEST_CONSUMER_OBSERVED', reason: 'Isolated dispatcher test', before: null, after: { eventId: event.eventId } }); },
    })),
  );
  return new JobsService({
    db: getPool(),
    authenticate: token => identity.authenticate(token),
    registry: new JobHandlerRegistry([...descriptors, ...peers]),
    clock,
    jitter: () => 0.5,
    baseDelayMs: 1_000,
    maxAttempts: 5,
    leaseSeconds: 30,
    ...overrides,
  });
}

const failingDescriptor = (calls: { count: number }, consumer = 'media', eventType: v2.EventType = 'media.uploaded.v2'): JobHandlerDescriptor => ({
  consumer,
  eventType,
  description: 'Fails on purpose for the retry test',
  handler: async () => { calls.count += 1; throw new Error('upstream rejected +919000090001'); },
});

async function count(sql: string, values: unknown[] = []): Promise<number> {
  return Number((await getPool().query<{ n: string | number }>(sql, values)).rows[0].n);
}

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/laundry_verify_')) {
    throw new Error('Disposable local PostgreSQL required');
  }
  await initializeDb();
  const proposal = readFileSync(fileURLToPath(new URL('../../../modules/schema/proposals/B10.sql', import.meta.url)), 'utf8');
  await getPool().query(proposal);
});

beforeEach(async () => {
  await getPool().query(TRUNCATE);
  now = new Date('2026-10-26T02:00:00Z');
  deliveries = [];
  operatorAccessToken = undefined;
  const provider: OtpDelivery = { mode: 'FAKE', async send(input) { deliveries.push(input); return { reference: `fake-${input.challengeId}` }; } };
  identity = new IdentityService({ db: getPool(), provider, ...keys, clock });
  catalog = new CatalogService({ db: getPool(), authenticate: token => identity.authenticate(token), clock });
  availability = new AvailabilityService({ db: getPool(), authenticate: token => identity.authenticate(token), clock, holdMinutes: 5 });
  orders = new OrdersService({ db: getPool(), authenticate: token => identity.authenticate(token), catalog, availability, clock });
});

afterAll(closePool);

describe('B10 durable dispatch', () => {
  it('retries with backoff and dead-letters at the attempt limit', async () => {
    const calls = { count: 0 };
    const lines: unknown[] = [];
    const jobs = makeJobs([failingDescriptor(calls)], { log: line => lines.push(line) });
    const event = mediaEvent();
    await publish(event);

    const first = await jobs.dispatchBatch();
    expect(first).toEqual({ claimed: 1, completed: 0, failed: 1, deadLettered: 0 });
    expect(calls.count).toBe(1);

    const outbox = (await getPool().query<{ attempts: number; due_at: Date }>(
      'SELECT attempts, due_at FROM v2_outbox WHERE event_id=$1', [event.eventId])).rows[0];
    expect(outbox.attempts).toBe(1);
    expect(outbox.due_at.getTime()).toBeGreaterThan(now.getTime());

    // Not due yet, so an immediate tick must not retry early.
    expect((await jobs.dispatchBatch()).claimed).toBe(0);

    for (let attempt = 2; attempt <= 5; attempt += 1) {
      advance(60_000);
      await jobs.dispatchBatch();
    }

    expect(calls.count).toBe(5);
    expect(await count('SELECT COUNT(*) AS n FROM job_dead_letters WHERE job_id=$1', [event.eventId])).toBe(1);

    const page = await jobs.deadLetters(await operatorToken());
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: event.eventId, status: 'DEAD_LETTER', attempts: 5, lastErrorCode: 'PROVIDER_UNAVAILABLE' });

    const reason = (await getPool().query<{ reason: string }>('SELECT reason FROM job_dead_letters WHERE job_id=$1', [event.eventId])).rows[0].reason;
    expect(reason).not.toContain('+919000090001');
    expect(JSON.stringify(lines)).not.toContain('+919000090001');
    // Nothing is claimable once the record is terminal.
    expect((await jobs.claim()).length).toBe(0);
  });

  it('retains an event when required consumers have not been wired', async () => {
    const event = mediaEvent();
    await publish(event);
    const jobs = makeJobs([], { registry: new JobHandlerRegistry([]) });
    expect(await jobs.dispatchBatch()).toEqual({ claimed: 1, completed: 0, failed: 1, deadLettered: 0 });
    expect((await getPool().query('SELECT dispatched_at,attempts FROM v2_outbox WHERE event_id=$1', [event.eventId])).rows[0]).toMatchObject({ dispatched_at: null, attempts: 1 });
    expect(await count('SELECT count(*) AS n FROM v2_inbox WHERE event_id=$1', [event.eventId])).toBe(0);
  });

  it('fences a stale worker after an expired lease has been reclaimed', async () => {
    const event = mediaEvent();
    await publish(event);
    const oldWorker = makeJobs([], { workerId: 'stale-worker' });
    const [oldClaim] = await oldWorker.claim();
    advance(31_000);
    const current = makeJobs([], { workerId: 'current-worker' });
    const [currentClaim] = await current.claim();
    expect(currentClaim.version).toBeGreaterThan(oldClaim.version);
    const before = (await getPool().query('SELECT * FROM job_runs WHERE event_id=$1', [event.eventId])).rows[0];
    // Exercise the already-claimed work item delayed by a paused process.
    await oldWorker['dispatchOne'](oldClaim);
    expect((await getPool().query('SELECT * FROM job_runs WHERE event_id=$1', [event.eventId])).rows[0]).toEqual(before);
    expect((await getPool().query('SELECT dispatched_at,attempts FROM v2_outbox WHERE event_id=$1', [event.eventId])).rows[0]).toMatchObject({ dispatched_at: null, attempts: 0 });
    expect(await count('SELECT count(*) AS n FROM v2_inbox WHERE event_id=$1', [event.eventId])).toBe(0);
  });

  it('applies a duplicate delivery once through the inbox', async () => {
    const applied: string[] = [];
    const jobs = makeJobs([{
      consumer: 'media', eventType: 'media.uploaded.v2', description: 'Records one effect per event',
      handler: async ({ event }) => { applied.push(event.eventId); },
    }]);
    const event = mediaEvent();
    await publish(event);

    expect((await jobs.dispatchBatch()).completed).toBe(1);
    expect(applied).toEqual([event.eventId]);
    expect(await count('SELECT COUNT(*) AS n FROM v2_inbox WHERE consumer=$1 AND event_id=$2', ['media', event.eventId])).toBe(1);

    // Simulate a crash after the consumer committed but before the completion
    // update. The event is delivered again; the inbox row suppresses the effect.
    await getPool().query('UPDATE v2_outbox SET dispatched_at=NULL, due_at=$2 WHERE event_id=$1', [event.eventId, now]);
    advance(1_000);
    const replay = await jobs.dispatchBatch();
    expect(replay).toEqual({ claimed: 1, completed: 1, failed: 0, deadLettered: 0 });
    expect(applied).toEqual([event.eventId]);
    expect(await count('SELECT COUNT(*) AS n FROM v2_inbox WHERE consumer=$1', ['media'])).toBe(1);
  });

  it('keeps an in-flight transactional effect locked after lease time and dedupes its recovery', async () => {
    let start!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { start = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    const descriptor: JobHandlerDescriptor = { consumer: 'media', eventType: 'media.uploaded.v2', description: 'Delayed transactional audit',
      handler: async ({ event, scope }) => {
        calls++;
        await scope.audit({ aggregateId: event.aggregateId, action: 'TEST_DELAYED_EFFECT', reason: 'Lease race regression', before: null, after: { applied: true } });
        start();
        await gate;
      } };
    const event = mediaEvent();
    await publish(event);
    const oldWorker = makeJobs([descriptor], { workerId: 'slow-worker' });
    const dispatch = oldWorker.dispatchBatch();
    await started;
    try {
      advance(31_000);
      const next = makeJobs([descriptor], { workerId: 'recovery-worker' });
      expect(await next.claim()).toHaveLength(0);
      release();
      expect((await dispatch).completed).toBe(0);
      expect((await next.dispatchBatch()).completed).toBe(1);
      expect(calls).toBe(1);
      expect(await count("SELECT count(*) AS n FROM v2_audit WHERE action='TEST_DELAYED_EFFECT'")).toBe(1);
    } finally { release(); await dispatch; }
  });

  it('reclaims an expired lease without concurrent duplicate execution', async () => {
    const jobs = makeJobs([{
      consumer: 'media', eventType: 'media.uploaded.v2', description: 'Never runs in this test',
      handler: async () => undefined,
    }]);
    const event = mediaEvent();
    await publish(event);

    const [a, b] = await Promise.all([jobs.claim(), jobs.claim()]);
    expect(a.length + b.length).toBe(1);
    expect([...a, ...b][0].event_id).toBe(event.eventId);
    expect((await jobs.claim()).length).toBe(0);

    advance(29_000);
    expect((await jobs.claim()).length).toBe(0);

    // The worker that held the lease is presumed crashed.
    advance(2_000);
    const reclaimed = await jobs.claim();
    expect(reclaimed.map(row => row.event_id)).toEqual([event.eventId]);
    expect(reclaimed[0].attempts).toBe(0);
  });

  it('replays an audited dead letter once and refuses a stale version', async () => {
    const calls = { count: 0 };
    const failing = makeJobs([failingDescriptor(calls)]);
    const event = mediaEvent();
    await publish(event);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      advance(attempt === 1 ? 0 : 60_000);
      await failing.dispatchBatch();
    }
    const letter = (await failing.deadLetters(await operatorToken())).items[0];
    const key1 = randomUUID();

    const replayed = await failing.replay(await operatorToken(), event.eventId, { expectedVersion: letter.version, reason: 'Provider recovered' }, key1);
    expect(replayed).toMatchObject({ id: event.eventId, status: 'QUEUED', attempts: 0 });

    const audit = `SELECT COUNT(*) AS n FROM v2_audit WHERE action='JOB_REPLAYED' AND aggregate_id=$1`;
    expect(await count(audit, [event.eventId])).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM job_dead_letters WHERE job_id=$1 AND replayed_at IS NOT NULL', [event.eventId])).toBe(1);

    // The same idempotency key returns the stored response and requeues nothing.
    const again = await failing.replay(await operatorToken(), event.eventId, { expectedVersion: letter.version, reason: 'Provider recovered' }, key1);
    expect(again).toEqual(replayed);
    expect(await count(audit, [event.eventId])).toBe(1);
    expect((await getPool().query<{ attempts: number }>('SELECT attempts FROM v2_outbox WHERE event_id=$1', [event.eventId])).rows[0].attempts).toBe(0);

    // A replayed job is not dead-lettered, and the old version is stale.
    await expect(failing.replay(await operatorToken(), event.eventId, { expectedVersion: letter.version, reason: 'Stale retry' }, randomUUID()))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(await count(audit, [event.eventId])).toBe(1);

    const customer = await signin(customerPhone);
    await expect(failing.replay(customer.accessToken, event.eventId, { expectedVersion: replayed.version, reason: 'Not mine' }, randomUUID()))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });

    // Recovery: the next dispatch applies the consumer and completes the job.
    const applied: string[] = [];
    const healthy = makeJobs([{
      consumer: 'media', eventType: 'media.uploaded.v2', description: 'Succeeds after the replay',
      handler: async ({ event }) => { applied.push(event.eventId); },
    }]);
    advance(1_000);
    expect((await healthy.dispatchBatch()).completed).toBe(1);
    expect(applied).toEqual([event.eventId]);
    expect((await healthy.health(await operatorToken())).deadLetter).toBe(0);
  });

  it('distinguishes an unknown provider outcome from a plain failure', async () => {
    const jobs = makeJobs([{
      consumer: 'media', eventType: 'media.uploaded.v2', description: 'Times out after the provider side effect',
      handler: async () => {
        throw Object.assign(new Error('timeout after the provider accepted the request'), {
          name: 'UnknownOutcomeError',
          code: 'PROVIDER_OUTCOME_UNKNOWN',
        });
      },
    }], { maxAttempts: 1 });
    const event = mediaEvent();
    await publish(event);

    expect((await jobs.dispatchBatch()).deadLettered).toBe(1);
    const letter = (await jobs.deadLetters(await operatorToken())).items[0];
    expect(letter).toMatchObject({ id: event.eventId, lastErrorCode: 'PROVIDER_OUTCOME_UNKNOWN' });
    expect(letter.lastErrorCode).not.toBe('PROVIDER_UNAVAILABLE');
  });

  it('keeps a booking committed when a notification consumer fails', async () => {
    const customer = await signin(customerPhone);
    const { order } = await bookOnce(customer);
    // Booking itself must publish the event atomically, not a test-only helper.
    const published = (await getPool().query<{ envelope: unknown; due_at: Date; dispatched_at: Date | null }>(
      'SELECT envelope, due_at, dispatched_at FROM v2_outbox WHERE aggregate_id=$1', [order.id])).rows;
    expect(published).toHaveLength(1);
    expect(v2.domainEventSchema.parse(published[0].envelope)).toMatchObject({ eventType: 'order.confirmed.v2', aggregateId: order.id });
    expect(published[0].dispatched_at).toBeNull();
    // Publication uses PostgreSQL's clock; the booking fixture uses a fixed
    // business date. Advance past the real due time without rewriting the
    // outbox or depending on today's date. PostgreSQL retains microseconds
    // that JavaScript Dates truncate, so equality can still be too early.
    advance(Math.max(0, published[0].due_at.getTime() + 1 - now.getTime()));

    let outage = true;
    let notificationAttempts = 0;
    const jobs = makeJobs([{
      consumer: 'notifications', eventType: 'order.confirmed.v2', description: 'Simulated notification outage',
      handler: async () => {
        notificationAttempts += 1;
        if (outage) throw new Error('notification provider unavailable');
      },
    }]);

    expect(await jobs.dispatchBatch()).toEqual({ claimed: 1, completed: 0, failed: 1, deadLettered: 0 });
    expect(notificationAttempts).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM v2_inbox WHERE consumer=$1', ['notifications'])).toBe(0);
    const before = (await getPool().query('SELECT status, version, total_minor FROM orders_v2_orders WHERE id=$1', [order.id])).rows[0];
    expect(before).toMatchObject({ status: 'CONFIRMED', version: 1, total_minor: '6000' });

    outage = false;
    advance(60_000);
    expect(await jobs.dispatchBatch()).toEqual({ claimed: 1, completed: 1, failed: 0, deadLettered: 0 });
    expect(notificationAttempts).toBe(2);
    const after = (await getPool().query('SELECT status, version, total_minor FROM orders_v2_orders WHERE id=$1', [order.id])).rows[0];
    expect(after).toEqual(before);
    expect(await count('SELECT COUNT(*) AS n FROM v2_inbox WHERE consumer=$1', ['notifications'])).toBe(1);
  });
});

async function operatorToken(): Promise<string> {
  if (operatorAccessToken !== undefined) return operatorAccessToken;
  const existing = await count('SELECT COUNT(*) AS n FROM identity_staff');
  if (existing === 0) await provisionStaff(operatorPhone);
  operatorAccessToken = (await signin(operatorPhone)).accessToken;
  return operatorAccessToken;
}

describe('B10 privacy sweeps', () => {
  async function expiredSession(profileId: string): Promise<string> {
    const familyId = randomUUID();
    await getPool().query(
      `INSERT INTO identity_session_families (id, profile_id, issuer_mode, created_at, absolute_expires_at)
       VALUES ($1,$2,'FAKE',$3,$4)`,
      [familyId, profileId, new Date(now.getTime() - 10 * 86_400_000), new Date(now.getTime() - 86_400_000)],
    );
    await getPool().query(
      `INSERT INTO identity_sessions
         (id, family_id, access_hash, refresh_hash, created_at, access_expires_at, refresh_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), familyId, randomBytes(16).toString('hex'), randomBytes(16).toString('hex'),
        new Date(now.getTime() - 2 * 86_400_000), new Date(now.getTime() - 2 * 3_600_000), new Date(now.getTime() - 3_600_000)],
    );
    return familyId;
  }

  async function expiredChallenge(phone: string): Promise<string> {
    const id = randomUUID();
    await getPool().query(
      `INSERT INTO identity_otp_challenges
         (id, phone, peer_hash, request_scope, key_hash, intent_hash, code_hash, issuer_mode, status, attempts, created_at, expires_at)
       VALUES ($1,$2,'peer','privacy',$3,'intent','code','FAKE','ACCEPTED',0,$4,$5)`,
      [id, phone, randomBytes(8).toString('hex'), new Date(now.getTime() - 7_200_000), new Date(now.getTime() - 3_600_000)],
    );
    return id;
  }

  it('is idempotent and leaves rows referenced by a live order', async () => {
    const linked = await signin(customerPhone);
    const idle = await signin(secondCustomerPhone);
    const { order } = await bookOnce(linked);

    const linkedFamily = await expiredSession(linked.actor.id);
    const idleFamily = await expiredSession(idle.actor.id);
    const linkedChallenge = await expiredChallenge(customerPhone);
    const idleChallenge = await expiredChallenge(secondCustomerPhone);

    await getPool().query('UPDATE identity_profiles SET active=FALSE WHERE id=ANY($1)', [[linked.actor.id, idle.actor.id]]);
    await getPool().query(
      `INSERT INTO identity_whatsapp_links (profile_id, phone, linked_at) VALUES ($1,$2,$3), ($4,$5,$3)`,
      [linked.actor.id, customerPhone, now, idle.actor.id, secondCustomerPhone],
    );

    const first = await runPrivacySweeps({ db: getPool(), clock });
    const [otp, sessions, links, media] = first;
    expect(otp).toMatchObject({ sweep: 'OTP_CHALLENGES', status: 'COMPLETED', rowsRedacted: 2 });
    expect(sessions).toMatchObject({ sweep: 'SESSION_FAMILIES', status: 'COMPLETED', rowsRedacted: 2, rowsDeleted: 1, rowsRefused: 1 });
    expect(links).toMatchObject({ sweep: 'WHATSAPP_LINKS', status: 'COMPLETED', rowsDeleted: 1, rowsRefused: 1 });
    expect(media).toMatchObject({ sweep: 'MEDIA_RETENTION', status: 'SKIPPED' });

    // Refused, not deleted: the customer still has an order in flight.
    expect(await count('SELECT COUNT(*) AS n FROM identity_sessions WHERE family_id=$1', [linkedFamily])).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM identity_whatsapp_links WHERE profile_id=$1', [linked.actor.id])).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM identity_sessions WHERE family_id=$1', [idleFamily])).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM identity_whatsapp_links WHERE profile_id=$1', [idle.actor.id])).toBe(0);
    expect((await getPool().query('SELECT phone, code_hash FROM identity_otp_challenges WHERE id=$1', [linkedChallenge])).rows[0])
      .toEqual({ phone: null, code_hash: null });
    expect((await getPool().query('SELECT phone FROM identity_otp_challenges WHERE id=$1', [idleChallenge])).rows[0].phone).toBeNull();
    // The committed order is untouched by retention.
    expect((await getPool().query('SELECT status FROM orders_v2_orders WHERE id=$1', [order.id])).rows[0].status).toBe('CONFIRMED');

    const second = await runPrivacySweeps({ db: getPool(), clock });
    expect(second[0]).toMatchObject({ rowsRedacted: 0 });
    expect(second[1]).toMatchObject({ rowsRedacted: 0, rowsDeleted: 0, rowsRefused: 1 });
    expect(second[2]).toMatchObject({ rowsDeleted: 0, rowsRefused: 1 });
    expect(second[3].status).toBe('SKIPPED');

    expect(await count('SELECT COUNT(*) AS n FROM job_privacy_runs')).toBe(8);
    expect(await count("SELECT COUNT(*) AS n FROM v2_audit WHERE action LIKE 'PRIVACY_SWEEP_%'")).toBe(8);
  });
});

describe('B10 jobs through the real SDK over HTTP', () => {
  let app: NestExpressApplication;
  let base: string;
  afterEach(async () => { await app?.close(); });

  it('serves health and dead letters and replays with operator authority', async () => {
    const calls = { count: 0 };
    const jobs = makeJobs([failingDescriptor(calls)], { maxAttempts: 1 });
    const event = mediaEvent();
    await publish(event);
    await jobs.dispatchBatch();

    app = await NestFactory.create<NestExpressApplication>(JobsModule.register(() => jobs), { logger: false });
    configureHttpBody(app);
    app.useGlobalFilters(new EnvelopeFilter());
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()) + '/v2';

    await provisionStaff(operatorPhone);
    const operator = await signin(operatorPhone);
    let bearer: string | undefined = operator.accessToken;
    const client = createV2Client({ baseUrl: base, getToken: () => bearer });

    const health = await client.jobHealth();
    expect(health).toMatchObject({ queued: 0, claimed: 0, deadLetter: 1 });
    expect(health.oldestDueAt).toBeNull();

    const page = await client.listDeadLetters();
    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe(event.eventId);
    expect(page.pageInfo.hasMore).toBe(false);

    const replayed = await client.replayJob(event.eventId, { expectedVersion: page.items[0].version, reason: 'Provider recovered' }, { idempotencyKey: randomUUID() });
    expect(replayed).toMatchObject({ id: event.eventId, status: 'QUEUED', attempts: 0 });
    expect((await client.jobHealth()).deadLetter).toBe(0);

    const customer = await signin(customerPhone);
    bearer = customer.accessToken;
    await expect(client.listDeadLetters()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(client.jobHealth()).rejects.toMatchObject({ code: 'FORBIDDEN' });

    bearer = undefined;
    const anonymous = await fetch(base + '/ops/jobs/health');
    expect(anonymous.status).toBe(401);
    expect(v2.errorEnvelopeSchema.parse(await anonymous.json()).code).toBe('UNAUTHENTICATED');

    const tampered = await fetch(base + `/ops/jobs/${event.eventId}/replay`, {
      method: 'POST',
      headers: { authorization: `Bearer ${operator.accessToken}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({ expectedVersion: 99, reason: 'Stale' }),
    });
    expect(tampered.status).toBe(409);
    expect(v2.errorEnvelopeSchema.parse(await tampered.json()).code).toBe('VERSION_CONFLICT');
  });
});
