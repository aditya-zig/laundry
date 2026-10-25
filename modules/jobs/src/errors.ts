import type { v2 } from '@laundry/contracts';

/** Same envelope contract as the orders and availability modules: the filter
 * renders `code`, `message`, `traceId`, `retryable` and an optional version. */
export class JobsFault extends Error {
  constructor(readonly code: v2.ErrorCode, message: string, readonly currentVersion?: number) {
    super(message);
    this.name = 'JobsFault';
  }
}
