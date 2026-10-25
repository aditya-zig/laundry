import { describe, expect, it } from 'vitest';
import { v2 } from '@laundry/contracts';
import { v2WireFixtures } from '@laundry/test-fixtures';
import { adjustmentDecisionFor, pendingAdjustmentDecision } from './adjustment-decision';
const now = new Date('2026-10-26T10:00:00Z');
const proposal = { id: '00000000-0000-4000-8000-000000000044', version: 3, reason: 'Synthetic measured-weight difference', previousTotalMinor: v2WireFixtures.Order.totalMinor, newTotalMinor: v2WireFixtures.Order.totalMinor + 500, deltaMinor: 500, state: 'PROPOSED', expiresAt: '2026-10-26T10:30:00Z' };
const order = (overrides: Partial<v2.Order> = {}) => v2.orderSchema.parse({ ...v2WireFixtures.Order, status: 'AWAITING_ADJUSTMENT', adjustment: proposal, permittedActions: ['ACCEPT_ADJUSTMENT', 'DECLINE_ADJUSTMENT'], ...overrides });
describe('explicit customer adjustment decisions', () => {
  it.each(['ACCEPT', 'DECLINE'] as const)('keeps the server order and proposal versions for %s', decision => {
    const current = order();
    expect(adjustmentDecisionFor(current, decision, now)).toEqual({ adjustmentId: proposal.id, adjustmentVersion: 3, expectedVersion: current.version, decision });
  });
  it('does not infer consent when rights are missing or the order is no longer waiting', () => {
    expect(() => adjustmentDecisionFor(order({ permittedActions: [] }), 'ACCEPT', now)).toThrow();
    expect(() => adjustmentDecisionFor(order({ status: 'ON_HOLD' }), 'DECLINE', now)).toThrow();
    expect(() => adjustmentDecisionFor(order({ adjustment: undefined }), 'ACCEPT', now)).toThrow();
  });
  it('refuses expired terms and an unusable clock', () => {
    expect(() => adjustmentDecisionFor(order(), 'ACCEPT', new Date(proposal.expiresAt))).toThrow();
    expect(() => adjustmentDecisionFor(order(), 'ACCEPT', new Date(NaN))).toThrow();
  });
  it('restores only this order’s retained, validated decision and refuses ambiguous recovery', () => {
    const current = order(), body = adjustmentDecisionFor(current, 'DECLINE', now);
    const record = { routeId: 'orders.adjustment.decide', params: { orderId: current.id }, bodyJson: JSON.stringify(body), idempotencyKey: 'synthetic-original', actorId: current.customerId, createdAt: now.toISOString() };
    expect(pendingAdjustmentDecision([record], current.id)).toEqual(body);
    expect(pendingAdjustmentDecision([record], '00000000-0000-4000-8000-000000000099')).toBeNull();
    expect(() => pendingAdjustmentDecision([record, { ...record, idempotencyKey: 'another-intent' }], current.id)).toThrow();
    expect(() => pendingAdjustmentDecision([{ ...record, bodyJson: '{}' }], current.id)).toThrow();
  });
});
