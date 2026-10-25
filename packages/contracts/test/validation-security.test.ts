import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { idSchema, reviewInputSchema, errorEnvelopeSchema } from '../src/schemas';
import { pilotBookingSchema, v2 } from '../src/index';

describe('validation resource limits and migration compatibility', () => {
  it('rejects oversized constrained collections before allocating one error per element', () => {
    const result = z.array(z.number()).max(20).safeParse(Array(10_000).fill('invalid'));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.length).toBeLessThanOrEqual(2);
  });

  it('preserves historical UUID-like identifiers without silently narrowing existing IDs', () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    expect(idSchema.parse(id)).toBe(id);
    expect(v2.idSchema.parse(id)).toBe(id);
    expect(pilotBookingSchema.parse({ serviceCode: 'WASH_FOLD', estimatedWeightGrams: 1000, slotId: id, address: { line: 'Synthetic test address', lat: 12.97, lng: 77.59 } }).slotId).toBe(id);
    expect(idSchema.safeParse('not-an-id').success).toBe(false);
  });

  it('preserves omitted review media defaults and missing optional error properties', () => {
    const review = reviewInputSchema.parse({ orderId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', overall: 5, publishConsent: true });
    expect(review.mediaIds).toEqual([]);
    const error = errorEnvelopeSchema.parse({ code: 'INVALID_INPUT', message: 'Invalid', retryable: false, traceId: 'trace' });
    expect(Object.hasOwn(error, 'fieldErrors')).toBe(false);
  });

  it('keeps partial event-consumer registrations compatible without accepting unknown event names', () => {
    expect(v2.eventConsumersSchema.parse({ 'order.confirmed.v2': ['billing'] })).toEqual({ 'order.confirmed.v2': ['billing'] });
    expect(v2.eventConsumersSchema.safeParse({ 'unknown.event': ['billing'] }).success).toBe(false);
  });

  it('retains strict requests and timezone normalization', () => {
    expect(v2.otpRequestSchema.safeParse({ phone: '+919876543210', role: 'ADMIN' }).success).toBe(false);
    expect(v2.instantSchema.parse('2026-10-24T00:15:00+05:30')).toBe('2026-10-23T18:45:00.000Z');
    expect(v2.windowSchema.safeParse({ start: '2026-10-24T10:00:00Z', end: '2026-10-24T09:00:00Z', timezone: 'Asia/Kolkata' }).success).toBe(false);
  });
});
