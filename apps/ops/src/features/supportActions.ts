import { v2 } from '@laundry/contracts';
import type { QueuedMutationDescriptor, QueuedMutationRecord } from '@laundry/app-foundation';

export type StaffReplyIntent = QueuedMutationDescriptor<'support.incidents.messages'>;

/** Call with the foundation's actor/scope-filtered journal, never a global store. */
export function retainedStaffReply(records: QueuedMutationRecord[], incidentId: string, actorId: string): StaffReplyIntent | null {
  const matches = records.filter(record => record.actorId === actorId && record.routeId === 'support.incidents.messages' && record.params.incidentId === incidentId);
  if (matches.length > 1) throw new Error('Multiple retained replies need reconciliation; no new reply will be created.');
  const record = matches[0];
  if (!record) return null;
  try {
    const raw = JSON.parse(record.bodyJson ?? 'null');
    const body = v2.incidentMessageInputSchema.parse(raw);
    // Parsing must not trim, strip or otherwise replace the stored intent.
    if (Object.keys(raw).sort().join(',') !== 'body,mediaIds' || raw.body !== body.body || JSON.stringify(raw.mediaIds) !== JSON.stringify(body.mediaIds) || Object.keys(record.params).join(',') !== 'incidentId') throw new Error('Changed intent');
    return { routeId: 'support.incidents.messages', params: { incidentId }, body, retainedKey: v2.idempotencyKeySchema.parse(record.idempotencyKey) };
  } catch {
    throw new Error('The retained reply cannot be safely decoded. Reconcile it without creating a replacement.');
  }
}

export function checkedSupportPage<T>(page: v2.Page<T>): v2.Page<T> {
  if (page.pageInfo.hasMore && (!page.pageInfo.nextCursor || page.items.length === 0)) throw new Error('Support continuation is missing; this is not a complete or empty result.');
  return page;
}

export function appendSupportPage<T extends { id: string }>(previous: v2.Page<T>, next: v2.Page<T>): v2.Page<T> {
  checkedSupportPage(next);
  if (next.pageInfo.hasMore && next.pageInfo.nextCursor === previous.pageInfo.nextCursor) throw new Error('Support continuation did not advance. Reload before continuing.');
  const items = new Map(previous.items.map(item => [item.id, item]));
  for (const item of next.items) items.set(item.id, item);
  return { items: [...items.values()], pageInfo: next.pageInfo };
}

export function canStaffReply(incident: v2.Incident, thread: v2.Page<v2.IncidentMessage> | null, pending: boolean): boolean {
  return !pending && thread !== null && !thread.pageInfo.hasMore && !['RESOLVED', 'REJECTED'].includes(incident.status);
}
