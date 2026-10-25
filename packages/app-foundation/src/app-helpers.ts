import { createV2Client, type Actor } from '@laundry/api-client';
import { createMemoryPendingMutationStore, createMemorySecureTokenStore, type PendingMutationStore, type SecureTokenStore } from './ports.js';
import { createSessionFoundation, type SessionFoundation } from './session.js';
export interface BrowserFoundationOptions {
  baseUrl: string;
  refreshTokenStore?: SecureTokenStore;
  pendingMutationStore?: PendingMutationStore;
  generateKey?: () => string;
  onIdentityChange?: (actor: Actor | null) => void;
}
/** No implicit legacy/demo API. Cleartext is allowed only on loopback. */
export function resolveApiV2BaseUrl(value?: string): string {
  if (!value) throw new Error('Configure the explicit v2 API URL before using product sessions');
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname.replace(/\/$/, '') !== '/v2' ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('The v2 API requires HTTPS (or loopback HTTP), /v2, and no embedded credentials');
  }
  return url.href.replace(/\/$/, '');
}
/** Memory-only defaults: reload signs out and loses unconfirmed local intents.
 * A native host must inject verified secure persistence AND a secure UUID
 * source; this helper is not native storage/device acceptance evidence. */
export function createBrowserSessionFoundation(options: BrowserFoundationOptions): SessionFoundation {
  const baseUrl = resolveApiV2BaseUrl(options.baseUrl);
  return createSessionFoundation({
    wireClient: getToken => createV2Client({ baseUrl, getToken, generateKey: options.generateKey }),
    refreshTokenStore: options.refreshTokenStore ?? createMemorySecureTokenStore(),
    pendingMutationStore: options.pendingMutationStore ?? createMemoryPendingMutationStore(),
    generateKey: options.generateKey,
    onIdentityChange: options.onIdentityChange,
  });
}
export type PlatformSessionStores = Pick<BrowserFoundationOptions, 'refreshTokenStore' | 'pendingMutationStore' | 'generateKey'>;
export function createAppSessionBinding(getBaseUrl: () => string) {
  let foundation: SessionFoundation | undefined, stores: PlatformSessionStores = {}, epoch = 0;
  const listeners = new Set<(actor: Actor | null) => void>();
  function getFoundation(): SessionFoundation {
    return foundation ??= createBrowserSessionFoundation({ ...stores, baseUrl: getBaseUrl(), onIdentityChange(actor) {
      epoch++;
      for (const listener of [...listeners]) listener(actor);
    } });
  }
  return {
    getFoundation,
    getV2Client: () => getFoundation().getPlainV2Client(),
    configure(next: PlatformSessionStores = {}) {
      if (foundation) throw new Error('Inject platform session ports before the first session access');
      stores = { ...next };
    },
    onIdentityChange(listener: (actor: Actor | null) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    cacheEpoch: () => epoch,
    currentActorId: () => foundation?.getActor()?.id ?? null,
  };
}
