/**
 * @laundry/app-foundation
 *
 * Shared v2 session foundation candidate for the customer, partner and ops
 * applications. Access tokens stay in memory; refresh tokens and durable
 * pending mutations live only behind explicitly injected secure stores.
 * All wire access flows through @laundry/api-client — this package never
 * calls raw fetch endpoints. The browser default is memory-only: no bearer
 * material is EVER persisted to localStorage.
 */

export {
  createSessionFoundation,
  createActorScopedCache,
  type SessionFoundation,
  type SessionFoundationOptions,
  type SessionSnapshot,
  type QueuedMutationDescriptor,
  type FlushReport,
  type LogoutReport,
} from "./session.js";

export {
  StorageError,
  asPendingMutationStore,
  asSecureTokenStore,
  createMemoryPendingMutationStore,
  createMemorySecureTokenStore,
  type PendingMutationStore,
  type QueuedMutationRecord,
  type SecureTokenStore,
} from "./ports.js";

export { createBrowserSessionFoundation, createAppSessionBinding, resolveApiV2BaseUrl, type BrowserFoundationOptions, type PlatformSessionStores } from "./app-helpers.js";

export { UnknownOutcomeError, V2ApiError } from "@laundry/api-client";
