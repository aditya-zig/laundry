import { V2ApiError } from "@laundry/api-client";

/** Queue retirement and the UI's retry state must agree about unresolved commands. */
export function isMutationOutcomePending(error: unknown): boolean {
  if (!(error instanceof V2ApiError)) return true;
  if (error.status >= 500 || [401, 408, 429].includes(error.status) || error.code === "PROVIDER_OUTCOME_UNKNOWN") return true;
  // These exact versioned terms can never become current again.
  if (["VERSION_CONFLICT", "QUOTE_EXPIRED"].includes(error.code)) return false;
  return error.retryable;
}
