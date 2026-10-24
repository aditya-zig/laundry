import { describe, expect, it } from 'vitest';
import { canOfferCancellation, trackingProgress } from '../src/tracking';

describe('authoritative customer progress', () => {
  it('does not leave returning pending after proved delivery with sparse history', () => {
    const progress = trackingProgress('DELIVERED', [{ status: 'READY_FOR_RETURN' }, { status: 'DELIVERED' }]);
    expect(progress).toHaveLength(8);
    expect(progress.every(step => step.label === 'Done')).toBe(true);
  });

  it('distinguishes a pickup in progress from completed pickup and future care', () => {
    expect(trackingProgress('PICKUP_PENDING', [])).toEqual([
      { status: 'CONFIRMED', label: 'Done' },
      { status: 'PICKUP_PENDING', label: 'Current' },
      ...['AT_FACILITY', 'IN_CARE', 'QUALITY_CHECK', 'READY_FOR_RETURN', 'RETURNING', 'DELIVERED'].map(status => ({ status, label: 'Pending' })),
    ]);
  });

  it('does not mark delivery complete while the return is still in progress', () => {
    expect(trackingProgress('RETURNING', []).slice(-2)).toEqual([
      { status: 'RETURNING', label: 'Current' }, { status: 'DELIVERED', label: 'Pending' },
    ]);
  });

  it.each(['CANCELLED', 'CANCEL_REQUESTED', 'ON_HOLD', 'AWAITING_ADJUSTMENT', 'RESOLUTION_REQUIRED', 'UNKNOWN'])('does not invent future progress or promises for %s', status => {
    const progress = trackingProgress(status, [{ status: 'CONFIRMED' }, { status: 'AT_FACILITY' }]);
    expect(progress.filter(step => step.label === 'Recorded').map(step => step.status)).toEqual(['CONFIRMED', 'AT_FACILITY']);
    expect(progress.filter(step => step.label === 'Done' || step.label === 'Current' || step.label === 'Pending')).toEqual([]);
    expect(progress.at(-1)).toEqual({ status: 'DELIVERED', label: 'Not reached' });
  });

  it('offers cancellation only in explicitly supported early states', () => {
    for (const status of ['AWAITING_PAYMENT', 'CONFIRMED', 'PICKUP_PENDING', 'AT_FACILITY', 'AWAITING_ADJUSTMENT']) expect(canOfferCancellation(status)).toBe(true);
    for (const status of ['IN_CARE', 'QUALITY_CHECK', 'READY_FOR_RETURN', 'RETURNING', 'DELIVERED', 'CANCELLED', 'CANCEL_REQUESTED', 'ON_HOLD', 'UNKNOWN']) expect(canOfferCancellation(status)).toBe(false);
  });
});
