import type { Actor, SystemActor, Id, Instant } from "./common.js";
import type { DomainEvent } from "./events.js";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface CommandIdentity {
  actor: Actor;
  operation: string;
  idempotencyKey: string;
  payload: JsonValue;
  traceId: Id;
}

export interface AuditInput {
  aggregateId: Id;
  action: string;
  reason: string;
  /** Minimized business facts only. Never raw phone/address/audio/token values. */
  before: JsonValue;
  after: JsonValue;
}

/** All participants receive the same transaction handle; no nested independent commits.
 * The database adapter chooses Handle. External I/O is forbidden in the callback.
 * Throwing aborts business writes, audit, outbox and the idempotency result together. */
export interface TransactionScope<Handle> {
  readonly handle: Handle;
  readonly now: Instant;
  audit(input: AuditInput): Promise<void>;
  publish(event: DomainEvent): Promise<void>;
}

export interface CommandExecutor<Handle> {
  /** authorize must check current ownership/assignment on every attempt, including
   * cached replay. It runs before stored private responses can be returned. */
  execute<T extends JsonValue>(identity: CommandIdentity, authorize: (handle: Handle) => Promise<void>, work: (scope: TransactionScope<Handle>) => Promise<T>): Promise<T>;
  /** Repeated consumer/event identities return false without repeating the effect.
   * A reused event ID with different content conflicts instead of being ignored. */
  consume(consumer: string, actor: SystemActor, event: DomainEvent, work: (scope: TransactionScope<Handle>) => Promise<void>): Promise<boolean>;
}

export interface RuntimeDependencies {
  clock(): Instant;
  newId(): Id;
}
