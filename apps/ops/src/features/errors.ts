// Shared error presentation: preserve the SDK's typed error codes so the UI
// never invents a success or hides the server's trace identity.
import { UnknownOutcomeError, V2ApiError } from "@laundry/api-client";

export interface PresentableError {
  code: string;
  message: string;
  traceId: string | undefined;
  retryable: boolean;
  currentVersion: number | undefined;
  unknownOutcome: boolean;
}

export function describeError(error: unknown): PresentableError {
  if (error instanceof UnknownOutcomeError) {
    return {
      code: error.code,
      message:
        "The server outcome is unknown. Retry sends the identical command with the same idempotency key.",
      traceId: undefined,
      retryable: true,
      currentVersion: undefined,
      unknownOutcome: true,
    };
  }
  if (error instanceof V2ApiError) {
    return {
      code: error.code,
      message: error.message,
      traceId: error.traceId,
      retryable: error.retryable,
      currentVersion: error.currentVersion,
      unknownOutcome: false,
    };
  }
  return {
    code: "UNEXPECTED_CLIENT_ERROR",
    message: error instanceof Error ? error.message : "An unexpected client error occurred.",
    traceId: undefined,
    retryable: true,
    currentVersion: undefined,
    unknownOutcome: false,
  };
}
