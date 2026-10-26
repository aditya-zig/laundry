import { describe, expect, it } from 'vitest';
import { v2WireFixtures } from '@laundry/test-fixtures';
import type { QueuedMutationRecord } from '@laundry/app-foundation';
import { reviewFor, pendingReview } from '../src/features/booking/order-review';

const order = { ...v2WireFixtures.Order, status: 'DELIVERED' as const };
const eligibility = { orderId: order.id, eligible: true };
const draft = { overall: 4, comment: '  Clothes returned as agreed.  ', publishConsent: false };
const queued = (body: unknown, key = 'synthetic-review-key'): QueuedMutationRecord => ({
  actorId: v2WireFixtures.Actor.id, routeId: 'reviews.create', params: {},
  bodyJson: JSON.stringify(body),
  idempotencyKey: key, createdAt: '2026-10-26T10:00:00.000Z',
});

describe('customer post-delivery review intent', () => {
  it('uses exact order/version, no invented media, trimmed feedback and explicit private consent', () => {
    expect(reviewFor(order, eligibility, draft)).toEqual({ orderId: order.id, expectedVersion: order.version, overall: 4, comment: 'Clothes returned as agreed.', mediaIds: [], publishConsent: false });
    expect(reviewFor(order, eligibility, { ...draft, publishConsent: true }).publishConsent).toBe(true);
    const strayFields = { ...draft, orderId: v2WireFixtures.Actor.id, expectedVersion: 900, mediaIds: [order.id] };
    expect(reviewFor(order, eligibility, strayFields)).toEqual(reviewFor(order, eligibility, draft));
  });
  it('requires both delivered order and matching server eligibility', () => {
    expect(() => reviewFor({ ...order, status: 'RETURNING' }, eligibility, draft)).toThrow();
    expect(() => reviewFor(order, { ...eligibility, eligible: false }, draft)).toThrow();
    expect(() => reviewFor(order, { ...eligibility, orderId: v2WireFixtures.Actor.id }, draft)).toThrow();
    expect(() => reviewFor(order, { ...eligibility, existingReviewId: order.id }, draft)).toThrow();
  });
  it('requires an actual 1–5 selection and validates comment length', () => {
    for (const overall of [0, 6, 1.5, NaN]) expect(() => reviewFor(order, eligibility, { ...draft, overall })).toThrow();
    expect(() => reviewFor(order, eligibility, { ...draft, comment: 'x'.repeat(5001) })).toThrow();
  });
  it('restores the exact frozen review/key rather than current draft or order version', () => {
    const body = reviewFor(order, eligibility, draft);
    const record = queued(body);
    expect(pendingReview([record], order.id)).toEqual({ body, retainedKey: record.idempotencyKey });
    expect(pendingReview([{ ...record, routeId: 'orders.book' }], order.id)).toBeNull();
    expect(pendingReview([record], v2WireFixtures.Actor.id)).toBeNull();
  });
  it('fails closed for corrupt or ambiguous retained reviews', () => {
    expect(() => pendingReview([{ ...queued(null), bodyJson: '{' }], order.id)).toThrow();
    const body = reviewFor(order, eligibility, draft);
    expect(() => pendingReview([queued(body), queued(body, 'another-key')], order.id)).toThrow();
  });
});
