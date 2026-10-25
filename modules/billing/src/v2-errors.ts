import type { v2 } from '@laundry/contracts';

/** The billing module's error shape. It mirrors OrdersFault so the HTTP filter
 * can project either into the published error envelope. */
export class BillingFault extends Error {
  constructor(readonly code: v2.ErrorCode, message: string, readonly currentVersion?: number) {
    super(message);
    this.name = 'BillingFault';
  }
}
