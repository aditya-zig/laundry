import type { PoolClient } from 'pg';
import type { v2 } from '@laundry/contracts';

/**
 * A consumer effect runs inside the inbox transaction opened by the shared
 * command executor. The dispatcher records the inbox row after the handler
 * returns, so a thrown error leaves no inbox row and the effect can be retried.
 */
export interface JobContext {
  consumer: string;
  event: v2.DomainEvent;
  scope: v2.TransactionScope<PoolClient>;
}

export type JobHandler = (context: JobContext) => Promise<void>;

/** A handler descriptor is the registration unit other modules publish. The
 * consumer name must match `EVENT_CONSUMERS` in the contracts package. */
export interface JobHandlerDescriptor {
  consumer: string;
  eventType: v2.EventType;
  description: string;
  handler: JobHandler;
}

export class JobHandlerRegistry {
  private readonly descriptors = new Map<string, JobHandlerDescriptor>();

  constructor(descriptors: readonly JobHandlerDescriptor[] = []) {
    for (const descriptor of descriptors) this.add(descriptor);
  }

  add(descriptor: JobHandlerDescriptor): void {
    if (!descriptor.consumer.trim()) throw new Error('A job handler needs a consumer name');
    if (!descriptor.description.trim()) throw new Error('A job handler needs a description');
    const key = `${descriptor.consumer}/${descriptor.eventType}`;
    if (this.descriptors.has(key)) throw new Error(`Duplicate job handler for ${key}`);
    this.descriptors.set(key, descriptor);
  }

  get(consumer: string, eventType: string): JobHandler | undefined {
    return this.descriptors.get(`${consumer}/${eventType}`)?.handler;
  }

  list(): readonly JobHandlerDescriptor[] {
    return [...this.descriptors.values()];
  }
}
