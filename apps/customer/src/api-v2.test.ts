import { beforeEach, expect, it, vi } from 'vitest';
import { v2WireFixtures } from '@laundry/test-fixtures';
const mocks = vi.hoisted(() => ({ authorized: vi.fn(), getCustodyReceipt: vi.fn() }));
vi.mock('./foundation/session', () => ({ getFoundation: () => ({ authorized: mocks.authorized }), getV2Client: vi.fn() }));
import { apiV2 } from './api-v2';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authorized.mockImplementation(work => work({ getCustodyReceipt: mocks.getCustodyReceipt }));
});
it('reads custody through the identity-authorized shared SDK, preserving the order ID and response', async () => {
  mocks.getCustodyReceipt.mockResolvedValue(v2WireFixtures.CustodyReceipt);
  await expect(apiV2.getCustodyReceipt('owned-order')).resolves.toEqual(v2WireFixtures.CustodyReceipt);
  expect(mocks.authorized).toHaveBeenCalledOnce();
  expect(mocks.getCustodyReceipt).toHaveBeenCalledExactlyOnceWith('owned-order');
});
it('does not bypass an expired or changed identity to fetch custody', async () => {
  mocks.authorized.mockRejectedValue(new Error('Session changed'));
  await expect(apiV2.getCustodyReceipt('owned-order')).rejects.toThrow('Session changed');
  expect(mocks.getCustodyReceipt).not.toHaveBeenCalled();
});
