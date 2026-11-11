import { describe, expect, it } from 'vitest';
import { canAssignRider } from './DispatchSettlementPanel';

describe('pickup and return assignment eligibility', () => {
  it.each([
    ['CONFIRMED', 'PICKUP', 'BOOKED', true],
    ['PICKUP_PENDING', 'PICKUP', 'BOOKED', true],
    ['IN_CARE', 'PICKUP', 'BOOKED', false],
    ['CONFIRMED', 'PICKUP', 'ASSIGNED', false],
    ['READY_FOR_RETURN', 'RETURN', 'BOOKED', true],
    ['CONFIRMED', 'RETURN', 'BOOKED', false],
    ['RETURNING', 'RETURN', 'BOOKED', false],
    ['READY_FOR_RETURN', 'RETURN', 'IN_TRANSIT', false],
    ['CANCELLED', 'PICKUP', 'BOOKED', false],
    ['DELIVERED', 'RETURN', 'BOOKED', false],
  ] as const)('%s / %s / %s permits assignment: %s', (status, leg, legStatus, allowed) => {
    expect(canAssignRider(status, { leg, status: legStatus })).toBe(allowed);
  });
});
