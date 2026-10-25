import type { v2 } from '@laundry/contracts';

/**
 * Production-v2 logistics failures use the published wire error codes only.
 *
 * The shared v1 error list has HANDOVER_CODE_EXPIRED, which the v2 wire schema
 * does not publish. A code that is wrong, expired or superseded therefore
 * fails as INVALID_INPUT with one generic message. The response never names
 * the expected code, its digest or the remaining attempts.
 */
export class LogisticsFault extends Error {
  constructor(
    readonly code: v2.ErrorCode,
    message: string,
    readonly currentVersion?: number,
  ) {
    super(message);
    this.name = 'LogisticsFault';
  }
}

/** Internal marker so a failed custody attempt can be counted outside the
 * rolled back transaction without telling the caller which check failed. */
export class CustodyCodeMismatch extends LogisticsFault {
  constructor(readonly assignmentId: string, message = 'Custody code did not match') {
    super('INVALID_INPUT', message);
    this.name = 'CustodyCodeMismatch';
  }
}
