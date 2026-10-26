import type { PlatformSessionStores } from '@laundry/app-foundation';
export const requiresProtectedStorage = false;
export async function createPlatformStores(): Promise<PlatformSessionStores | undefined> { return undefined; }
