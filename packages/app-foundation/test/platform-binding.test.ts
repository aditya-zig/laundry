import { describe, expect, it } from 'vitest';
import { createAppSessionBinding, createMemoryPendingMutationStore, createMemorySecureTokenStore, StorageError } from '../src/index';
const baseUrl = () => 'http://localhost:4100/v2';

describe('protected native binding (injected synthetic stores, not OS storage proof)', () => {
  it('cannot create a memory foundation or wire client before native ports are configured', () => {
    const binding = createAppSessionBinding(baseUrl, true);
    expect(() => binding.getFoundation()).toThrow(StorageError);
    expect(() => binding.getV2Client()).toThrow(StorageError);
  });
  it('requires both persistence ports and the host secure UUID source', () => {
    const binding = createAppSessionBinding(baseUrl, true);
    binding.configure({ refreshTokenStore: createMemorySecureTokenStore(), pendingMutationStore: createMemoryPendingMutationStore() });
    expect(() => binding.getFoundation()).toThrow(/secure UUID/);
  });
  it('starts only after complete injection and cannot replace a live foundation', async () => {
    const binding = createAppSessionBinding(baseUrl, true);
    binding.configure({ refreshTokenStore: createMemorySecureTokenStore(), pendingMutationStore: createMemoryPendingMutationStore(), generateKey: () => '981ebfe2-43bf-4f52-8db2-000000000000' });
    expect(await binding.getFoundation().initialize()).toEqual({ state: 'signedOut' });
    expect(binding.getFoundation()).toBe(binding.getFoundation());
    expect(() => binding.configure({})).toThrow(/before the first session access/);
  });
  it('preserves explicit memory-only web startup', async () => {
    const binding = createAppSessionBinding(baseUrl);
    expect(await binding.getFoundation().initialize()).toEqual({ state: 'signedOut' });
  });
});
