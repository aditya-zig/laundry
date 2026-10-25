// Explicit v2 adapter; no localhost or legacy API fallback in product configuration.
import { createAppSessionBinding, resolveApiV2BaseUrl, type PlatformSessionStores } from '@laundry/app-foundation';
export function getApiV2BaseUrl(): string { return resolveApiV2BaseUrl(import.meta.env.VITE_API_V2_URL); }
const binding = createAppSessionBinding(getApiV2BaseUrl);
export type OpsFoundationStores = PlatformSessionStores;
export const configureOpsSessionStores = binding.configure;
export const getFoundation = binding.getFoundation;
export const getV2Client = binding.getV2Client;
export const opsCacheEpoch = binding.cacheEpoch;
export const getCurrentActorId = binding.currentActorId;
