import { describe, expect, it } from 'vitest';
import { v2 } from '@laundry/contracts';
import type { QueuedMutationRecord } from '@laundry/app-foundation';
import { appendSupportPage, canStaffReply, checkedSupportPage, retainedStaffReply } from '../src/features/supportActions';

const incidentId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const record = (overrides: Partial<QueuedMutationRecord> = {}): QueuedMutationRecord => ({
  idempotencyKey: 'original-staff-reply-key', routeId: 'support.incidents.messages', params: { incidentId },
  actorId, identityKey: 'synthetic-staff-scope', bodyJson: JSON.stringify({ body: 'Synthetic acknowledgement', mediaIds: [] }),
  createdAt: '2026-10-26T03:30:00.000Z', ...overrides,
});

describe('staff reply retention', () => {
  it('restores only the exact retained body, case and key', () => {
    expect(retainedStaffReply([record()], incidentId, actorId)).toEqual({
      routeId: 'support.incidents.messages', params: { incidentId },
      body: { body: 'Synthetic acknowledgement', mediaIds: [] }, retainedKey: 'original-staff-reply-key',
    });
  });
  it('does not select another actor, route or case', () => {
    expect(retainedStaffReply([
      record({ actorId: incidentId }), record({ routeId: 'billing.manual.confirm' }),
      record({ params: { incidentId: actorId } }),
    ], incidentId, actorId)).toBeNull();
  });
  it.each([
    { bodyJson: '{broken' },
    { bodyJson: JSON.stringify({ body: ' Synthetic acknowledgement ', mediaIds: [] }) },
    { bodyJson: JSON.stringify({ body: 'Synthetic acknowledgement', mediaIds: [], extra: 'must not be stripped' }) },
    { params: { incidentId, extra: 'must not be stripped' } },
    { idempotencyKey: '' },
  ])('rejects a malformed or altered retained intent instead of making a new key: %j', invalid => {
    expect(() => retainedStaffReply([record(invalid)], incidentId, actorId)).toThrow('Reconcile it without creating a replacement');
  });
  it('blocks ambiguous multiple retained replies', () => {
    expect(() => retainedStaffReply([record(), record({ idempotencyKey: 'second-key' })], incidentId, actorId)).toThrow('Multiple retained replies');
  });
});

describe('staff support paging and reply gate', () => {
  it('does not treat missing continuation or an empty continuing page as complete', () => {
    expect(() => checkedSupportPage({ items: [{ id: incidentId }], pageInfo: { hasMore: true } })).toThrow('continuation is missing');
    expect(() => checkedSupportPage({ items: [], pageInfo: { hasMore: true, nextCursor: 'cursor' } })).toThrow('continuation is missing');
  });
  it('merges pages by id without silently losing prior cases or making a cursor loop', () => {
    const first = { items: [{ id: incidentId, body: 'old' }], pageInfo: { hasMore: true, nextCursor: 'one' } };
    expect(appendSupportPage(first, { items: [{ id: incidentId, body: 'updated' }, { id: actorId, body: 'next' }], pageInfo: { hasMore: false } })).toEqual({
      items: [{ id: incidentId, body: 'updated' }, { id: actorId, body: 'next' }], pageInfo: { hasMore: false },
    });
    expect(() => appendSupportPage(first, { items: [{ id: actorId, body: 'next' }], pageInfo: { hasMore: true, nextCursor: 'one' } })).toThrow('did not advance');
  });
  it('requires the complete thread and no retained command, and never reopens closed cases', () => {
    const incident = v2.incidentSchema.parse({ id: incidentId, orderId: actorId, status: 'OPEN', category: 'OTHER', summary: 'Synthetic concern', mediaIds: [], createdAt: '2026-10-26T03:30:00Z', updatedAt: '2026-10-26T03:30:00Z', version: 1 });
    const complete = { items: [], pageInfo: { hasMore: false } };
    expect(canStaffReply(incident, complete, false)).toBe(true);
    expect(canStaffReply(incident, null, false)).toBe(false);
    expect(canStaffReply(incident, { items: [], pageInfo: { hasMore: true, nextCursor: 'cursor' } }, false)).toBe(false);
    expect(canStaffReply(incident, complete, true)).toBe(false);
    for (const status of ['RESOLVED', 'REJECTED'] as const) expect(canStaffReply(v2.incidentSchema.parse({ ...incident, status, resolvedAt: incident.updatedAt, resolution: 'Synthetic closure reason' }), complete, false)).toBe(false);
  });
});
