import type { v2 } from '@laundry/contracts';

/** Same envelope shape as OrdersFault so one filter can translate every B08
 * failure without a second error vocabulary. */
export class ReviewsFault extends Error {
  constructor(readonly code: v2.ErrorCode, message: string, readonly currentVersion?: number) {
    super(message);
    this.name = 'ReviewsFault';
  }
}
