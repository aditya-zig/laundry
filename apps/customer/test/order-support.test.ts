import { describe, expect, it } from 'vitest';
import { v2WireFixtures } from '@laundry/test-fixtures';
import type { QueuedMutationRecord } from '@laundry/app-foundation';
import { incidentFor, incidentMessageFor, pendingSupport } from '../src/features/booking/order-support';

const orderId = v2WireFixtures.Order.id;
const incidentId = v2WireFixtures.Incident.id;
const draft = { category: 'QUALITY', summary: '  Synthetic care concern  ', detail: '  Please inspect the cuff.  ' };
const queued = (routeId: string, body: unknown, params: Record<string, string> = {}, idempotencyKey = 'synthetic-support-key'): QueuedMutationRecord => ({
  actorId: v2WireFixtures.Actor.id, routeId, params, bodyJson: JSON.stringify(body), idempotencyKey, createdAt: '2026-10-26T10:00:00.000Z',
});

describe('customer owned-order support intents', () => {
  it('uses the explicit order/category/text, strips surrounding space and never invents media', () => {
    const strayFields = { ...draft, orderId: v2WireFixtures.Actor.id, mediaIds: [orderId] };
    const body = incidentFor(orderId, strayFields);
    expect(body).toEqual({ orderId, category: 'QUALITY', summary: 'Synthetic care concern', detail: 'Please inspect the cuff.', mediaIds: [] });
    expect(incidentFor(orderId, { ...draft, detail: '  ' }).detail).toBeUndefined();
  });
  it('requires a real category/summary and enforces server text limits', () => {
    for (const category of ['', 'UNKNOWN']) expect(() => incidentFor(orderId, { ...draft, category })).toThrow();
    for (const summary of [' ', 'x'.repeat(2001)]) expect(() => incidentFor(orderId, { ...draft, summary })).toThrow();
    expect(() => incidentFor(orderId, { ...draft, detail: 'x'.repeat(2001) })).toThrow();
    expect(incidentMessageFor('  Synthetic follow-up  ')).toEqual({ body: 'Synthetic follow-up', mediaIds: [] });
    for (const body of [' ', 'x'.repeat(5001)]) expect(() => incidentMessageFor(body)).toThrow();
  });
  it('restores exact independent case/message bodies, parameters and keys for this context', () => {
    const body = incidentFor(orderId, draft), message = incidentMessageFor('Synthetic follow-up');
    const records = [queued('support.incidents.create', body), queued('support.incidents.messages', message, { incidentId }, 'message-key')];
    expect(pendingSupport(records, orderId, incidentId)).toEqual({
      incident: { body, params: {}, retainedKey: 'synthetic-support-key' }, message: { body: message, params: { incidentId }, retainedKey: 'message-key' },
    });
    expect(pendingSupport(records, v2WireFixtures.Actor.id)).toEqual({ incident: null, message: null });
    expect(pendingSupport([queued('reviews.create', null)], orderId, incidentId)).toEqual({ incident: null, message: null });
  });
  it('does not turn a message for another case into this case or rewrite retained attachments', () => {
    const body = { ...incidentMessageFor('Previously attached media'), mediaIds: [orderId] };
    const record = queued('support.incidents.messages', body, { incidentId });
    expect(pendingSupport([record], orderId, v2WireFixtures.Actor.id).message).toBeNull();
    expect(pendingSupport([record], orderId, incidentId).message?.body).toEqual(body);
  });
  it('blocks corrupt, mismatched and ambiguous retained records instead of choosing a new key', () => {
    const body = incidentFor(orderId, draft), record = queued('support.incidents.create', body);
    expect(() => pendingSupport([{ ...record, bodyJson: '{' }], orderId)).toThrow();
    expect(() => pendingSupport([{ ...record, params: { orderId: v2WireFixtures.Actor.id } }], orderId)).toThrow();
    expect(() => pendingSupport([record, { ...record, idempotencyKey: 'second-case-key' }], orderId)).toThrow();
    expect(() => pendingSupport([{ ...record, idempotencyKey: ' ' }], orderId)).toThrow();
    const message = queued('support.incidents.messages', incidentMessageFor('Follow-up'), { incidentId });
    expect(() => pendingSupport([message, { ...message, idempotencyKey: 'second-message-key' }], orderId, incidentId)).toThrow();
  });
});
