import type { v2 } from '@laundry/contracts';

export class OrdersFault extends Error {
  constructor(readonly code: v2.ErrorCode, message: string, readonly currentVersion?: number) {
    super(message);
  }
}
