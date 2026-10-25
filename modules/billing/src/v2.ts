import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { v2 } from '@laundry/contracts';
import { canonicalJson, createPostgresCommandExecutor } from '../../shared/src/command-executor';
import { BillingFault } from './v2-errors';

/**
 * Production-v2 billing for due-at-return orders.
 *
 * Two rules shape this module. Status changes call the published guards in
 * `@laundry/contracts` (`deriveObligationStatus`, `assertPaymentAttemptTransition`,
 * `assertRefundTransition`, `assertRefundAllowed`), so the state machine lives in
 * one place. And no money moves on our side of the boundary: a capture is only
 * recorded from a signature-verified provider event, a manual receipt records
 * who confirmed it, and a refund is bounded by captured minus refunded minus
 * reserved.
 *
 * Nothing here calls a commercial provider. `PaymentProviderPort` is injected and
 * the default implementation is a deterministic in-repo fake.
 */

export type ProviderRefundOutcome = 'SUCCEEDED' | 'FAILED' | 'OUTCOME_UNKNOWN';

export interface ProviderRefundRequest {
  refundId: string;
  /** The capture this refund reverses, as the provider knows it. */
  providerPaymentReference: string;
  amountMinor: number;
  currency: 'INR';
  reason: string;
  /**
   * Stable across retries and derived from the local refund id. A provider that
   * honours it can never move the same money twice for one refund row.
   */
  reference: string;
}

export interface PaymentProviderPort {
  refund(input: ProviderRefundRequest): Promise<{ outcome: ProviderRefundOutcome; reference: string }>;
}

/** Deterministic fake. No network, no credentials, same reference every call. */
export class FakePaymentProvider implements PaymentProviderPort {
  constructor(private readonly fixed: ProviderRefundOutcome = 'SUCCEEDED') {}

  async refund(input: ProviderRefundRequest): Promise<{ outcome: ProviderRefundOutcome; reference: string }> {
    return { outcome: this.fixed, reference: input.reference };
  }
}

/** HMAC-SHA256 of the untouched request bytes. Comparison is constant time. */
export function verifyProviderSignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const digest = createHmac('sha256', secret).update(rawBody).digest('hex');
  const given = signature.trim().toLowerCase();
  if (digest.length !== given.length) return false;
  return timingSafeEqual(Buffer.from(digest), Buffer.from(given));
}

import type { DeliveryReconciliation } from '../../orders/src/completion';

export interface BillingOptions {
  db: Pool;
  authenticate?: (token: string) => Promise<{ actor: v2.Actor }>;
  provider?: PaymentProviderPort;
  clock?: () => Date;
  /** Per-provider webhook secrets. A provider without a secret is refused. */
  webhookSecrets?: Record<string, string>;
  onSettled?: DeliveryReconciliation;
}

interface ObligationRow {
  id: string;
  order_id: string;
  status: v2.ObligationStatus;
  amount_due_minor: string | number;
  amount_settled_minor: string | number;
  currency: 'INR';
  payment_model: v2.PaymentModel;
  due_at: Date;
  void_reason: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface AttemptRow {
  id: string;
  obligation_id: string;
  status: v2.AttemptStatus;
  method: v2.PaymentMethod;
  amount_minor: string | number;
  provider_reference: string | null;
  external_event_id: string | null;
  started_at: Date;
  resolved_at: Date | null;
  failure_reason: string | null;
  attempt_count: number;
}

interface ReceiptRow {
  id: string;
  obligation_id: string;
  order_id: string;
  amount_minor: string | number;
  currency: 'INR';
  method: v2.PaymentMethod;
  confirmed_by: string | null;
  confirmed_via: v2.ReceiptConfirmation;
  external_reference: string | null;
  provider: string | null;
  provider_event_id: string | null;
  issued_at: Date;
  command_hash?: string | null;
}

interface RefundRow {
  id: string;
  order_id: string;
  receipt_id: string;
  obligation_id: string | null;
  status: v2.RefundStatus;
  amount_minor: string | number;
  currency: 'INR';
  reason: string;
  requested_by: string;
  requested_at: Date;
  resolved_at: Date | null;
  external_reference: string | null;
  attempt_count: number;
  command_hash?: string | null;
}

interface EventRow {
  id: string;
  provider: string;
  event_id: string;
  payment_id: string | null;
  provider_reference: string;
  outcome: 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'PENDING';
  amount_minor: string | number;
  currency: 'INR';
  occurred_at: Date;
  received_at: Date;
  payload_hash: string;
  applied: boolean;
  duplicate_reference: boolean;
  note: string | null;
}

interface ReconciliationRow {
  id: string;
  period: string;
  kind: v2.ReconciliationKind;
  amount_minor: string | number;
  currency: 'INR';
  external_reference: string;
  provider: string;
  provider_event_id: string | null;
  recorded_at: Date;
  matched: boolean;
}

const STAFF = new Set<v2.ActorRole>(['OPERATOR', 'ADMIN']);
const CUSTOMER = new Set<v2.ActorRole>(['CUSTOMER']);
const WEBHOOK_HEADER = 'x-provider-signature';
const PROVIDER_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PERIOD = /^\d{4}-(?:0[1-9]|1[0-2])$/;

const amountOf = (value: string | number): number => Number(value);
const iso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();

function guard<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof v2.TransitionError) throw new BillingFault(error.code, error.message);
    throw error;
  }
}

function encodeCursor(at: Date | string, id: string): string {
  return Buffer.from(`${iso(at)}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string | undefined): { at: Date; id: string } | undefined {
  if (cursor === undefined) return undefined;
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const split = raw.lastIndexOf('|');
  if (split === -1) throw new BillingFault('INVALID_INPUT', 'Cursor is not valid');
  const at = new Date(raw.slice(0, split));
  if (Number.isNaN(at.getTime())) throw new BillingFault('INVALID_INPUT', 'Cursor is not valid');
  return { at, id: raw.slice(split + 1) };
}

function periodBounds(period: string): { start: Date; end: Date } {
  if (!PERIOD.test(period)) throw new BillingFault('INVALID_INPUT', 'Reconciliation period must be YYYY-MM');
  const [year, month] = period.split('-').map(Number);
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
}

function obligationOf(row: ObligationRow): v2.Obligation {
  return v2.obligationSchema.parse({
    id: row.id,
    orderId: row.order_id,
    status: row.status,
    amountDueMinor: amountOf(row.amount_due_minor),
    amountSettledMinor: amountOf(row.amount_settled_minor),
    currency: row.currency,
    paymentModel: row.payment_model,
    dueAt: iso(row.due_at),
    ...(row.void_reason === null ? {} : { voidReason: row.void_reason }),
    version: row.version,
  });
}

function attemptOf(row: AttemptRow): v2.PaymentAttempt {
  return v2.paymentAttemptSchema.parse({
    id: row.id,
    obligationId: row.obligation_id,
    status: row.status,
    method: row.method,
    amountMinor: amountOf(row.amount_minor),
    ...(row.provider_reference === null ? {} : { providerReference: row.provider_reference }),
    ...(row.external_event_id === null ? {} : { externalEventId: row.external_event_id }),
    startedAt: iso(row.started_at),
    ...(row.resolved_at === null ? {} : { resolvedAt: iso(row.resolved_at) }),
    ...(row.failure_reason === null ? {} : { failureReason: row.failure_reason }),
    attemptCount: row.attempt_count,
  });
}

function receiptOf(row: ReceiptRow): v2.Receipt {
  return v2.receiptSchema.parse({
    id: row.id,
    obligationId: row.obligation_id,
    amountMinor: amountOf(row.amount_minor),
    currency: row.currency,
    method: row.method,
    ...(row.confirmed_by === null ? {} : { confirmedBy: row.confirmed_by }),
    confirmedVia: row.confirmed_via,
    ...(row.external_reference === null ? {} : { externalReference: row.external_reference }),
    issuedAt: iso(row.issued_at),
  });
}

function refundOf(row: RefundRow): v2.Refund {
  return v2.refundSchema.parse({
    id: row.id,
    orderId: row.order_id,
    paymentId: row.receipt_id,
    ...(row.obligation_id === null ? {} : { obligationId: row.obligation_id }),
    status: row.status,
    amountMinor: amountOf(row.amount_minor),
    currency: row.currency,
    reason: row.reason,
    requestedBy: row.requested_by,
    requestedAt: iso(row.requested_at),
    ...(row.resolved_at === null ? {} : { resolvedAt: iso(row.resolved_at) }),
    ...(row.external_reference === null ? {} : { externalReference: row.external_reference }),
    attemptCount: row.attempt_count,
  });
}

/**
 * Create the single due-at-return obligation for an order.
 *
 * Intended for the booking coordinator to call with its own transaction client,
 * so the order and its obligation commit together or not at all. The amount is
 * read from `orders_v2_orders.total_minor`; a caller cannot invent a different
 * total. Calling it twice for one order returns the existing live obligation.
 */
export async function createObligationForOrder(
  database: Pool | PoolClient,
  input: { orderId: string; dueAt?: string; paymentModel?: v2.PaymentModel; clock?: () => Date },
): Promise<v2.Obligation> {
  v2.idSchema.parse(input.orderId);
  const now = input.clock?.() ?? new Date();
  const order = (await database.query<{ total_minor: string | number; currency: 'INR'; payment_model: v2.PaymentModel; return_window: { end?: string } }>(
    'SELECT total_minor, currency, payment_model, return_window FROM orders_v2_orders WHERE id=$1', [input.orderId],
  )).rows[0];
  if (!order) throw new BillingFault('NOT_FOUND', 'Order not found');
  const dueAt = v2.instantSchema.parse(input.dueAt ?? order.return_window.end ?? now.toISOString());
  const paymentModel = input.paymentModel ?? order.payment_model;
  const inserted = (await database.query<ObligationRow>(
    `INSERT INTO billing_obligations
      (id, order_id, status, amount_due_minor, amount_settled_minor, currency, payment_model, due_at, void_reason, version, created_at, updated_at)
     VALUES ($1,$2,'OPEN',$3,0,$4,$5,$6,NULL,1,$7,$7)
     ON CONFLICT (order_id) WHERE status <> 'VOID' DO NOTHING
     RETURNING *`,
    [randomUUID(), input.orderId, amountOf(order.total_minor), order.currency, paymentModel, dueAt, now],
  )).rows[0];
  if (inserted) return obligationOf(inserted);
  const existing = (await database.query<ObligationRow>(
    "SELECT * FROM billing_obligations WHERE order_id=$1 AND status <> 'VOID' ORDER BY created_at DESC LIMIT 1", [input.orderId],
  )).rows[0];
  if (!existing) throw new BillingFault('NOT_FOUND', 'Obligation not found');
  return obligationOf(existing);
}

/** Finalize the accepted order total inside the quality-check transaction.
 * Received money is immutable; overpayment and unknown captures need explicit
 * reconciliation, not silently discarded receipts or a fabricated refund. */
export async function reconcileObligationForReturn(
  transaction: PoolClient,
  input: { orderId: string; clock?: () => Date },
): Promise<v2.Obligation> {
  v2.idSchema.parse(input.orderId);
  const order = (await transaction.query<{ total_minor: string | number; status: v2.OrderStatus }>(
    'SELECT total_minor,status FROM orders_v2_orders WHERE id=$1 FOR UPDATE', [input.orderId],
  )).rows[0];
  if (!order) throw new BillingFault('NOT_FOUND', 'Order not found');
  if (order.status !== 'READY_FOR_RETURN') throw new BillingFault('INVALID_INPUT', 'Final billing requires a passed quality check');
  const row = (await transaction.query<ObligationRow>(
    "SELECT * FROM billing_obligations WHERE order_id=$1 ORDER BY (status <> 'VOID') DESC, created_at DESC LIMIT 1 FOR UPDATE", [input.orderId],
  )).rows[0];
  if (!row) throw new BillingFault('REQUIRES_APPROVAL', 'The booking has no payment obligation to reconcile');
  if (row.status === 'VOID') throw new BillingFault('REQUIRES_APPROVAL', 'A void obligation requires its recorded return resolution');
  const due = amountOf(order.total_minor), settled = amountOf(row.amount_settled_minor);
  if (due === amountOf(row.amount_due_minor)) return obligationOf(row);
  if (settled > due) throw new BillingFault('REQUIRES_APPROVAL', 'Received money exceeds the final total; resolve the tracked refund before dispatch');
  const unresolved = (await transaction.query(
    "SELECT 1 FROM billing_payment_attempts WHERE obligation_id=$1 AND status IN ('CREATED','PENDING','OUTCOME_UNKNOWN') LIMIT 1", [row.id],
  )).rows.length > 0;
  if (unresolved) throw new BillingFault('PAYMENT_PENDING', 'Reconcile the outstanding payment attempt before changing the amount due');
  const status = v2.deriveObligationStatus({ amountDueMinor: due, amountSettledMinor: settled });
  const updated = (await transaction.query<ObligationRow>(
    'UPDATE billing_obligations SET amount_due_minor=$2,status=$3,version=version+1,updated_at=$4 WHERE id=$1 RETURNING *',
    [row.id, due, status, input.clock?.() ?? new Date()],
  )).rows[0];
  return obligationOf(updated);
}

export class BillingService {
  private readonly executor: ReturnType<typeof createPostgresCommandExecutor>;
  private readonly clock: () => Date;
  private readonly provider: PaymentProviderPort;

  constructor(private readonly options: BillingOptions) {
    this.executor = createPostgresCommandExecutor(options.db);
    this.clock = options.clock ?? (() => new Date());
    this.provider = options.provider ?? new FakePaymentProvider();
  }

  private async tx<T>(work: (tx: PoolClient) => Promise<T>): Promise<T> {
    const tx = await this.options.db.connect();
    let discard = false;
    try {
      await tx.query('BEGIN');
      await tx.query("SET LOCAL statement_timeout='10s'");
      await tx.query("SET LOCAL lock_timeout='3s'");
      const value = await work(tx);
      await tx.query('COMMIT');
      return value;
    } catch (error) {
      try { await tx.query('ROLLBACK'); } catch { discard = true; }
      throw error;
    } finally { tx.release(discard); }
  }

  private async actor(token: string): Promise<v2.Actor> {
    if (!this.options.authenticate) throw new BillingFault('UNAUTHENTICATED', 'Sign in again to continue');
    return (await this.options.authenticate(token)).actor;
  }

  private async actorOf(token: string, allowed: Set<v2.ActorRole>): Promise<v2.Actor> {
    const actor = await this.actor(token);
    if (!allowed.has(actor.role)) throw new BillingFault('FORBIDDEN', 'This operation is not permitted for your role');
    return actor;
  }

  private async ownedOrder(customerId: string, orderId: string): Promise<void> {
    v2.idSchema.parse(orderId);
    const row = (await this.options.db.query<{ id: string }>(
      'SELECT id FROM orders_v2_orders WHERE id=$1 AND customer_id=$2', [orderId, customerId],
    )).rows[0];
    if (!row) throw new BillingFault('NOT_FOUND', 'Order not found');
  }

  private async page<R extends { id: string }, T>(input: {
    table: string;
    filters: string;
    values: unknown[];
    orderColumn: string;
    at: (row: R) => Date | string;
    page: { cursor?: string; limit: number };
    project: (row: R) => T;
  }): Promise<v2.Page<T>> {
    const cursor = decodeCursor(input.page.cursor);
    const values = [...input.values];
    let filters = input.filters;
    if (cursor) {
      values.push(cursor.at, cursor.id);
      filters += ` AND (${input.orderColumn}, id) < ($${values.length - 1}, $${values.length})`;
    }
    values.push(input.page.limit + 1);
    const rows = (await this.options.db.query<R>(
      `SELECT * FROM ${input.table} WHERE ${filters} ORDER BY ${input.orderColumn} DESC, id DESC LIMIT $${values.length}`,
      values,
    )).rows;
    const pageRows = rows.slice(0, input.page.limit);
    const last = pageRows[pageRows.length - 1];
    return {
      items: pageRows.map(input.project),
      pageInfo: {
        hasMore: rows.length > input.page.limit,
        ...(rows.length > input.page.limit && last ? { nextCursor: encodeCursor(input.at(last), last.id) } : {}),
      },
    };
  }

  async createObligation(orderId: string, dueAt?: string): Promise<v2.Obligation> {
    return createObligationForOrder(this.options.db, { orderId, dueAt, clock: this.clock });
  }

  // ---------------------------------------------------------------- reads

  async listOrderObligations(token: string, orderId: string, query: { cursor?: string; limit?: number } = {}): Promise<v2.Page<v2.Obligation>> {
    const customer = await this.actorOf(token, CUSTOMER);
    await this.ownedOrder(customer.id, orderId);
    return this.page<ObligationRow, v2.Obligation>({
      table: 'billing_obligations', filters: 'order_id = $1', values: [orderId],
      orderColumn: 'created_at', at: row => row.created_at,
      page: v2.pageQuerySchema.parse(query), project: obligationOf,
    });
  }

  async listOrderAttempts(token: string, orderId: string, query: { cursor?: string; limit?: number } = {}): Promise<v2.Page<v2.PaymentAttempt>> {
    const customer = await this.actorOf(token, CUSTOMER);
    await this.ownedOrder(customer.id, orderId);
    return this.page<AttemptRow, v2.PaymentAttempt>({
      table: 'billing_payment_attempts',
      filters: 'obligation_id IN (SELECT id FROM billing_obligations WHERE order_id = $1)',
      values: [orderId], orderColumn: 'started_at', at: row => row.started_at,
      page: v2.pageQuerySchema.parse(query), project: attemptOf,
    });
  }

  async listOrderReceipts(token: string, orderId: string, query: { cursor?: string; limit?: number } = {}): Promise<v2.Page<v2.Receipt>> {
    const customer = await this.actorOf(token, CUSTOMER);
    await this.ownedOrder(customer.id, orderId);
    return this.page<ReceiptRow, v2.Receipt>({
      table: 'billing_receipts', filters: 'order_id = $1', values: [orderId],
      orderColumn: 'issued_at', at: row => row.issued_at,
      page: v2.pageQuerySchema.parse(query), project: receiptOf,
    });
  }

  async listOrderRefunds(token: string, orderId: string, query: { cursor?: string; limit?: number } = {}): Promise<v2.Page<v2.Refund>> {
    const customer = await this.actorOf(token, CUSTOMER);
    await this.ownedOrder(customer.id, orderId);
    return this.page<RefundRow, v2.Refund>({
      table: 'billing_refunds', filters: 'order_id = $1', values: [orderId],
      orderColumn: 'requested_at', at: row => row.requested_at,
      page: v2.pageQuerySchema.parse(query), project: refundOf,
    });
  }

  async listObligations(token: string, query: { cursor?: string; limit?: number } = {}): Promise<v2.Page<v2.Obligation>> {
    const customer = await this.actorOf(token, CUSTOMER);
    return this.page<ObligationRow, v2.Obligation>({
      table: 'billing_obligations',
      filters: 'order_id IN (SELECT id FROM orders_v2_orders WHERE customer_id = $1)',
      values: [customer.id], orderColumn: 'created_at', at: row => row.created_at,
      page: v2.pageQuerySchema.parse(query), project: obligationOf,
    });
  }

  async getObligationSummary(token: string, obligationId: string): Promise<v2.BillingSummary> {
    const customer = await this.actorOf(token, CUSTOMER);
    v2.idSchema.parse(obligationId);
    const row = (await this.options.db.query<ObligationRow>(
      `SELECT o.* FROM billing_obligations o
        JOIN orders_v2_orders ord ON ord.id = o.order_id
       WHERE o.id = $1 AND ord.customer_id = $2`, [obligationId, customer.id],
    )).rows[0];
    if (!row) throw new BillingFault('NOT_FOUND', 'Obligation not found');
    const receipts = (await this.options.db.query<ReceiptRow>(
      'SELECT * FROM billing_receipts WHERE obligation_id=$1 ORDER BY issued_at, id', [row.id])).rows.map(receiptOf);
    const refunds = (await this.options.db.query<RefundRow>(
      'SELECT * FROM billing_refunds WHERE obligation_id=$1 ORDER BY requested_at, id', [row.id])).rows.map(refundOf);
    return v2.billingSummarySchema.parse({
      orderId: row.order_id,
      obligationStatus: row.status,
      amountDueMinor: amountOf(row.amount_due_minor),
      amountSettledMinor: amountOf(row.amount_settled_minor),
      currency: row.currency,
      receipts,
      refunds,
      dueAt: iso(row.due_at),
    });
  }

  async listReceiptsForObligation(token: string, obligationId: string, query: { cursor?: string; limit?: number } = {}): Promise<v2.Page<v2.Receipt>> {
    const customer = await this.actorOf(token, CUSTOMER);
    v2.idSchema.parse(obligationId);
    const owned = (await this.options.db.query<{ id: string }>(
      `SELECT o.id FROM billing_obligations o
        JOIN orders_v2_orders ord ON ord.id = o.order_id
       WHERE o.id = $1 AND ord.customer_id = $2`, [obligationId, customer.id],
    )).rows[0];
    if (!owned) throw new BillingFault('NOT_FOUND', 'Obligation not found');
    return this.page<ReceiptRow, v2.Receipt>({
      table: 'billing_receipts', filters: 'obligation_id = $1', values: [obligationId],
      orderColumn: 'issued_at', at: row => row.issued_at,
      page: v2.pageQuerySchema.parse(query), project: receiptOf,
    });
  }

  async listRefunds(token: string, query: { cursor?: string; limit?: number } = {}): Promise<v2.Page<v2.Refund>> {
    const customer = await this.actorOf(token, CUSTOMER);
    return this.page<RefundRow, v2.Refund>({
      table: 'billing_refunds',
      filters: 'order_id IN (SELECT id FROM orders_v2_orders WHERE customer_id = $1)',
      values: [customer.id], orderColumn: 'requested_at', at: row => row.requested_at,
      page: v2.pageQuerySchema.parse(query), project: refundOf,
    });
  }

  // ------------------------------------------------------------ operator

  /** Manual cash/UPI confirmation. The receipt records the staff actor and is
   * labelled MANUAL_*, never a gateway capture. */
  async confirmManual(token: string, obligationId: string, input: v2.ManualPaymentConfirmation, key: string): Promise<v2.Receipt> {
    const parsed = v2.manualPaymentConfirmationSchema.parse(input);
    v2.idSchema.parse(obligationId);
    const operator = await this.actorOf(token, STAFF);
    const payload = { ...parsed, obligationId };
    const commandHash = createHash('sha256').update(canonicalJson({ operation: 'billing.manual.confirm', payload })).digest('hex');
    const traceId = randomUUID();
    const result = await this.executor.execute(
      { actor: operator, operation: 'billing.manual.confirm', idempotencyKey: key, payload: payload as unknown as v2.JsonValue, traceId },
      async () => { await this.actorOf(token, STAFF); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const prior = (await tx.query<ReceiptRow>('SELECT * FROM billing_receipts WHERE command_actor=$1 AND command_key=$2', [operator.id, key])).rows[0];
        if (prior) {
          if (prior.command_hash !== commandHash) throw new BillingFault('IDEMPOTENCY_CONFLICT', 'This key belongs to a different money command');
          return receiptOf(prior) as unknown as v2.JsonValue;
        }
        if ((await tx.query('SELECT 1 FROM billing_refunds WHERE command_actor=$1 AND command_key=$2', [operator.id, key])).rowCount) throw new BillingFault('IDEMPOTENCY_CONFLICT', 'This key belongs to a different money command');
        if (parsed.externalReference) {
          await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`billing-manual-reference:${parsed.externalReference}`]);
          if ((await tx.query("SELECT 1 FROM billing_receipts WHERE external_reference=$1 AND confirmed_via <> 'GATEWAY_CAPTURE'", [parsed.externalReference])).rowCount) throw new BillingFault('INVALID_INPUT', 'This manual transaction reference has already been recorded');
        }
        await this.lockOrderForObligation(tx, obligationId);
        const row = (await tx.query<ObligationRow>(
          'SELECT * FROM billing_obligations WHERE id=$1 FOR UPDATE', [obligationId])).rows[0];
        if (!row) throw new BillingFault('NOT_FOUND', 'Obligation not found');
        if (row.version !== parsed.expectedVersion) {
          throw new BillingFault('VERSION_CONFLICT', 'Obligation changed since it was read', row.version);
        }
        if (row.status === 'VOID') throw new BillingFault('INVALID_INPUT', 'A void obligation cannot receive a payment');
        const settled = amountOf(row.amount_settled_minor) + parsed.amountMinor;
        const status = guard(() => v2.deriveObligationStatus({
          amountDueMinor: amountOf(row.amount_due_minor), amountSettledMinor: settled,
        }));
        const receipt = receiptOf((await tx.query<ReceiptRow>(
          `INSERT INTO billing_receipts
            (id, obligation_id, order_id, amount_minor, currency, method, confirmed_by, confirmed_via, external_reference, provider, provider_event_id, issued_at, command_actor, command_key, command_hash)
           VALUES ($1,$2,$3,$4,'INR',$5,$6,$7,$8,NULL,NULL,$9,$6,$10,$11) RETURNING *`,
          [
            randomUUID(), row.id, row.order_id, parsed.amountMinor, parsed.method, operator.id,
            parsed.method === 'CASH' ? 'MANUAL_CASH' : 'MANUAL_UPI', parsed.externalReference ?? null, this.clock(), key, commandHash,
          ],
        )).rows[0]);
        await tx.query(
          'UPDATE billing_obligations SET amount_settled_minor=$2, status=$3, version=version+1, updated_at=$4 WHERE id=$1',
          [row.id, settled, status, this.clock()],
        );
        await scope.audit({
          aggregateId: row.order_id,
          action: 'BILLING_MANUAL_CONFIRMED',
          reason: parsed.reason,
          before: { status: row.status, amountSettledMinor: amountOf(row.amount_settled_minor) },
          after: { status, amountSettledMinor: settled, receiptId: receipt.id, method: parsed.method, confirmedBy: operator.id },
        });
        if (status === 'SETTLED') {
          await this.publishSettlement(tx, row.id, receipt.id, traceId);
          await this.options.onSettled?.(row.order_id, tx, { actorId: operator.id, actorRole: operator.role, traceId, now: this.clock() });
        }
        return receipt as unknown as v2.JsonValue;
      },
    );
    return v2.receiptSchema.parse(result);
  }

  /** Record refund intent. The provider call is a separate step (`submitRefund`)
   * so external I/O never runs inside the command transaction. */
  async requestRefund(token: string, input: v2.RefundRequest, key: string): Promise<v2.Refund> {
    const parsed = v2.refundRequestSchema.parse(input);
    const operator = await this.actorOf(token, STAFF);
    const commandHash = createHash('sha256').update(canonicalJson({ operation: 'billing.refund.create', payload: parsed })).digest('hex');
    const result = await this.executor.execute(
      { actor: operator, operation: 'billing.refund.create', idempotencyKey: key, payload: parsed as unknown as v2.JsonValue, traceId: randomUUID() },
      async () => { await this.actorOf(token, STAFF); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const prior = (await tx.query<RefundRow>('SELECT * FROM billing_refunds WHERE command_actor=$1 AND command_key=$2', [operator.id, key])).rows[0];
        if (prior) {
          if (prior.command_hash !== commandHash) throw new BillingFault('IDEMPOTENCY_CONFLICT', 'This key belongs to a different money command');
          return refundOf(prior) as unknown as v2.JsonValue;
        }
        if ((await tx.query('SELECT 1 FROM billing_receipts WHERE command_actor=$1 AND command_key=$2', [operator.id, key])).rowCount) throw new BillingFault('IDEMPOTENCY_CONFLICT', 'This key belongs to a different money command');
        const receipt = (await tx.query<ReceiptRow>(
          'SELECT * FROM billing_receipts WHERE id=$1 AND order_id=$2 FOR UPDATE', [parsed.paymentId, parsed.orderId])).rows[0];
        if (!receipt) throw new BillingFault('NOT_FOUND', 'Receipt not found for this order');
        if (receipt.confirmed_via !== 'GATEWAY_CAPTURE') {
          throw new BillingFault('INVALID_INPUT', 'Only a gateway capture can be refunded through the provider port');
        }
        const obligation = (await tx.query<ObligationRow>(
          'SELECT * FROM billing_obligations WHERE id=$1 FOR UPDATE', [parsed.obligationId])).rows[0];
        if (!obligation || obligation.order_id !== parsed.orderId) throw new BillingFault('NOT_FOUND', 'Obligation not found for this order');
        if (obligation.id !== receipt.obligation_id) throw new BillingFault('INVALID_INPUT', 'Receipt does not belong to this obligation');
        if (obligation.version !== parsed.expectedVersion) {
          throw new BillingFault('VERSION_CONFLICT', 'Obligation changed since it was read', obligation.version);
        }
        const sums = (await tx.query<{ succeeded: string; pending: string }>(
          `SELECT
             COALESCE(SUM(amount_minor) FILTER (WHERE status = 'SUCCEEDED'), 0) AS succeeded,
             COALESCE(SUM(amount_minor) FILTER (WHERE status IN ('REQUESTED','PROCESSING','OUTCOME_UNKNOWN')), 0) AS pending
           FROM billing_refunds WHERE receipt_id=$1`, [receipt.id])).rows[0];
        guard(() => v2.assertRefundAllowed({
          capturedMinor: amountOf(receipt.amount_minor),
          refundedMinor: Number(sums.succeeded),
          pendingMinor: Number(sums.pending),
          requestedMinor: parsed.amountMinor,
        }));
        const refund = refundOf((await tx.query<RefundRow>(
          `INSERT INTO billing_refunds
            (id, order_id, receipt_id, obligation_id, status, amount_minor, currency, reason, requested_by, requested_at, resolved_at, external_reference, attempt_count, command_actor, command_key, command_hash)
           VALUES ($1,$2,$3,$4,'REQUESTED',$5,'INR',$6,$7,$8,NULL,NULL,1,$7,$9,$10) RETURNING *`,
          [randomUUID(), parsed.orderId, receipt.id, obligation.id, parsed.amountMinor, parsed.reason, operator.id, this.clock(), key, commandHash],
        )).rows[0]);
        await scope.audit({
          aggregateId: parsed.orderId,
          action: 'BILLING_REFUND_REQUESTED',
          reason: parsed.reason,
          before: { capturedMinor: amountOf(receipt.amount_minor), refundedMinor: Number(sums.succeeded), pendingMinor: Number(sums.pending) },
          after: { refundId: refund.id, amountMinor: parsed.amountMinor, status: refund.status },
        });
        return refund as unknown as v2.JsonValue;
      },
    );
    return v2.refundSchema.parse(result);
  }

  /**
   * Submit or retry a refund against the provider port. The reference is derived
   * from the refund id and kept on the row, so a retry after an unknown outcome
   * asks the provider about the same operation instead of starting a new one.
   */
  async submitRefund(refundId: string): Promise<v2.Refund> {
    v2.idSchema.parse(refundId);
    const prepared = await this.tx(async tx => {
      const row = (await tx.query<RefundRow>('SELECT * FROM billing_refunds WHERE id=$1 FOR UPDATE', [refundId])).rows[0];
      if (!row) throw new BillingFault('NOT_FOUND', 'Refund not found');
      if (row.status !== 'REQUESTED' && row.status !== 'FAILED' && row.status !== 'OUTCOME_UNKNOWN') {
        return { row, proceed: false as const };
      }
      const receipt = (await tx.query<ReceiptRow>('SELECT * FROM billing_receipts WHERE id=$1', [row.receipt_id])).rows[0];
      if (!receipt) throw new BillingFault('NOT_FOUND', 'Receipt not found for this refund');
      const reference = row.external_reference ?? `refund:${row.id}`;
      guard(() => v2.assertRefundTransition(row.status, 'PROCESSING', { reconciledBeforeRetry: row.status !== 'REQUESTED' }));
      const updated = (await tx.query<RefundRow>(
        `UPDATE billing_refunds SET status='PROCESSING', external_reference=$2, attempt_count=attempt_count+1, resolved_at=NULL
         WHERE id=$1 RETURNING *`, [row.id, reference])).rows[0];
      return { row: updated, receipt, proceed: true as const };
    });
    if (!prepared.proceed) return refundOf(prepared.row);
    try {
      const outcome = await this.provider.refund({
        refundId: prepared.row.id,
        providerPaymentReference: prepared.receipt.external_reference ?? '',
        amountMinor: amountOf(prepared.row.amount_minor),
        currency: 'INR',
        reason: prepared.row.reason,
        reference: prepared.row.external_reference!,
      });
      const finished = await this.tx(async tx => {
        const row = (await tx.query<RefundRow>('SELECT * FROM billing_refunds WHERE id=$1 FOR UPDATE', [refundId])).rows[0];
        guard(() => v2.assertRefundTransition(row.status, outcome.outcome, { authoritativeSuccess: outcome.outcome === 'SUCCEEDED' }));
        return (await tx.query<RefundRow>(
          `UPDATE billing_refunds SET status=$2, resolved_at=$3, external_reference=$4 WHERE id=$1 RETURNING *`,
          [refundId, outcome.outcome, this.clock(), outcome.reference])).rows[0];
      });
      return refundOf(finished);
    } catch (error) {
      if (error instanceof BillingFault) throw error;
      await this.tx(async tx => {
        const row = (await tx.query<RefundRow>('SELECT * FROM billing_refunds WHERE id=$1 FOR UPDATE', [refundId])).rows[0];
        guard(() => v2.assertRefundTransition(row.status, 'OUTCOME_UNKNOWN', {}));
        await tx.query("UPDATE billing_refunds SET status='OUTCOME_UNKNOWN' WHERE id=$1", [refundId]);
      });
      throw new BillingFault('PROVIDER_OUTCOME_UNKNOWN', 'Refund outcome is unknown; reconcile the stable reference before a retry');
    }
  }

  async reconcile(token: string, period: string, key: string): Promise<v2.Reconciliation> {
    const operator = await this.actorOf(token, STAFF);
    if (!PERIOD.test(period)) throw new BillingFault('INVALID_INPUT', 'Reconciliation period must be YYYY-MM');
    const bounds = periodBounds(period);
    const result = await this.executor.execute(
      { actor: operator, operation: 'billing.reconcile', idempotencyKey: key, payload: { period } as unknown as v2.JsonValue, traceId: randomUUID() },
      async () => { await this.actorOf(token, STAFF); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const events = (await tx.query<EventRow>(
          'SELECT * FROM billing_provider_events WHERE received_at >= $1 AND received_at < $2 ORDER BY received_at, event_id',
          [bounds.start, bounds.end])).rows;
        const manual = (await tx.query<ReceiptRow>(
          `SELECT * FROM billing_receipts WHERE confirmed_via <> 'GATEWAY_CAPTURE' AND issued_at >= $1 AND issued_at < $2 ORDER BY issued_at, id`,
          [bounds.start, bounds.end])).rows;
        const totals = (await tx.query<{ captured: string; manual: string }>(
          `SELECT
             COALESCE(SUM(amount_minor) FILTER (WHERE confirmed_via = 'GATEWAY_CAPTURE'), 0) AS captured,
             COALESCE(SUM(amount_minor) FILTER (WHERE confirmed_via <> 'GATEWAY_CAPTURE'), 0) AS manual
           FROM billing_receipts WHERE issued_at >= $1 AND issued_at < $2`, [bounds.start, bounds.end])).rows[0];
        const refunded = (await tx.query<{ refunded: string }>(
          `SELECT COALESCE(SUM(amount_minor), 0) AS refunded FROM billing_refunds
            WHERE status='SUCCEEDED' AND resolved_at >= $1 AND resolved_at < $2`, [bounds.start, bounds.end])).rows[0];

        // One provider charge is one ledger line. A replayed event id, or a new
        // event id for the same reference, is the same movement and must not
        // appear twice; an applied event wins over its replay. Unsuccessful
        // outcomes carry no money, so they are not reconciliation entries.
        const byReference = new Map<string, EventRow>();
        for (const event of events) {
          if (event.outcome !== 'SUCCEEDED') continue;
          const reference = `${event.provider}\u0000${event.provider_reference}`;
          const current = byReference.get(reference);
          if (!current || (!current.applied && event.applied)) byReference.set(reference, event);
        }
        const entries: v2.ReconciliationEntry[] = [
          ...[...byReference.values()].map(event => v2.reconciliationEntrySchema.parse({
            id: event.id,
            kind: 'CAPTURE' as const,
            amountMinor: amountOf(event.amount_minor),
            currency: event.currency,
            externalReference: event.provider_reference,
            recordedAt: iso(event.received_at),
            matched: event.applied,
          })),
          ...manual.map(receipt => v2.reconciliationEntrySchema.parse({
            id: receipt.id,
            kind: 'MANUAL' as const,
            amountMinor: amountOf(receipt.amount_minor),
            currency: receipt.currency,
            externalReference: receipt.external_reference ?? receipt.id,
            recordedAt: iso(receipt.issued_at),
            matched: true,
          })),
        ];
        // The period is recomputed, not appended to: repeating reconciliation
        // with a new key must not duplicate entries.
        await tx.query('DELETE FROM billing_reconciliation_entries WHERE period=$1', [period]);
        for (const entry of entries) {
          const source = events.find(event => event.id === entry.id);
          await tx.query(
            `INSERT INTO billing_reconciliation_entries
              (id, period, kind, amount_minor, currency, external_reference, provider, provider_event_id, recorded_at, matched)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              randomUUID(), period, entry.kind, entry.amountMinor, entry.currency, entry.externalReference,
              source?.provider ?? 'manual', source?.event_id ?? null, entry.recordedAt, entry.matched,
            ],
          );
        }
        const unmatchedCount = entries.filter(entry => !entry.matched).length;
        const differenceMinor = entries
          .filter(entry => !entry.matched)
          .reduce((sum, entry) => sum + (entry.kind === 'REFUND' || entry.kind === 'CHARGEBACK' ? -entry.amountMinor : entry.amountMinor), 0);
        const reconciliation = v2.reconciliationSchema.parse({
          periodStart: iso(bounds.start),
          periodEnd: iso(bounds.end),
          entries,
          capturedMinor: amountOf(totals.captured),
          refundedMinor: amountOf(refunded.refunded),
          manualMinor: amountOf(totals.manual),
          unmatchedCount,
          differenceMinor,
        });
        await scope.audit({
          aggregateId: randomUUID(),
          action: 'BILLING_RECONCILED',
          reason: `Reconciled provider activity for ${period}`,
          before: { period },
          after: { capturedMinor: reconciliation.capturedMinor, refundedMinor: reconciliation.refundedMinor, manualMinor: reconciliation.manualMinor, unmatchedCount, differenceMinor },
        });
        return reconciliation as unknown as v2.JsonValue;
      },
    );
    return v2.reconciliationSchema.parse(result);
  }

  // ------------------------------------------------------------- provider

  /**
   * The only provider-facing write. Signature verification happens before the
   * first database write, and `billing_provider_events` deduplicates on
   * (provider, event_id) without a TTL.
   */
  async processWebhook(provider: string, rawBody: Buffer, signature: string | undefined): Promise<{ accepted: boolean; duplicate: boolean }> {
    if (!PROVIDER_NAME.test(provider)) throw new BillingFault('UNAUTHENTICATED', 'Unknown payment provider');
    const secret = this.options.webhookSecrets?.[provider];
    if (!secret) throw new BillingFault('UNAUTHENTICATED', 'Unknown payment provider');
    if (!verifyProviderSignature(rawBody, signature, secret)) {
      throw new BillingFault('UNAUTHENTICATED', 'Webhook signature is not valid');
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BillingFault('INVALID_INPUT', 'Webhook body must be valid JSON');
    }
    const payload = v2.paymentWebhookSchema.parse(decoded);
    const payloadHash = createHash('sha256').update(canonicalJson(payload)).digest('hex');

    const result = await this.tx(async tx => {
      const inserted = (await tx.query<EventRow>(
        `INSERT INTO billing_provider_events
          (id, provider, event_id, payment_id, provider_reference, outcome, amount_minor, currency, occurred_at, received_at, payload_hash, applied, duplicate_reference, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'INR',$8,$9,$10,false,false,NULL)
         ON CONFLICT (provider, event_id) DO NOTHING
         RETURNING *`,
        [
          randomUUID(), provider, payload.eventId, payload.paymentId, payload.providerReference,
          payload.outcome, payload.amountMinor, new Date(payload.occurredAt), this.clock(), payloadHash,
        ],
      )).rows[0];
      if (!inserted) {
        const existing = (await tx.query<{ payload_hash: string }>(
          'SELECT payload_hash FROM billing_provider_events WHERE provider=$1 AND event_id=$2', [provider, payload.eventId])).rows[0];
        if (existing && existing.payload_hash !== payloadHash) {
          throw new BillingFault('INVALID_INPUT', 'Provider event id reused with different content');
        }
        return { accepted: true, duplicate: true };
      }

      const attempt = (await tx.query<AttemptRow>(
        'SELECT * FROM billing_payment_attempts WHERE id=$1 FOR UPDATE', [payload.paymentId])).rows[0];
      let applied = false;
      let duplicateReference = false;
      let note: string | null = null;

      if (!attempt) {
        note = 'No local payment attempt matches this provider payment';
      } else if (payload.outcome === 'PENDING') {
        try {
          guard(() => v2.assertPaymentAttemptTransition(attempt.status, 'PENDING', {}));
          await tx.query("UPDATE billing_payment_attempts SET status='PENDING', external_event_id=$2 WHERE id=$1", [attempt.id, payload.eventId]);
          applied = true;
        } catch (error) {
          if (!(error instanceof BillingFault)) throw error;
          note = `Provider outcome PENDING ignored for attempt in ${attempt.status}`;
        }
      } else if (payload.outcome === 'SUCCEEDED') {
        const already = (await tx.query<{ id: string }>(
          'SELECT id FROM billing_receipts WHERE provider=$1 AND external_reference=$2', [provider, payload.providerReference])).rows[0];
        if (attempt.status === 'SUCCEEDED' || already) {
          duplicateReference = true;
          note = 'Capture reference already recorded; no second money movement';
        } else if (payload.amountMinor <= 0) {
          note = 'Zero-amount capture recorded without a receipt';
        } else {
          await this.lockOrderForObligation(tx, attempt.obligation_id);
          const obligation = (await tx.query<ObligationRow>(
            'SELECT * FROM billing_obligations WHERE id=$1 FOR UPDATE', [attempt.obligation_id])).rows[0];
          if (!obligation) {
            note = 'Payment attempt has no obligation';
          } else if (obligation.status === 'VOID') {
            note = 'Obligation is void; the capture needs reconciliation';
          } else if (payload.amountMinor > amountOf(obligation.amount_due_minor) - amountOf(obligation.amount_settled_minor)) {
            note = 'Capture exceeds the remaining due; the balance needs reconciliation';
          } else {
            guard(() => v2.assertPaymentAttemptTransition(attempt.status, 'SUCCEEDED', { authoritativeSuccess: true }));
            const settled = amountOf(obligation.amount_settled_minor) + payload.amountMinor;
            const status = guard(() => v2.deriveObligationStatus({
              amountDueMinor: amountOf(obligation.amount_due_minor), amountSettledMinor: settled,
            }));
            const receipt = (await tx.query<ReceiptRow>(
              `INSERT INTO billing_receipts
                (id, obligation_id, order_id, amount_minor, currency, method, confirmed_by, confirmed_via, external_reference, provider, provider_event_id, issued_at)
               VALUES ($1,$2,$3,$4,'INR','GATEWAY',NULL,'GATEWAY_CAPTURE',$5,$6,$7,$8) RETURNING *`,
              [randomUUID(), obligation.id, obligation.order_id, payload.amountMinor, payload.providerReference, provider, payload.eventId, this.clock()],
            )).rows[0];
            await tx.query(
              `UPDATE billing_payment_attempts SET status='SUCCEEDED', resolved_at=$2, provider_reference=$3, external_event_id=$4
               WHERE id=$1`, [attempt.id, this.clock(), payload.providerReference, payload.eventId],
            );
            await tx.query(
              'UPDATE billing_obligations SET amount_settled_minor=$2, status=$3, version=version+1, updated_at=$4 WHERE id=$1',
              [obligation.id, settled, status, this.clock()],
            );
            if (status === 'SETTLED') {
              await this.publishSettlement(tx, obligation.id, receipt.id, inserted.id);
              await this.options.onSettled?.(obligation.order_id, tx, { actorId: inserted.id, actorRole: 'PROVIDER', traceId: inserted.id, now: this.clock() });
            }
            applied = true;
          }
        }
      } else {
        const target = payload.outcome;
        try {
          guard(() => v2.assertPaymentAttemptTransition(attempt.status, target, {}));
          await tx.query(
            'UPDATE billing_payment_attempts SET status=$2, resolved_at=$3, external_event_id=$4 WHERE id=$1',
            [attempt.id, target, this.clock(), payload.eventId],
          );
          applied = true;
        } catch (error) {
          if (!(error instanceof BillingFault)) throw error;
          note = `Provider outcome ${target} ignored for attempt in ${attempt.status}`;
        }
      }

      await tx.query(
        'UPDATE billing_provider_events SET applied=$2, duplicate_reference=$3, note=$4 WHERE id=$1',
        [inserted.id, applied, duplicateReference, note],
      );
      return { accepted: true, duplicate: false };
    });
    return v2.webhookResultSchema.parse(result);
  }

  private async lockOrderForObligation(tx: PoolClient, obligationId: string): Promise<void> {
    await tx.query(`SELECT ord.id FROM orders_v2_orders ord JOIN billing_obligations o ON o.order_id=ord.id
      WHERE o.id=$1 FOR UPDATE OF ord`, [obligationId]);
  }

  private async publishSettlement(tx: PoolClient, obligationId: string, receiptId: string, traceId: string): Promise<void> {
    const obligation = obligationOf((await tx.query<ObligationRow>('SELECT * FROM billing_obligations WHERE id=$1', [obligationId])).rows[0]);
    const receipt = receiptOf((await tx.query<ReceiptRow>('SELECT * FROM billing_receipts WHERE id=$1', [receiptId])).rows[0]);
    const event = v2.domainEventSchema.parse({ eventId: randomUUID(), eventType: 'payment.settled.v2', schemaVersion: 2,
      aggregateId: obligation.id, aggregateVersion: obligation.version, traceId, occurredAt: this.clock().toISOString(), payload: { obligation, receipt } });
    await tx.query(`INSERT INTO v2_outbox (event_id,aggregate_id,aggregate_version,event_type,envelope)
      VALUES ($1,$2,$3,$4,$5)`, [event.eventId, event.aggregateId, event.aggregateVersion, event.eventType, canonicalJson(event)]);
  }

  // ------------------------------------------------- internal write hooks

  /** Record an independently addressable gateway attempt. There is no published
   * route for this; the coordinator calls it when it starts a payment. */
  async recordAttempt(input: { obligationId: string; method: v2.PaymentMethod; amountMinor: number; providerReference?: string }): Promise<v2.PaymentAttempt> {
    v2.idSchema.parse(input.obligationId);
    v2.moneySchema.parse(input.amountMinor);
    v2.paymentMethodSchema.parse(input.method);
    return this.tx(async tx => {
      // Share the obligation lock with final repricing and receipt settlement.
      const obligation = (await tx.query<ObligationRow>(
        'SELECT * FROM billing_obligations WHERE id=$1 FOR UPDATE', [input.obligationId])).rows[0];
      if (!obligation) throw new BillingFault('NOT_FOUND', 'Obligation not found');
      if (obligation.status === 'VOID') throw new BillingFault('INVALID_INPUT', 'A void obligation cannot start a payment');
      if (input.amountMinor > amountOf(obligation.amount_due_minor) - amountOf(obligation.amount_settled_minor)) {
        throw new BillingFault('INVALID_INPUT', 'A payment attempt cannot exceed the remaining due');
      }
      const row = (await tx.query<AttemptRow>(
        `INSERT INTO billing_payment_attempts
          (id, obligation_id, status, method, amount_minor, provider_reference, external_event_id, started_at, resolved_at, failure_reason, attempt_count)
         VALUES ($1,$2,'CREATED',$3,$4,$5,NULL,$6,NULL,NULL,1) RETURNING *`,
        [randomUUID(), obligation.id, input.method, input.amountMinor, input.providerReference ?? null, this.clock()],
      )).rows[0];
      return attemptOf(row);
    });
  }

  /** Close an attempt that is not backed by an authoritative capture. SUCCEEDED
   * is deliberately unreachable here; only a signed provider event can settle. */
  async resolveAttempt(attemptId: string, outcome: 'PENDING' | 'FAILED' | 'EXPIRED' | 'OUTCOME_UNKNOWN', detail?: { failureReason?: string }): Promise<v2.PaymentAttempt> {
    v2.idSchema.parse(attemptId);
    return this.tx(async tx => {
      const row = (await tx.query<AttemptRow>('SELECT * FROM billing_payment_attempts WHERE id=$1 FOR UPDATE', [attemptId])).rows[0];
      if (!row) throw new BillingFault('NOT_FOUND', 'Payment attempt not found');
      guard(() => v2.assertPaymentAttemptTransition(row.status, outcome, {}));
      const updated = (await tx.query<AttemptRow>(
        `UPDATE billing_payment_attempts SET status=$2, resolved_at=$3, failure_reason=$4 WHERE id=$1 RETURNING *`,
        [attemptId, outcome, outcome === 'PENDING' ? null : this.clock(), detail?.failureReason ?? null],
      )).rows[0];
      if (outcome === 'FAILED' || outcome === 'EXPIRED') {
        await this.lockOrderForObligation(tx, row.obligation_id);
        const order = (await tx.query<{ order_id: string }>('SELECT order_id FROM billing_obligations WHERE id=$1', [row.obligation_id])).rows[0];
        if (order) await this.options.onSettled?.(order.order_id, tx, { actorId: row.id, actorRole: 'PROVIDER', traceId: randomUUID(), now: this.clock() });
      }
      return attemptOf(updated);
    });
  }

  /**
   * Void an unpaid zero-due obligation with an audited resolution. This is the
   * only route to a zero-due return: no receipt is fabricated, and the guard
   * refuses a void over money that was actually due.
   */
  async voidZeroDue(input: { obligationId: string; resolution: { auditId: string; reason: string }; actor: v2.Actor }): Promise<v2.Obligation> {
    v2.idSchema.parse(input.obligationId);
    const traceId = randomUUID();
    return this.tx(async tx => {
      await this.lockOrderForObligation(tx, input.obligationId);
      const row = (await tx.query<ObligationRow>(
        'SELECT * FROM billing_obligations WHERE id=$1 FOR UPDATE', [input.obligationId])).rows[0];
      if (!row) throw new BillingFault('NOT_FOUND', 'Obligation not found');
      if (row.status === 'VOID') return obligationOf(row);
      const status = guard(() => v2.deriveObligationStatus({
        amountDueMinor: amountOf(row.amount_due_minor),
        amountSettledMinor: amountOf(row.amount_settled_minor),
        voidResolution: input.resolution,
      }));
      const updated = (await tx.query<ObligationRow>(
        'UPDATE billing_obligations SET status=$2, void_reason=$3, version=version+1, updated_at=$4 WHERE id=$1 RETURNING *',
        [row.id, status, input.resolution.reason, this.clock()],
      )).rows[0];
      await tx.query(
        `INSERT INTO v2_audit (actor_id, actor_role, aggregate_id, action, reason, before_value, after_value, trace_id)
         VALUES ($1,$2,$3,'BILLING_OBLIGATION_VOIDED',$4,$5,$6,$7)`,
        [
          input.actor.id, input.actor.role, row.id, input.resolution.reason,
          canonicalJson({ status: row.status, amountDueMinor: amountOf(row.amount_due_minor) }),
          canonicalJson({ status, voidReason: input.resolution.reason, auditId: input.resolution.auditId }),
          traceId,
        ],
      );
      await this.options.onSettled?.(row.order_id, tx, { actorId: input.actor.id, actorRole: input.actor.role, traceId, now: this.clock() });
      return obligationOf(updated);
    });
  }

  /**
   * The evidence the order guard needs before a return can complete. It reads
   * money state only; it never asserts custody. An unpaid or unresolved order
   * keeps `settled` false, so `COMPLETE_RETURN` stays blocked.
   */
  async returnGate(orderId: string): Promise<{ settled: boolean; amountRemainingMinor: number; zeroDueResolution?: { auditId: string; reason: string } }> {
    v2.idSchema.parse(orderId);
    // Prefer the live obligation; a void one still answers the gate because its
    // audited resolution is what releases a zero-due return.
    const obligation = (await this.options.db.query<ObligationRow>(
      "SELECT * FROM billing_obligations WHERE order_id=$1 ORDER BY (status <> 'VOID') DESC, created_at DESC LIMIT 1", [orderId])).rows[0];
    if (!obligation) {
      const order = (await this.options.db.query<{ total_minor: string | number }>(
        'SELECT total_minor FROM orders_v2_orders WHERE id=$1', [orderId])).rows[0];
      if (!order) throw new BillingFault('NOT_FOUND', 'Order not found');
      return { settled: false, amountRemainingMinor: amountOf(order.total_minor) };
    }
    if (obligation.status === 'SETTLED') return { settled: true, amountRemainingMinor: 0 };
    if (obligation.status === 'VOID') {
      return {
        settled: true,
        amountRemainingMinor: 0,
        zeroDueResolution: { auditId: obligation.id, reason: obligation.void_reason ?? 'Audited zero-due return' },
      };
    }
    return {
      settled: false,
      amountRemainingMinor: amountOf(obligation.amount_due_minor) - amountOf(obligation.amount_settled_minor),
    };
  }

  /** Exposed for the HTTP adapter, which must pass the untouched request bytes. */
  readonly signatureHeader = WEBHOOK_HEADER;
}
