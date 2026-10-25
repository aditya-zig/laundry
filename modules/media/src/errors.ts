import type { v2 } from '@laundry/contracts';

export class MediaFault extends Error {
  constructor(readonly code: v2.ErrorCode, message: string) {
    super(message);
  }
}
