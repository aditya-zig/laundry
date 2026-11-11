import type { v2 } from '@laundry/contracts';

/** Model, obligation, receipt and refund are distinct records; never use delivery as payment proof. */
export function paymentModelLabel(model: v2.PaymentModel): string {
  return model === 'DUE_AT_RETURN' ? 'Pay-on-return model' : 'Prepaid payment model';
}
export function obligationView(value: v2.Obligation) {
  const labels: Record<v2.ObligationStatus, string> = {
    OPEN: 'Open obligation', PARTIALLY_SETTLED: 'Partially settled', SETTLED: 'Settled obligation', VOID: 'Voided obligation',
  };
  return { label: labels[value.status], remainingMinor: value.amountDueMinor - value.amountSettledMinor };
}
export function receiptLabel(confirmation: v2.ReceiptConfirmation): string {
  const labels: Record<v2.ReceiptConfirmation, string> = {
    MANUAL_CASH: 'Manual cash confirmation', MANUAL_UPI: 'Manual UPI confirmation', GATEWAY_CAPTURE: 'Gateway capture recorded',
  };
  return labels[confirmation];
}
export function refundLabel(status: v2.RefundStatus): string {
  const labels: Record<v2.RefundStatus, string> = {
    REQUESTED: 'Refund requested', PROCESSING: 'Refund processing', SUCCEEDED: 'Refund succeeded',
    FAILED: 'Refund failed', OUTCOME_UNKNOWN: 'Refund outcome unconfirmed',
  };
  return labels[status];
}
export function checkedBillingPage<T>(value: v2.Page<T>): v2.Page<T> {
  if (value.pageInfo.hasMore && !value.pageInfo.nextCursor) throw new Error('Payment records are incomplete: the server did not provide a continuation cursor.');
  return value;
}
export function appendBillingPage<T extends { id: string }>(previous: v2.Page<T>, next: v2.Page<T>): v2.Page<T> {
  checkedBillingPage(next);
  if (next.pageInfo.hasMore && next.pageInfo.nextCursor === previous.pageInfo.nextCursor) throw new Error('Payment pagination did not advance; refresh or contact support.');
  return { ...next, items: [...new Map([...previous.items, ...next.items].map(value => [value.id, value])).values()] };
}
