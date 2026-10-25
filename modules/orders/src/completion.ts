import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { v2 } from '@laundry/contracts';
import { canonicalJson } from '../../shared/src/command-executor';
import { acceptedReturnForOrder } from '../../logistics/src/v2';

export interface DeliveryContext {
  actorId: string;
  actorRole: v2.ActorRole | 'PROVIDER';
  traceId: string;
  now: Date;
}
export type DeliveryReconciliation = (orderId: string, tx: PoolClient, context: DeliveryContext) => Promise<boolean>;

/** Both callers lock order before obligation. Only persisted money and custody
 * facts can deliver; whichever arrives last performs the transition atomically. */
export async function completeReturnWhenSettled(tx: PoolClient, orderId: string, context: DeliveryContext): Promise<boolean> {
  v2.idSchema.parse(orderId); v2.idSchema.parse(context.actorId); v2.idSchema.parse(context.traceId);
  const order = (await tx.query<{ status: v2.OrderStatus; version: number; total_minor: string; quality_check_passed: boolean; measured_lines: unknown }>(
    'SELECT * FROM orders_v2_orders WHERE id=$1 FOR UPDATE', [orderId],
  )).rows[0];
  if (!order || order.status !== 'RETURNING' || !order.quality_check_passed || !order.measured_lines) return false;
  const obligation = (await tx.query<{ id: string; status: v2.ObligationStatus; amount_due_minor: string; amount_settled_minor: string }>(
    "SELECT * FROM billing_obligations WHERE order_id=$1 ORDER BY (status<>'VOID') DESC, created_at DESC LIMIT 1 FOR UPDATE", [orderId],
  )).rows[0];
  if (!obligation) return false;
  const due = v2.moneySchema.parse(Number(obligation.amount_due_minor));
  const settled = v2.moneySchema.parse(Number(obligation.amount_settled_minor));
  if (due !== v2.moneySchema.parse(Number(order.total_minor)) || settled !== due) return false;
  if ((await tx.query(`SELECT 1 FROM billing_payment_attempts WHERE obligation_id=$1 AND status IN ('CREATED','PENDING','OUTCOME_UNKNOWN')
    UNION ALL SELECT 1 FROM billing_refunds WHERE order_id=$2 AND status IN ('REQUESTED','PROCESSING','OUTCOME_UNKNOWN')
    UNION ALL SELECT 1 FROM orders_v2_adjustments WHERE order_id=$2 AND state='PROPOSED' LIMIT 1`, [obligation.id, orderId])).rowCount) return false;
  let zeroDueResolution: { auditId: string; reason: string } | undefined;
  if (obligation.status === 'VOID' && due === 0 && settled === 0) {
    const audit = (await tx.query<{ id: string; reason: string }>(
      "SELECT id,reason FROM v2_audit WHERE aggregate_id=$1 AND action='BILLING_OBLIGATION_VOIDED' ORDER BY occurred_at DESC LIMIT 1", [obligation.id],
    )).rows[0];
    if (audit) zeroDueResolution = { auditId: audit.id, reason: audit.reason };
  }
  const paymentSettled = obligation.status === 'SETTLED' && due > 0;
  if (!paymentSettled && !zeroDueResolution) return false;
  const legAttempt = await acceptedReturnForOrder(tx, orderId);
  if (!legAttempt) return false;
  v2.guardOrderCommand(order, { type: 'COMPLETE_RETURN', expectedVersion: order.version }, {
    leg: 'RETURN', custodyAccepted: true, paymentSettled, amountRemainingMinor: due - settled, zeroDueResolution,
  });
  const at = context.now.toISOString();
  await tx.query("UPDATE orders_v2_orders SET status='DELIVERED',version=version+1,updated_at=$2 WHERE id=$1", [orderId, context.now]);
  await tx.query(`INSERT INTO orders_v2_timeline (id,order_id,seq,status,label,actor_role,occurred_at)
    SELECT $1,$2,COALESCE(MAX(seq),0)+1,'DELIVERED','Return received and payment resolved',$3,$4 FROM orders_v2_timeline WHERE order_id=$2`,
    [randomUUID(), orderId, context.actorRole === 'PROVIDER' ? null : context.actorRole, context.now]);
  await tx.query(`INSERT INTO v2_audit (actor_id,actor_role,aggregate_id,action,reason,before_value,after_value,trace_id)
    VALUES ($1,$2,$3,'ORDER_DELIVERED',$4,$5,$6,$7)`, [context.actorId, context.actorRole, orderId,
    'Accepted return custody and persisted final payment resolution', canonicalJson({ status: order.status, version: order.version }),
    canonicalJson({ status: 'DELIVERED', legAttemptId: legAttempt.id, obligationId: obligation.id, paymentSettled, zeroDueAuditId: zeroDueResolution?.auditId ?? null }), context.traceId]);
  const event = v2.domainEventSchema.parse({ eventId: randomUUID(), eventType: 'order.delivered.v2', schemaVersion: 2,
    aggregateId: orderId, aggregateVersion: order.version + 1, traceId: context.traceId, occurredAt: at,
    payload: { orderId, deliveredAt: at, legAttempt } });
  await tx.query(`INSERT INTO v2_outbox (event_id,aggregate_id,aggregate_version,event_type,envelope)
    VALUES ($1,$2,$3,$4,$5)`, [event.eventId, orderId, event.aggregateVersion, event.eventType, canonicalJson(event)]);
  return true;
}
