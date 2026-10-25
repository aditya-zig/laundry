// Explicit v2 adapter. Memory-only on web; native ports must be injected before use.
import { createAppSessionBinding, resolveApiV2BaseUrl, type PlatformSessionStores } from '@laundry/app-foundation';
export function getApiV2BaseUrl(): string { return resolveApiV2BaseUrl(process.env.EXPO_PUBLIC_API_V2_URL); }
const binding = createAppSessionBinding(getApiV2BaseUrl);
export type CustomerFoundationStores = PlatformSessionStores;
export const configureCustomerSessionStores = binding.configure;
export const getFoundation = binding.getFoundation;
export const getV2Client = binding.getV2Client;
export const onCustomerIdentityChange = binding.onIdentityChange;
