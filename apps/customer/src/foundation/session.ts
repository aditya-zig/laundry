// Web remains memory-only; native startup must install protected ports first.
import { createAppSessionBinding, resolveApiV2BaseUrl, type PlatformSessionStores } from '@laundry/app-foundation';
export function getApiV2BaseUrl(): string { return resolveApiV2BaseUrl(process.env.EXPO_PUBLIC_API_V2_URL); }
import { createPlatformStores, requiresProtectedStorage } from './platform-storage';
export { requiresProtectedStorage } from './platform-storage';
const binding = createAppSessionBinding(getApiV2BaseUrl, requiresProtectedStorage);
let preparation: Promise<void> | undefined;
export function prepareSessionStorage(): Promise<void> {
  return preparation ??= createPlatformStores().then(stores => {
    if (stores) binding.configure(stores);
  }).catch(error => { preparation = undefined; throw error; });
}
export type CustomerFoundationStores = PlatformSessionStores;
export const configureCustomerSessionStores = binding.configure;
export const getFoundation = binding.getFoundation;
export const getV2Client = binding.getV2Client;
export const onCustomerIdentityChange = binding.onIdentityChange;
