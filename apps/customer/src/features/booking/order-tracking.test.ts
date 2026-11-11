import { describe, expect, it } from 'vitest';
import { v2 } from '@laundry/contracts';
import { orderStatusView, deliveryLegView, formatTrackingTime, formatTrackingWindow, recordedHistory, custodyView } from './order-tracking';

describe('customer tracking is recorded evidence, not a synthetic progress bar', () => {
  it.each(v2.orderStatusSchema.options)('explains %s without exposing an enum', status => {
    const view = orderStatusView(status);
    expect(view.title.length).toBeGreaterThan(3);
    expect(view.detail.length).toBeGreaterThan(20);
    expect(view.title).not.toMatch(/_|^[A-Z ]+$/);
    expect(view.attention).toBe(['AWAITING_ADJUSTMENT', 'ON_HOLD', 'RESOLUTION_REQUIRED', 'CANCEL_REQUESTED'].includes(status));
  });
  it('keeps cancellation and holds separate from successful delivery', () => {
    for (const status of ['ON_HOLD', 'CANCELLED', 'CANCEL_REQUESTED', 'RESOLUTION_REQUIRED'] as const) {
      expect(orderStatusView(status).title).not.toMatch(/delivered|cleaned|complete/i);
    }
    expect(orderStatusView('DELIVERED').detail).toMatch(/payment.*separate/i);
    expect(orderStatusView('RETURNING').detail).toMatch(/not.*delivered/i);
  });
  it('renders only stored milestones in their server sequence, including repeated care states', () => {
    const events: v2.OrderTimelineEvent[] = [
      { status: 'IN_CARE', label: 'Care started', at: '2026-11-11T08:00:00Z' },
      { status: 'QUALITY_CHECK', label: 'QC recorded', at: '2026-11-11T07:59:00Z' },
      { status: 'IN_CARE', label: 'Rewash started', at: '2026-11-11T08:02:00Z', reason: 'Quality check needs another wash' },
    ];
    const history = recordedHistory(events, 'Asia/Kolkata');
    expect(history.map(event => event.label)).toEqual(['Care started', 'QC recorded', 'Rewash started']);
    expect(history[2]?.reason).toBe('Quality check needs another wash');
    expect(history[2]?.time).toContain('13:32');
    expect(recordedHistory([], 'Asia/Kolkata')).toEqual([]);
    expect(history).toHaveLength(3); // No invented pickup, return or delivered steps.
  });
  it.each(v2.legAttemptStatusSchema.options)('explains dispatch %s independently of order and payment', status => {
    const view = deliveryLegView({ leg: 'PICKUP', status, version: 1 });
    expect(view.title).toBe('Pickup');
    expect(view.detail).not.toContain('_');
    expect(view.detail).not.toMatch(/paid|payment settled|order delivered/i);
  });
  it('keeps unknown/failed legs visible and never infers completed pickup from assignment', () => {
    expect(deliveryLegView({ leg: 'RETURN', status: 'BOOKING_UNKNOWN', version: 1 }).detail).toMatch(/not confirmed/i);
    expect(deliveryLegView({ leg: 'PICKUP', status: 'ASSIGNED', version: 1 }).detail).toMatch(/not.*handover/i);
    expect(deliveryLegView({ leg: 'RETURN', status: 'FUTURE_STATUS', version: 1 }).detail).toBe('Dispatch update unavailable. Refresh or contact support.');
    expect(deliveryLegView({ leg: 'RETURN', status: 'COMPLETED', version: 1, completedAt: '2026-11-11T08:00:00Z' }).completedAt).toBe('2026-11-11T08:00:00Z');
  });
  it('formats the service timezone, including overnight windows, rather than device time', () => {
    expect(formatTrackingTime('2026-11-11T20:30:00Z', 'Asia/Kolkata')).toContain('12 Nov');
    const window = formatTrackingWindow({ start: '2026-11-11T17:30:00Z', end: '2026-11-11T20:30:00Z', timezone: 'Asia/Kolkata' });
    expect(window).toContain('11 Nov'); expect(window).toContain('12 Nov'); expect(window).toContain('Asia/Kolkata');
    expect(formatTrackingTime('bad', 'Asia/Kolkata')).toBe('Time unavailable');
    expect(formatTrackingTime('2026-11-11T08:00:00Z', 'Not/AZone')).toContain('UTC');
  });
  it('does not turn missing custody measurements into zeros or a paid balance', () => {
    const receipt: v2.CustodyReceipt = { orderId: '00000000-0000-4000-8000-000000000001', estimatedQuantity: 2, sealedContainerCount: 0, amountDueAtReturnMinor: 10000, currency: 'INR', currentHandoff: 'PICKED_UP', updatedAt: '2026-11-11T08:00:00Z' };
    expect(custodyView(receipt)).toEqual({ handoff: 'Pickup handover recorded', declared: 'Not recorded', counted: 'Not recorded', weight: 'Not recorded', sealed: '0' });
    expect(custodyView({ ...receipt, countedQuantity: 0, measuredWeightGrams: 0, declaredGarmentCount: 0 })).toMatchObject({ declared: '0', counted: '0', weight: '0 kg' });
  });
  it.each(v2.custodyReceiptSchema.shape.currentHandoff.options)('explains custody %s without implying a live position', currentHandoff => {
    const view = custodyView({ orderId: '00000000-0000-4000-8000-000000000001', estimatedQuantity: 0, sealedContainerCount: 0, amountDueAtReturnMinor: 0, currency: 'INR', currentHandoff, updatedAt: '2026-11-11T08:00:00Z' });
    expect(view.handoff).not.toContain('_');
    expect(view.handoff).not.toMatch(/GPS|live|paid/i);
  });
});
