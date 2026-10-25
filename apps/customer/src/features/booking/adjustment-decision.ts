import { v2 } from '@laundry/contracts';
import type { QueuedMutationRecord } from '@laundry/app-foundation';

export function adjustmentDecisionFor(order: v2.Order, decision: v2.AdjustmentDecision['decision'], now = new Date()): v2.AdjustmentDecision {
  const proposal = order.adjustment;
  const action = decision === 'ACCEPT' ? 'ACCEPT_ADJUSTMENT' : 'DECLINE_ADJUSTMENT';
  if (order.status !== 'AWAITING_ADJUSTMENT' || proposal?.state !== 'PROPOSED' || !order.permittedActions.includes(action)) throw new Error('No current permitted adjustment decision. Refresh the order.');
  if (!Number.isFinite(now.getTime()) || Date.parse(proposal.expiresAt) <= now.getTime()) throw new Error('These terms expired. Refresh the order before deciding.');
  return v2.adjustmentDecisionSchema.parse({ adjustmentId: proposal.id, adjustmentVersion: proposal.version, expectedVersion: order.version, decision });
}

export function pendingAdjustmentDecision(records: QueuedMutationRecord[], orderId: string): v2.AdjustmentDecision | null {
  const matches = records.filter(record => record.routeId === 'orders.adjustment.decide' && record.params.orderId === orderId);
  if (matches.length > 1) throw new Error('Several unresolved decisions exist. Reconcile the order before submitting another decision.');
  if (!matches.length) return null;
  return v2.adjustmentDecisionSchema.parse(JSON.parse(matches[0].bodyJson ?? 'null'));
}
