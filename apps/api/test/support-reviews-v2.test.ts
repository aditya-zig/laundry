import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Module } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { v2 } from '@laundry/contracts';
import { SupportModule } from '../src/features/support/support.module';
import { ReviewsModule } from '../src/features/reviews/reviews.module';
import { configureHttpBody } from '../src/http-body';
import { EnvelopeFilter } from '../src/filters/http-exception.filter';
import { createV2Client } from '../../../packages/api-client/src/v2';
import { closePool, getPool, initializeDb } from '../../../modules/shared/src/db';
import { ApiError } from '../../../modules/shared/src/errors';
import { SupportService } from '../../../modules/support/src';
import { ReviewsService } from '../../../modules/reviews/src';

const CUSTOMER_A = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_B = '22222222-2222-4222-8222-222222222222';
const OPERATOR_ID = '33333333-3333-4333-8333-333333333333';
const SUPPORT_ID = '44444444-4444-4444-8444-444444444444';
const SERVICE_ID = '55555555-5555-4555-8555-555555555555';
const AREA_ID = '66666666-6666-4666-8666-666666666666';
const TOKEN_A = 'A'.repeat(43);
const TOKEN_B = 'B'.repeat(43);
const TOKEN_OPERATOR = 'C'.repeat(43);
const TOKEN_SUPPORT = 'D'.repeat(43);
const key = () => randomUUID();

const actor = (id: string, role: v2.ActorRole): v2.Actor => ({ id, role, facilityIds: [], scope: { facilityIds: [] } });
const ACTORS: Record<string, v2.Actor> = {
  [TOKEN_A]: actor(CUSTOMER_A, 'CUSTOMER'),
  [TOKEN_B]: actor(CUSTOMER_B, 'CUSTOMER'),
  [TOKEN_OPERATOR]: actor(OPERATOR_ID, 'OPERATOR'),
  [TOKEN_SUPPORT]: actor(SUPPORT_ID, 'SUPPORT'),
};

const authenticate = async (token: string) => {
  const found = ACTORS[token];
  if (!found) throw new ApiError('UNAUTHENTICATED', 'Sign in again to continue');
  return { actor: found };
};

const TRUNCATE = `TRUNCATE support_v2_incident_messages, support_v2_rewashes, reviews_v2_moderation_events,
  support_v2_incidents, reviews_v2, orders_v2_timeline, orders_v2_adjustments, orders_v2_orders, orders_v2_quotes,
  identity_addresses, identity_staff, identity_profiles,
  v2_command_results, v2_audit, v2_outbox, v2_inbox CASCADE`;

let now: Date;
let support: SupportService;
let reviews: ReviewsService;
let approvedMedia: Set<string>;
const clock = () => now;

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/laundry_verify_')) {
    throw new Error('Disposable local PostgreSQL required');
  }
  await initializeDb();
  await getPool().query(readFileSync(new URL('../../../modules/schema/proposals/B08.sql', import.meta.url), 'utf8'));
});
beforeEach(async () => {
  await getPool().query(TRUNCATE);
  now = new Date('2026-10-26T02:00:00Z');
  approvedMedia = new Set();
  await getPool().query(`INSERT INTO identity_profiles (id,phone,active,created_at) VALUES
    ($1,'+919000080001',true,$3), ($2,'+919000080002',true,$3)`, [CUSTOMER_A, CUSTOMER_B, now]);
  await getPool().query(`INSERT INTO identity_staff (id,phone,role,created_at) VALUES
    ($1,'+919000090001','OPERATOR',$3), ($2,'+919000090002','SUPPORT',$3)`, [OPERATOR_ID, SUPPORT_ID, now]);
  await getPool().query(`INSERT INTO identity_addresses (id,owner_id,address,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$4)`, [
    randomUUID(), CUSTOMER_A, JSON.stringify({ label: 'Home', line1: '1 Synthetic Road', city: 'Bengaluru', postalCode: '560001', coordinates: { lat: 12.95, lng: 77.6 } }), now,
  ]);
  support = new SupportService({ db: getPool(), authenticate, clock });
  reviews = new ReviewsService({ db: getPool(), authenticate, clock, mediaApproval: async ids => ids.every(id => approvedMedia.has(id)) });
});
afterAll(closePool);

const lines = JSON.stringify([{ serviceId: SERVICE_ID, billingUnit: 'KG', estimatedWeightGrams: 1201 }]);
const window = { start: '2026-10-26T03:30:00.000Z', end: '2026-10-26T04:30:00.000Z', timezone: 'Asia/Kolkata' };
const address = { label: 'Home', line1: '1 Synthetic Road', city: 'Bengaluru', postalCode: '560001', coordinates: { lat: 12.95, lng: 77.6 } };

async function seedOrder(customerId = CUSTOMER_A, status: v2.OrderStatus = 'DELIVERED', version = 3): Promise<string> {
  const quoteId = randomUUID();
  await getPool().query(`INSERT INTO orders_v2_quotes
    (id,version,customer_id,status,area_id,address_id,address_snapshot,lines,rate_cards,breakdown,total_minor,currency,
     provisional,pickup_window,return_window,hold_reference,hold_expires_at,catalog_version,expires_at,created_at)
    VALUES ($1,1,$2,'BOOKED',$3,$4,$5,$6,'[]'::jsonb,'[]'::jsonb,6000,'INR',false,$7,$7,NULL,NULL,1,$8,$8)`, [
    quoteId, customerId, AREA_ID, randomUUID(), JSON.stringify(address), lines, JSON.stringify(window), now,
  ]);
  const orderId = randomUUID();
  await getPool().query(`INSERT INTO orders_v2_orders
    (id,version,status,customer_id,facility_id,quote_id,area_id,address_snapshot,lines,rate_cards,containers,
     measured_lines,total_minor,currency,payment_model,pickup_window,return_window,hold_id,resume_status,
     quality_check_passed,created_at,updated_at)
    VALUES ($1,$2,$3,$4,NULL,$5,$6,$7,$8,'[]'::jsonb,'[]'::jsonb,NULL,6000,'INR','DUE_AT_RETURN',$9,$9,NULL,NULL,true,$10,$10)`, [
    orderId, version, status, customerId, quoteId, AREA_ID, JSON.stringify(address), lines, JSON.stringify(window), now,
  ]);
  return orderId;
}

async function openIncident(orderId: string, token = TOKEN_A, category: v2.IncidentCategory = 'QUALITY') {
  return support.createIncident(token, orderId, { orderId, category, summary: 'A garment came back marked', mediaIds: [] }, key());
}

async function reviewFor(orderId: string, token = TOKEN_A, overrides: Partial<v2.ReviewInput> = {}) {
  return reviews.create(token, orderId, {
    orderId, expectedVersion: 3, overall: 4, comment: 'Clean and on time', mediaIds: [], publishConsent: true, ...overrides,
  }, key());
}

describe('B08-01 one verified review per delivered owned order', () => {
  it('refuses other customers and staff, then stores exactly one review', async () => {
    const orderId = await seedOrder();
    expect(await reviews.eligibility(TOKEN_A, orderId)).toEqual({ orderId, eligible: true });
    await expect(reviews.eligibility(TOKEN_B, orderId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(reviewFor(orderId, TOKEN_B)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(reviewFor(orderId, TOKEN_OPERATOR)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const reviewKey = key();
    const first = await reviews.create(TOKEN_A, orderId, {
      orderId, expectedVersion: 3, overall: 4, comment: 'Clean and on time', mediaIds: [], publishConsent: true,
    }, reviewKey);
    expect(first).toMatchObject({ orderId, customerId: CUSTOMER_A, publication: 'PENDING', publishConsent: true, version: 1 });
    expect(v2.reviewSchema.parse(first)).toEqual(first);

    const replay = await reviews.create(TOKEN_A, orderId, {
      orderId, expectedVersion: 3, overall: 4, comment: 'Clean and on time', mediaIds: [], publishConsent: true,
    }, reviewKey);
    expect(replay.id).toBe(first.id);
    expect((await getPool().query('SELECT count(*)::int AS n FROM reviews_v2')).rows[0].n).toBe(1);

    await expect(reviewFor(orderId)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await reviews.eligibility(TOKEN_A, orderId)).toEqual({
      orderId, eligible: false, reason: 'This order already has a review', existingReviewId: first.id,
    });
  });

  it('refuses an undelivered order and a stale order version', async () => {
    const undelivered = await seedOrder(CUSTOMER_A, 'RETURNING', 5);
    expect(await reviews.eligibility(TOKEN_A, undelivered)).toEqual({
      orderId: undelivered, eligible: false, reason: 'Reviews open after delivery',
    });
    await expect(reviews.create(TOKEN_A, undelivered, {
      orderId: undelivered, expectedVersion: 5, overall: 3, mediaIds: [], publishConsent: true,
    }, key())).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    const delivered = await seedOrder();
    await expect(reviews.create(TOKEN_A, delivered, {
      orderId: delivered, expectedVersion: 2, overall: 3, mediaIds: [], publishConsent: true,
    }, key())).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });
});

describe('B08-02 unconsented and unapproved content stays unpublished', () => {
  it('blocks publication without consent or approved media and hides rejected content', async () => {
    const noConsentOrder = await seedOrder();
    const noConsent = await reviewFor(noConsentOrder, TOKEN_A, { publishConsent: false });
    await expect(reviews.moderate(TOKEN_OPERATOR, noConsent.id, {
      expectedVersion: 1, decision: 'PUBLISH', reason: 'Looks fine',
    }, key())).rejects.toMatchObject({ code: 'REQUIRES_APPROVAL' });

    const mediaOrder = await seedOrder();
    const mediaId = randomUUID();
    const withMedia = await reviewFor(mediaOrder, TOKEN_A, { mediaIds: [mediaId] });
    await expect(reviews.moderate(TOKEN_OPERATOR, withMedia.id, {
      expectedVersion: 1, decision: 'PUBLISH', reason: 'Looks fine',
    }, key())).rejects.toMatchObject({ code: 'REQUIRES_APPROVAL' });
    expect((await reviews.publicReviews()).items).toEqual([]);

    approvedMedia.add(mediaId);
    const published = await reviews.moderate(TOKEN_OPERATOR, withMedia.id, {
      expectedVersion: 1, decision: 'PUBLISH', reason: 'Media checked by an operator',
    }, key());
    expect(published).toMatchObject({ publication: 'PUBLISHED', moderatedBy: OPERATOR_ID, moderationReason: 'Media checked by an operator' });
    expect(published.moderatedAt).toBe(now.toISOString());

    const feed = await reviews.publicReviews();
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({ id: withMedia.id, orderId: mediaOrder, displayName: 'Customer 0001', overall: 4 });
    expect(feed.items[0]).not.toHaveProperty('customerId');
    expect(feed.items[0]).not.toHaveProperty('publishConsent');

    const rejectedOrder = await seedOrder();
    const rejected = await reviewFor(rejectedOrder);
    const decision = await reviews.moderate(TOKEN_OPERATOR, rejected.id, { expectedVersion: 1, decision: 'REJECT', reason: 'Contains private details' }, key());
    expect(decision.publication).toBe('REJECTED');
    await expect(reviews.moderate(TOKEN_OPERATOR, rejected.id, { expectedVersion: 2, decision: 'PUBLISH', reason: 'Changed my mind' }, key()))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect((await reviews.publicReviews()).items.map(item => item.id)).toEqual([withMedia.id]);

    const hidden = await reviews.moderate(TOKEN_SUPPORT, withMedia.id, { expectedVersion: 2, decision: 'HIDE', reason: 'Customer asked for removal' }, key());
    expect(hidden.publication).toBe('REJECTED');
    expect((await reviews.publicReviews()).items).toEqual([]);
    expect((await getPool().query('SELECT count(*)::int AS n FROM reviews_v2_moderation_events WHERE review_id=$1', [withMedia.id])).rows[0].n).toBe(2);
  });

  it('rejects a stale moderation version with the current version', async () => {
    const orderId = await seedOrder();
    const review = await reviewFor(orderId);
    await expect(reviews.moderate(TOKEN_OPERATOR, review.id, { expectedVersion: 9, decision: 'PUBLISH', reason: 'Fine' }, key()))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 1 });
    expect((await getPool().query('SELECT publication FROM reviews_v2 WHERE id=$1', [review.id])).rows[0].publication).toBe('PENDING');
  });
});

describe('B08-03 audited incident resolution and a rewash that leaves the order alone', () => {
  it('records a rewash request without completing the original order', async () => {
    const orderId = await seedOrder();
    const incident = await openIncident(orderId);
    expect(incident).toMatchObject({ orderId, status: 'OPEN', category: 'QUALITY', version: 1 });

    const rewashKey = key();
    const rewash = await support.requestRewash(TOKEN_A, incident.id, { expectedVersion: 1, reason: 'Marks on two shirts' }, rewashKey);
    expect(rewash).toMatchObject({ incidentId: incident.id, orderId, status: 'REQUESTED', version: 1 });
    expect(rewash.completedAt).toBeUndefined();
    expect(v2.rewashRequestSchema.parse(rewash)).toEqual(rewash);

    const replay = await support.requestRewash(TOKEN_A, incident.id, { expectedVersion: 1, reason: 'Marks on two shirts' }, rewashKey);
    expect(replay.id).toBe(rewash.id);
    expect((await getPool().query('SELECT count(*)::int AS n FROM support_v2_rewashes')).rows[0].n).toBe(1);
    await expect(support.requestRewash(TOKEN_A, incident.id, { expectedVersion: 2, reason: 'Again' }, key()))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });

    const order = (await getPool().query('SELECT status,version FROM orders_v2_orders WHERE id=$1', [orderId])).rows[0];
    expect(order).toEqual({ status: 'DELIVERED', version: 3 });
    const stored = (await getPool().query('SELECT status,version,rewash_request_id FROM support_v2_incidents WHERE id=$1', [incident.id])).rows[0];
    expect(stored).toMatchObject({ status: 'OPEN', version: 2, rewash_request_id: rewash.id });
  });

  it('requires a named operator, a matching version and a reason to close', async () => {
    const orderId = await seedOrder();
    const incident = await openIncident(orderId);

    await expect(support.resolveIncident(TOKEN_A, incident.id, { expectedVersion: 1, outcome: 'REWORK', reason: 'Not my call' }, key()))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(support.resolveIncident(TOKEN_OPERATOR, incident.id, { expectedVersion: 7, outcome: 'REWORK', reason: 'Stale' }, key()))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 1 });

    const resolved = await support.resolveIncident(TOKEN_SUPPORT, incident.id, {
      expectedVersion: 1, outcome: 'REWORK', reason: 'Facility will wash the shirts again',
    }, key());
    expect(resolved).toMatchObject({
      status: 'RESOLVED', version: 2, resolution: 'Facility will wash the shirts again', resolvedAt: now.toISOString(),
    });
    const audit = (await getPool().query(
      "SELECT actor_id,reason FROM v2_audit WHERE aggregate_id=$1 AND action='INCIDENT_RESOLVED'", [incident.id])).rows;
    expect(audit).toEqual([{ actor_id: SUPPORT_ID, reason: 'Facility will wash the shirts again' }]);

    await expect(support.resolveIncident(TOKEN_OPERATOR, incident.id, { expectedVersion: 2, outcome: 'NO_ACTION', reason: 'Second opinion' }, key()))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });

    const refundOrder = await seedOrder();
    const refundIncident = await openIncident(refundOrder);
    await expect(support.resolveIncident(TOKEN_OPERATOR, refundIncident.id, {
      expectedVersion: 1, outcome: 'REFUND', reason: 'Refund without an amount',
    } as unknown as v2.IncidentResolutionInput, key())).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('refuses a rewash before the order came back and after the incident closed', async () => {
    const liveOrder = await seedOrder(CUSTOMER_A, 'IN_CARE', 4);
    const liveIncident = await openIncident(liveOrder);
    await expect(support.requestRewash(TOKEN_A, liveIncident.id, { expectedVersion: 1, reason: 'Too early' }, key()))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });

    const orderId = await seedOrder();
    const incident = await openIncident(orderId);
    await support.resolveIncident(TOKEN_OPERATOR, incident.id, { expectedVersion: 1, outcome: 'NO_ACTION', reason: 'Nothing wrong found' }, key());
    await expect(support.requestRewash(TOKEN_A, incident.id, { expectedVersion: 2, reason: 'Later thought' }, key()))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('B08-04 cross-scope access and duplicate mutation replay', () => {
  it('hides another customer incident and replays messages once with a sequential order', async () => {
    const orderId = await seedOrder();
    const incident = await openIncident(orderId);

    await expect(support.listMessages(TOKEN_B, incident.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(support.appendMessage(TOKEN_B, incident.id, { body: 'Let me in', mediaIds: [] }, key()))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(support.createIncident(TOKEN_B, orderId, { orderId, category: 'QUALITY', summary: 'Not mine', mediaIds: [] }, key()))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(support.listIncidents(TOKEN_OPERATOR)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const staffView = await support.listMessages(TOKEN_SUPPORT, incident.id);
    expect(staffView.items).toEqual([]);

    const messageKey = key();
    const first = await support.appendMessage(TOKEN_A, incident.id, { body: 'Two shirts are marked', mediaIds: [] }, messageKey);
    const replay = await support.appendMessage(TOKEN_A, incident.id, { body: 'Two shirts are marked', mediaIds: [] }, messageKey);
    expect(replay.id).toBe(first.id);
    const reply = await support.appendMessage(TOKEN_SUPPORT, incident.id, { body: 'Please send a photo', mediaIds: [] }, key());
    expect(reply.authorRole).toBe('SUPPORT');
    const storedMessages = (await getPool().query(
      'SELECT seq,author_role FROM support_v2_incident_messages WHERE incident_id=$1 ORDER BY seq', [incident.id])).rows;
    expect(storedMessages).toEqual([{ seq: 1, author_role: 'CUSTOMER' }, { seq: 2, author_role: 'SUPPORT' }]);

    const thread = await support.listMessages(TOKEN_A, incident.id);
    expect(thread.items.map(item => item.body)).toEqual(['Two shirts are marked', 'Please send a photo']);
  });

  it('replays an incident create once and refuses the same key with a different body', async () => {
    const orderId = await seedOrder();
    const createKey = key();
    const first = await support.createIncident(TOKEN_A, orderId, { orderId, category: 'QUALITY', summary: 'Marks', mediaIds: [] }, createKey);
    const replay = await support.createIncident(TOKEN_A, orderId, { orderId, category: 'QUALITY', summary: 'Marks', mediaIds: [] }, createKey);
    expect(replay.id).toBe(first.id);
    expect((await getPool().query('SELECT count(*)::int AS n FROM support_v2_incidents')).rows[0].n).toBe(1);
    await expect(support.createIncident(TOKEN_A, orderId, { orderId, category: 'LATE', summary: 'Different', mediaIds: [] }, createKey))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    const list = await support.listIncidents(TOKEN_A);
    expect(list.items.map(item => item.id)).toEqual([first.id]);
    expect((await support.listIncidents(TOKEN_B)).items).toEqual([]);
  });
});

describe('B08-05 public feed stays empty and moderation is audited once per decision', () => {
  it('publishes nothing before moderation and keeps one audit row per decision', async () => {
    const orderId = await seedOrder();
    const review = await reviewFor(orderId);
    expect((await reviews.publicReviews()).items).toEqual([]);
    expect((await reviews.publicReviews({ serviceId: SERVICE_ID })).items).toEqual([]);

    const published = await reviews.moderate(TOKEN_OPERATOR, review.id, { expectedVersion: 1, decision: 'PUBLISH', reason: 'Consented and clean' }, key());
    expect(published.publication).toBe('PUBLISHED');
    const feed = await reviews.publicReviews({ serviceId: SERVICE_ID });
    expect(feed.items.map(item => item.id)).toEqual([review.id]);
    expect((await reviews.publicReviews({ serviceId: randomUUID() })).items).toEqual([]);

    const audit = (await getPool().query("SELECT count(*)::int AS n FROM v2_audit WHERE aggregate_id=$1 AND action='REVIEW_MODERATED'", [review.id])).rows[0].n;
    expect(audit).toBe(1);
    expect((await getPool().query('SELECT count(*)::int AS n FROM reviews_v2_moderation_events WHERE review_id=$1', [review.id])).rows[0].n).toBe(1);
  });
});

describe('B08 routes through the real SDK over HTTP', () => {
  class B08Root {}
  Module({ imports: [SupportModule.register(() => support), ReviewsModule.register(() => reviews)] })(B08Root);

  let app: NestExpressApplication;
  let base: string;
  beforeEach(async () => {
    app = await NestFactory.create<NestExpressApplication>(B08Root, { logger: false, abortOnError: false });
    configureHttpBody(app);
    app.useGlobalFilters(new EnvelopeFilter());
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()) + '/v2';
  });
  afterEach(async () => { await app?.close(); });

  it('serves incidents, rewash, reviews, eligibility and the public feed with envelopes', async () => {
    const orderId = await seedOrder();
    let bearer: string | undefined = TOKEN_A;
    const client = createV2Client({ baseUrl: base, getToken: () => bearer });

    const incident = await client.createIncident({ orderId, category: 'QUALITY', summary: 'A mark on one shirt', mediaIds: [] });
    expect((await client.listIncidents()).items.map(item => item.id)).toEqual([incident.id]);
    const message = await client.postIncidentMessage(incident.id, { body: 'Photo attached in the app', mediaIds: [] });
    expect(message.authorRole).toBe('CUSTOMER');
    expect((await client.listIncidentMessages(incident.id)).items.map(item => item.body)).toEqual(['Photo attached in the app']);
    const rewash = await client.requestRewash(incident.id, { expectedVersion: 1, reason: 'Please rewash' });
    expect(rewash.status).toBe('REQUESTED');

    const review = await client.createReview({
      orderId, expectedVersion: 3, overall: 5, serviceScore: 5, deliveryScore: 4, comment: 'Crisp folds', mediaIds: [], publishConsent: true,
    });
    expect(review.publication).toBe('PENDING');
    expect(await client.getReviewEligibility(orderId)).toMatchObject({ eligible: false, existingReviewId: review.id });
    expect((await client.listPublicReviews(SERVICE_ID)).items).toEqual([]);

    bearer = TOKEN_OPERATOR;
    const resolved = await fetch(base + `/ops/incidents/${incident.id}/resolve`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'idempotency-key': key(), 'content-type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 2, outcome: 'REWORK', reason: 'Rewash approved' }),
    });
    expect(resolved.status).toBe(200);
    expect(v2.incidentSchema.parse(await resolved.json())).toMatchObject({ status: 'RESOLVED' });

    const moderated = await fetch(base + `/ops/reviews/${review.id}/moderation`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'idempotency-key': key(), 'content-type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1, decision: 'PUBLISH', reason: 'Consented review' }),
    });
    expect(moderated.status).toBe(200);
    expect(v2.reviewSchema.parse(await moderated.json()).publication).toBe('PUBLISHED');
    expect((await client.listPublicReviews(SERVICE_ID)).items.map(item => item.id)).toEqual([review.id]);

    bearer = TOKEN_B;
    const crossScope = await fetch(base + `/incidents/${incident.id}/messages`, { headers: { authorization: `Bearer ${bearer}` } });
    expect(crossScope.status).toBe(404);
    expect(v2.errorEnvelopeSchema.parse(await crossScope.json()).code).toBe('NOT_FOUND');

    bearer = undefined;
    const anonymous = await fetch(base + '/incidents');
    expect(anonymous.status).toBe(401);
    expect(v2.errorEnvelopeSchema.parse(await anonymous.json()).code).toBe('UNAUTHENTICATED');
  });
});
