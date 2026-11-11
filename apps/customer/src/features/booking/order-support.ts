import { v2 } from '@laundry/contracts';
import type { QueuedMutationRecord } from '@laundry/app-foundation';

export type SupportDraft = { category: string; summary: string; detail: string };
export function incidentFor(orderId: string, draft: SupportDraft): v2.IncidentInput {
  return v2.incidentInputSchema.parse({ orderId, category: draft.category, summary: draft.summary,
    detail: draft.detail.trim() || undefined, mediaIds: [] });
}
export function incidentMessageFor(body: string): v2.IncidentMessageInput {
  return v2.incidentMessageInputSchema.parse({ body, mediaIds: [] });
}

type Retained<T> = { body: T; params: Record<string, string>; retainedKey: string };
export function pendingSupport(records: readonly QueuedMutationRecord[], orderId: string, incidentId?: string) {
  let incident: Retained<v2.IncidentInput> | null = null;
  let message: (Retained<v2.IncidentMessageInput> & { params: { incidentId: string } }) | null = null;
  for (const record of records) {
    if (record.routeId === 'support.incidents.create') {
      const body = v2.incidentInputSchema.parse(JSON.parse(record.bodyJson ?? 'null'));
      if (record.params.orderId !== undefined && record.params.orderId !== body.orderId) throw new Error('Retained support order does not match its intent');
      if (body.orderId !== orderId) continue;
      if (incident || !record.idempotencyKey.trim()) throw new Error('Reconcile ambiguous retained support cases before creating another');
      incident = { body, params: { ...record.params }, retainedKey: record.idempotencyKey };
    } else if (record.routeId === 'support.incidents.messages' && incidentId !== undefined && record.params.incidentId === incidentId) {
      const body = v2.incidentMessageInputSchema.parse(JSON.parse(record.bodyJson ?? 'null'));
      if (message || !record.idempotencyKey.trim()) throw new Error('Reconcile ambiguous retained support messages before sending another');
      message = { body, params: { ...record.params, incidentId }, retainedKey: record.idempotencyKey };
    }
  }
  return { incident, message };
}
