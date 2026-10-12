// Error envelope mapping. Matches packages/contracts error codes and the
// status mapping in modules/shared/src/errors.ts.

import { uuid } from "./ids";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "OUT_OF_AREA"
  | "NO_CAPACITY"
  | "DEADLINE_UNAVAILABLE"
  | "QUOTE_EXPIRED"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "PAYMENT_PENDING"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_OUTCOME_UNKNOWN"
  | "REQUIRES_APPROVAL"
  | "RATE_LIMITED";

export class EngineError extends Error {
  code: ErrorCode;
  status: number;
  retryable: boolean;
  fieldErrors?: Record<string, string>;
  traceId: string;
  constructor(
    code: ErrorCode,
    message: string,
    opts?: { status?: number; retryable?: boolean; fieldErrors?: Record<string, string> }
  ) {
    super(message);
    this.code = code;
    this.status = opts?.status ?? statusFor(code);
    this.retryable = opts?.retryable ?? (this.status >= 500 || this.status === 429);
    this.fieldErrors = opts?.fieldErrors;
    this.traceId = uuid();
  }
  envelope() {
    return {
      code: this.code,
      message: this.message,
      traceId: this.traceId,
      retryable: this.retryable,
      ...(this.fieldErrors ? { fieldErrors: this.fieldErrors } : {}),
    };
  }
}

export function statusFor(code: ErrorCode): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "INVALID_INPUT":
      return 400;
    case "OUT_OF_AREA":
      return 422;
    case "NO_CAPACITY":
      return 409;
    case "DEADLINE_UNAVAILABLE":
      return 422;
    case "QUOTE_EXPIRED":
      return 410;
    case "VERSION_CONFLICT":
      return 409;
    case "IDEMPOTENCY_CONFLICT":
      return 409;
    case "PAYMENT_PENDING":
      return 409;
    case "PROVIDER_UNAVAILABLE":
      return 502;
    case "PROVIDER_OUTCOME_UNKNOWN":
      return 502;
    case "REQUIRES_APPROVAL":
      return 409;
    case "RATE_LIMITED":
      return 429;
  }
}
