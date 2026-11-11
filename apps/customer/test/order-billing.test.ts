import { describe, expect, it } from 'vitest';
import { v2 } from '@laundry/contracts';
import { appendBillingPage, checkedBillingPage, obligationView, paymentModelLabel, receiptLabel, refundLabel } from '../src/features/booking/order-billing';

const obligation = (status: v2.ObligationStatus, settled: number, due = 10000) => v2.obligationSchema.parse({
  id: '11111111-1111-4111-8111-111111111111', orderId: '22222222-2222-4222-8222-222222222222',
  status, amountDueMinor: due, amountSettledMinor: settled, currency: 'INR', paymentModel: 'DUE_AT_RETURN',
  dueAt: '2026-10-28T10:00:00Z', version: 2, ...(status === 'VOID' ? { voidReason: 'Explicit synthetic waiver' } : {}),
});
describe('customer billing records remain separate from delivery and payment model', () => {
  it('labels the arrangement without asserting that payment is still due or was captured', () => {
    expect(paymentModelLabel('DUE_AT_RETURN')).toBe('Pay-on-return model');
    expect(paymentModelLabel('PREPAID_V1')).toBe('Prepaid payment model');
  });
  it('uses integer obligation amounts for partial settlement', () => {
    expect(obligationView(obligation('PARTIALLY_SETTLED', 4500))).toEqual({ label: 'Partially settled', remainingMinor: 5500 });
    expect(obligationView(obligation('OPEN', 0))).toEqual({ label: 'Open obligation', remainingMinor: 10000 });
  });
  it('does not convert zero due or a waiver into received payment', () => {
    expect(obligationView(obligation('OPEN', 0, 0))).toEqual({ label: 'Open obligation', remainingMinor: 0 });
    expect(obligationView(obligation('VOID', 0, 0))).toEqual({ label: 'Voided obligation', remainingMinor: 0 });
  });
  it('recognizes settlement only from the obligation record', () => {
    expect(obligationView(obligation('SETTLED', 10000))).toEqual({ label: 'Settled obligation', remainingMinor: 0 });
  });
  it('never presents a manual cash/UPI receipt as gateway capture', () => {
    expect(receiptLabel('MANUAL_CASH')).toBe('Manual cash confirmation');
    expect(receiptLabel('MANUAL_UPI')).toBe('Manual UPI confirmation');
    expect(receiptLabel('GATEWAY_CAPTURE')).toBe('Gateway capture recorded');
  });
  it('keeps unconfirmed, requested and processing refunds distinct from returned funds', () => {
    expect(refundLabel('OUTCOME_UNKNOWN')).toBe('Refund outcome unconfirmed');
    expect(refundLabel('REQUESTED')).toBe('Refund requested');
    expect(refundLabel('PROCESSING')).toBe('Refund processing');
    expect(refundLabel('SUCCEEDED')).toBe('Refund succeeded');
    expect(refundLabel('FAILED')).toBe('Refund failed');
  });
  it('does not treat a truncated page without a cursor as complete', () => {
    expect(() => checkedBillingPage({ items: [], pageInfo: { hasMore: true } })).toThrow('continuation cursor');
    expect(checkedBillingPage({ items: [], pageInfo: { hasMore: false } }).items).toEqual([]);
  });
  it('rejects non-advancing pagination rather than silently looping over one page', () => {
    const page = { items: [{ id: 'a' }], pageInfo: { hasMore: true, nextCursor: 'same' } };
    expect(() => appendBillingPage(page, page)).toThrow('did not advance');
  });
  it('retains loaded records, replaces repeated ids, and preserves the next page cursor', () => {
    expect(appendBillingPage({ items: [{ id: 'a', version: 1 }], pageInfo: { hasMore: true, nextCursor: 'first' } },
      { items: [{ id: 'a', version: 2 }, { id: 'b', version: 1 }], pageInfo: { hasMore: true, nextCursor: 'opaque+/=' } }))
      .toEqual({ items: [{ id: 'a', version: 2 }, { id: 'b', version: 1 }], pageInfo: { hasMore: true, nextCursor: 'opaque+/=' } });
  });
});
