import { describe, expect, it } from 'vitest';
import { quoteInputSchema } from '@laundry/contracts';
import { fromISTFields, toISTFields } from '../src/schedule-input';

describe('India schedule fields at the current quote API boundary', () => {
  it('serializes human-entered India times as UTC accepted by the v1 quote client', () => {
    const start = fromISTFields('2026-11-02', '09:00');
    const end = fromISTFields('2026-11-02', '10:00');
    const returnBy = fromISTFields('2026-11-07', '18:00');
    expect(start).toBe('2026-11-02T03:30:00.000Z');
    const quote = quoteInputSchema.safeParse({
      addressId: '66666666-6666-4666-8666-666666666666',
      lines: [{
        serviceId: '11111111-1111-4111-8111-111111111111',
        garmentTypeId: '22222222-2222-4222-8222-222222222222',
        quantity: 2,
      }],
      pickupWindow: { start, end, timezone: 'Asia/Kolkata' },
      requestedReturnBy: returnBy,
      timezone: 'Asia/Kolkata',
    });
    expect(quote.success).toBe(true);
  });

  it('keeps India midnight on the intended local date while crossing the UTC date', () => {
    const value = fromISTFields('2026-11-02', '00:15');
    expect(value).toBe('2026-11-01T18:45:00.000Z');
    expect(toISTFields(value!)).toEqual({ date: '2026-11-02', time: '00:15' });
  });

  it('rejects impossible calendar dates, missing dates and invalid clock values', () => {
    expect(fromISTFields('2026-02-30', '09:00')).toBeNull();
    expect(fromISTFields('', '09:00')).toBeNull();
    expect(fromISTFields('2026-11-02', '24:00')).toBeNull();
    expect(fromISTFields('2026-11-02', '09:60')).toBeNull();
  });
});
