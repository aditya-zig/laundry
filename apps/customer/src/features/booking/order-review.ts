import { v2 } from '@laundry/contracts';
import { StorageError, type QueuedMutationRecord } from '@laundry/app-foundation';

export type ReviewDraft = { overall: number; comment: string; publishConsent: boolean };
export type ReviewIntent = { body: v2.ReviewInput; retainedKey: string };

/** A click over server eligibility and exact order version, never a default rating. */
export function reviewFor(order: Pick<v2.Order, 'id' | 'status' | 'version'>, eligibility: v2.ReviewEligibility, draft: ReviewDraft): v2.ReviewInput {
  if (order.status !== 'DELIVERED' || eligibility.orderId !== order.id || !eligibility.eligible || eligibility.existingReviewId) {
    throw new Error('This order is not currently eligible for a new review. Refresh its recorded status first.');
  }
  return v2.reviewInputSchema.parse({ orderId: order.id, expectedVersion: order.version,
    overall: draft.overall, comment: draft.comment, publishConsent: draft.publishConsent, mediaIds: [] });
}

/** Only actor-filtered records from foundation.listQueuedMutations are accepted. */
export function pendingReview(records: readonly QueuedMutationRecord[], orderId: string): ReviewIntent | null {
  let retained: ReviewIntent | null = null;
  for (const record of records) {
    if (record.routeId !== 'reviews.create') continue;
    let body: v2.ReviewInput;
    try { body = v2.reviewInputSchema.parse(JSON.parse(record.bodyJson ?? 'null')); }
    catch (cause) { throw new StorageError('A saved review is corrupt. Reconcile it before submitting another.', cause); }
    if (body.orderId !== orderId) continue;
    if (retained || !record.idempotencyKey || Object.keys(record.params).length !== 0) {
      throw new StorageError('The saved review cannot be safely identified. Reconcile it before submitting another.');
    }
    retained = { body, retainedKey: record.idempotencyKey };
  }
  return retained;
}
