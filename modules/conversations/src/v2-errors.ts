import type { v2 } from '@laundry/contracts';

/**
 * Same envelope shape as OrdersFault: the controller maps `code` through the
 * published v2 error tables, so a conversation failure is never a bare 500.
 */
export class ConversationsFault extends Error {
  constructor(
    readonly code: v2.ErrorCode,
    message: string,
    readonly currentVersion?: number,
  ) {
    super(message);
    this.name = 'ConversationsFault';
  }
}
