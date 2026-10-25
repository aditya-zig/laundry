import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { v2 } from '@laundry/contracts';
import { createPostgresCommandExecutor } from '../../shared/src/command-executor';
import { priceLine } from '../../pricing/src';
import type { CatalogService } from '../../catalog/src';
import type { AvailabilityService } from '../../availability/src';
import { OrdersFault } from './errors';

/**
 * Production-v2 ordering.
 *
 * Every state change goes through `guardOrderCommand`, the published pure guard
 * in the contracts package, so an illegal transition cannot be reached by
 * calling a handler in the wrong order. Prices are snapshotted on the quote and
 * carried to the order; later rate-card revisions never reprice them.
 *
 * Capacity composes with B03 inside one transaction: a hold becomes a
 * reservation only if the order row commits, and a cancellation returns the
 * unit exactly once.
 */
/**
 * Cross-module facts B04 cannot assert from its own tables. A pre-pickup
 * cancellation may only complete when there is no live logistics leg and no
 * open payment obligation. Until B05 and B06 are wired the defaults check for
 * the table and treat its absence as "nothing to reconcile"; a row that exists
 * stops the order at CANCEL_REQUESTED for a human.
 */
export interface OrdersReconciliation {
  activeAssignment(orderId: string, client: PoolClient): Promise<boolean>;
  openObligation(orderId: string, client: PoolClient): Promise<boolean>;
}

export interface OrdersOptions {
  db: Pool;
  authenticate?: (token: string) => Promise<{ actor: v2.Actor }>;
  catalog: CatalogService;
  availability: AvailabilityService;
  reconciliation?: OrdersReconciliation;
  /** Coordinator-owned peer composition; must use this exact transaction. */
  onBooked?: (order: v2.Order, transaction: PoolClient) => Promise<void>;
  /** Reconcile final billing and open the return leg in the same transaction. */
  onReady?: (order: v2.Order, transaction: PoolClient) => Promise<v2.Obligation>;
  clock?: () => Date;
  adjustmentMinutes?: number;
}

interface QuoteRow {
  id: string;
  version: number;
  customer_id: string;
  status: 'OPEN' | 'BOOKED' | 'EXPIRED';
  area_id: string;
  address_id: string;
  address_snapshot: { label: string; line1: string; city: string; postalCode: string; coordinates: { lat: number; lng: number } };
  lines: v2.QuoteLine[];
  rate_cards: v2.RateCard[];
  breakdown: v2.QuoteComponent[];
  total_minor: string | number;
  currency: 'INR';
  provisional: boolean;
  pickup_window: v2.ScheduleWindow;
  return_window: v2.ScheduleWindow;
  hold_reference: string | null;
  hold_expires_at: Date | null;
  catalog_version: number;
  expires_at: Date;
  created_at: Date;
}

interface OrderRow {
  id: string;
  version: number;
  status: v2.OrderStatus;
  customer_id: string;
  facility_id: string | null;
  quote_id: string;
  area_id: string;
  address_snapshot: QuoteRow['address_snapshot'];
  lines: v2.OrderLine[];
  rate_cards: v2.RateCard[];
  containers: v2.Container[];
  measured_lines: v2.MeasuredLine[] | null;
  total_minor: string | number;
  currency: 'INR';
  payment_model: 'DUE_AT_RETURN' | 'PREPAID_V1';
  pickup_window: v2.ScheduleWindow;
  return_window: v2.ScheduleWindow;
  hold_id: string | null;
  resume_status: v2.OrderStatus | null;
  quality_check_passed: boolean;
  created_at: Date;
  updated_at: Date;
}

interface AdjustmentRow {
  id: string;
  order_id: string;
  version: number;
  reason: string;
  previous_total_minor: string | number;
  new_total_minor: string | number;
  delta_minor: string | number;
  state: v2.Adjustment['state'];
  expires_at: Date;
  decided_at: Date | null;
  created_at: Date;
}

interface TimelineRow {
  order_id: string;
  seq: number;
  status: v2.OrderStatus;
  label: string;
  actor_role: v2.ActorRole | null;
  reason: string | null;
  occurred_at: Date;
}

const STAFF = new Set<v2.ActorRole>(['OPERATOR', 'ADMIN']);const FULFILLMENT = new Set<v2.ActorRole>(['FACILITY', 'OPERATOR', 'ADMIN']);
const QUEUE_READERS = new Set<v2.ActorRole>(['FACILITY', 'OPERATOR', 'SUPPORT', 'ADMIN']);
const CATALOG_CODES = new Set<string>(v2.serviceCodeSchema.options);
/** Audit identity for scheduler-driven work that has no signed-in actor. */
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

const money = (value: string | number, label = 'Amount'): number => {
  const parsed = v2.moneySchema.safeParse(typeof value === 'string' ? Number(value) : value);
  if (!parsed.success) throw new OrdersFault('INVALID_INPUT', `${label} is not a supported minor-unit amount`);
  return parsed.data;
};

/** Addition that refuses to lose precision. Plain `+` on two safe integers can
 * leave the safe range, and a silent rounding here would change a bill. */
function addMinor(total: number, addend: number, label: string): number {
  const next = total + addend;
  if (!Number.isSafeInteger(next) || next < 0) throw new OrdersFault('INVALID_INPUT', `${label} exceeds the supported amount`);
  return next;
}

const registryPresent = async (client: PoolClient, table: string): Promise<boolean> =>
  (await client.query<{ present: boolean }>('SELECT to_regclass($1) IS NOT NULL AS present', [`public.${table}`])).rows[0].present;

const defaultReconciliation: OrdersReconciliation = {
  async activeAssignment(orderId, client) {
    if (!(await registryPresent(client, 'logistics_assignments'))) return false;
    return ((await client.query('SELECT 1 FROM logistics_assignments WHERE order_id=$1 LIMIT 1', [orderId])).rowCount ?? 0) > 0;
  },
  async openObligation(orderId, client) {
    if (!(await registryPresent(client, 'billing_obligations'))) return false;
    return ((await client.query("SELECT 1 FROM billing_obligations WHERE order_id=$1 AND status <> 'VOID' LIMIT 1", [orderId])).rowCount ?? 0) > 0;
  },
};

function guard(snapshot: v2.OrderTransitionSnapshot, command: v2.OrderCommand, evidence: v2.OrderTransitionEvidence = {}) {
  try {
    return v2.guardOrderCommand(snapshot, command, evidence);
  } catch (error) {
    if (error instanceof v2.TransitionError) throw new OrdersFault(error.code, error.message);
    throw error;
  }
}

/** Only a live proposal constrains care and quality work. A declined or
 * expired adjustment is history: its price was refused, the order keeps the
 * quoted total, and the guard must not treat that decision as pending consent. */
function liveAdjustmentState(state: v2.Adjustment['state'] | undefined): v2.Adjustment['state'] | undefined {
  return state === 'PROPOSED' || state === 'ACCEPTED' ? state : undefined;
}

/** Only actions this module can actually execute are advertised. Receipt
 * approval and delivery confirmation belong to billing and logistics. */
function permittedActions(status: v2.OrderStatus, adjustmentState: v2.Adjustment['state'] | undefined): v2.OrderAction[] {
  const actions: v2.OrderAction[] = [];
  if (status === 'AWAITING_ADJUSTMENT' && adjustmentState === 'PROPOSED') {
    actions.push('ACCEPT_ADJUSTMENT', 'DECLINE_ADJUSTMENT');
  }
  if (status !== 'DELIVERED' && status !== 'CANCELLED' && status !== 'CANCEL_REQUESTED') actions.push('REQUEST_CANCEL');
  return actions;
}

function quote(row: QuoteRow): v2.Quote {
  return v2.quoteSchema.parse({
    id: row.id,
    version: row.version,
    lines: row.lines,
    totalMinor: money(row.total_minor),
    currency: row.currency,
    provisional: row.provisional,
    expiresAt: row.expires_at.toISOString(),
    addressSnapshotId: row.address_id,
    pickupWindow: row.pickup_window,
    promisedReturnWindow: row.return_window,
    ...(row.hold_reference === null ? {} : { holdReference: row.hold_reference }),
    ...(row.hold_expires_at === null ? {} : { holdExpiresAt: row.hold_expires_at.toISOString() }),
    catalogVersion: row.catalog_version,
    breakdown: row.breakdown,
  });
}

function adjustment(row: AdjustmentRow): v2.Adjustment {
  return {
    id: row.id,
    version: row.version,
    reason: row.reason,
    previousTotalMinor: money(row.previous_total_minor),
    newTotalMinor: money(row.new_total_minor),
    deltaMinor: money(row.delta_minor),
    state: row.state,
    expiresAt: row.expires_at.toISOString(),
    ...(row.decided_at === null ? {} : { decidedAt: row.decided_at.toISOString() }),
  };
}

function order(row: OrderRow, timeline: TimelineRow[], current?: AdjustmentRow): v2.Order {
  const adjustmentState = current ? adjustment(current) : undefined;
  return v2.orderSchema.parse({
    id: row.id,
    version: row.version,
    status: row.status,
    customerId: row.customer_id,
    ...(row.facility_id === null ? {} : { facilityId: row.facility_id }),
    lines: row.lines,
    totalMinor: money(row.total_minor),
    currency: row.currency,
    paymentModel: row.payment_model,
    pickupWindow: row.pickup_window,
    promisedReturnWindow: row.return_window,
    createdAt: row.created_at.toISOString(),
    timeline: timeline.map(event => ({
      status: event.status,
      label: event.label,
      at: event.occurred_at.toISOString(),
    })),
    ...(adjustmentState === undefined ? {} : { adjustment: adjustmentState }),
    containers: row.containers,
    ...(row.measured_lines === null ? {} : { measuredLines: row.measured_lines }),
    permittedActions: permittedActions(row.status, adjustmentState?.state),
    deliveryLegs: [],
  });
}

function cursorOf(row: { updated_at: Date; id: string }): string {
  return Buffer.from(`${row.updated_at.toISOString()}|${row.id}`).toString('base64url');
}

function decodeCursor(cursor: string | undefined): { at: Date; id: string } | undefined {
  if (cursor === undefined) return undefined;
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const split = raw.lastIndexOf('|');
  if (split === -1) throw new OrdersFault('INVALID_INPUT', 'Cursor is not valid');
  const at = new Date(raw.slice(0, split));
  if (Number.isNaN(at.getTime())) throw new OrdersFault('INVALID_INPUT', 'Cursor is not valid');
  const id = raw.slice(split + 1);
  if (!v2.idSchema.safeParse(id).success) throw new OrdersFault('INVALID_INPUT', 'Cursor is not valid');
  return { at, id };
}

export class OrdersService {
  private readonly executor: ReturnType<typeof createPostgresCommandExecutor>;
  private readonly clock: () => Date;
  private readonly adjustmentMinutes: number;
  private readonly reconciliation: OrdersReconciliation;
  constructor(private readonly options: OrdersOptions) {
    this.executor = createPostgresCommandExecutor(options.db);
    this.clock = options.clock ?? (() => new Date());
    this.adjustmentMinutes = options.adjustmentMinutes ?? 30;
    this.reconciliation = options.reconciliation ?? defaultReconciliation;
    if (!Number.isSafeInteger(this.adjustmentMinutes) || this.adjustmentMinutes < 1 || this.adjustmentMinutes > 2880) {
      throw new Error('Adjustment lifetime must be between 1 and 2880 minutes');
    }
  }

  /** Sweeps and reads that are not customer commands still need one
   * transaction with an explicit statement timeout. */
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
    if (!this.options.authenticate) throw new OrdersFault('UNAUTHENTICATED', 'Sign in again to continue');
    return (await this.options.authenticate(token)).actor;
  }

  private async actorOf(token: string, allowed: Set<v2.ActorRole>): Promise<v2.Actor> {
    const actor = await this.actor(token);
    if (!allowed.has(actor.role)) throw new OrdersFault('FORBIDDEN', 'This operation is not permitted for your role');
    return actor;
  }

  private async rows<T extends object>(sql: string, values: unknown[] = []): Promise<T[]> {
    return (await this.options.db.query(sql, values)).rows as T[];
  }

  private async timeline(orderId: string, client: Pool | PoolClient = this.options.db): Promise<TimelineRow[]> {
    return (await client.query<TimelineRow>(
      'SELECT * FROM orders_v2_timeline WHERE order_id=$1 ORDER BY seq', [orderId])).rows;
  }

  private async currentAdjustment(orderId: string, client: Pool | PoolClient = this.options.db): Promise<AdjustmentRow | undefined> {
    return (await client.query<AdjustmentRow>(
      "SELECT * FROM orders_v2_adjustments WHERE order_id=$1 AND state IN ('PROPOSED','ACCEPTED','DECLINED','EXPIRED') ORDER BY created_at DESC LIMIT 1",
      [orderId])).rows[0];
  }

  private async appendTimeline(
    tx: PoolClient,
    orderId: string,
    status: v2.OrderStatus,
    label: string,
    actorRole: v2.ActorRole | undefined,
    reason?: string,
  ): Promise<void> {
    await tx.query(`INSERT INTO orders_v2_timeline (id,order_id,seq,status,label,actor_role,reason,occurred_at)
      SELECT $1,$2,COALESCE(MAX(seq),0)+1,$3,$4,$5,$6,$7 FROM orders_v2_timeline WHERE order_id=$2`,
    [randomUUID(), orderId, status, label, actorRole ?? null, reason ?? null, this.clock()]);
  }

  /**
   * Preflight runs outside the command transaction because it reads catalog and
   * availability. Publishing a quote cannot half-succeed: the insert, audit and
   * capacity hold share one transaction below.
   */
  private async prepareQuote(customerId: string, input: v2.QuoteInput) {
    const parsed = v2.quoteInputSchema.parse(input);
    const address = await this.rows<{ id: string; address: QuoteRow['address_snapshot'] }>(
      'SELECT id,address FROM identity_addresses WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL',
      [parsed.addressId, customerId],
    );
    if (address.length === 0) throw new OrdersFault('NOT_FOUND', 'Address not found');
    const area = await this.options.availability.checkArea(address[0].address.postalCode);
    if (area.timezone !== parsed.timezone) throw new OrdersFault('INVALID_INPUT', 'Timezone does not match the service area');

    const lines: v2.QuoteLine[] = [];
    const cards: v2.RateCard[] = [];
    const breakdown: v2.QuoteComponent[] = [];
    const serviceIds: string[] = [];
    for (const line of parsed.lines) {
      const service = await this.options.catalog.serviceById(line.serviceId);
      if (!service) throw new OrdersFault('NOT_FOUND', 'Service is not published');
      if (service.billingUnit !== 'BOTH' && service.billingUnit !== line.billingUnit) {
        throw new OrdersFault('INVALID_INPUT', `${service.code} does not bill in ${line.billingUnit}`);
      }
      if (line.billingUnit === 'PIECE') {
        if (line.garmentTypeId === undefined) throw new OrdersFault('INVALID_INPUT', 'PIECE lines require garmentTypeId');
        const garment = await this.options.catalog.garmentById(line.garmentTypeId);
        if (!garment || !garment.active || !garment.eligibleServiceCodes.includes(service.code)) {
          throw new OrdersFault('INVALID_INPUT', 'Garment is not eligible for this service');
        }
      }
      const card = await this.options.catalog.effectiveRateCard(service.code);
      if (!card) throw new OrdersFault('NOT_FOUND', `No approved effective rate for ${service.code}`);
      const priced = priceLine({
        rateCard: card,
        billingUnit: line.billingUnit,
        ...(line.estimatedWeightGrams === undefined ? {} : { estimatedWeightGrams: line.estimatedWeightGrams }),
        ...(line.pieceQuantity === undefined ? {} : { pieceQuantity: line.pieceQuantity }),
      }, this.clock());
      lines.push({ ...line, unitPriceMinor: priced.unitPriceMinor, lineTotalMinor: priced.lineTotalMinor, rateCardId: card.id, rateCardVersion: card.version, provisional: priced.provisional });
      breakdown.push(...priced.components);
      if (!cards.some(item => item.id === card.id)) cards.push(card);
      if (!serviceIds.includes(service.id)) serviceIds.push(service.id);
    }

    // Tax and fee are flat per rate card, so they apply once to a basket that
    // shares a card rather than once per line.
    let totalMinor = lines.reduce((sum, line) => addMinor(sum, line.lineTotalMinor, 'Quote total'), 0);
    for (const card of cards) {
      for (const extra of card.components) {
        if (extra.kind !== 'TAX' && extra.kind !== 'FEE') continue;
        totalMinor = addMinor(totalMinor, extra.amountMinor, 'Quote total');
        breakdown.push({ label: extra.label, kind: extra.kind, amountMinor: extra.amountMinor });
      }
    }

    const pair = await this.options.availability.resolvePair(area.id, serviceIds, {
      start: parsed.pickupWindow.start, end: parsed.pickupWindow.end,
    });
    if (!pair) throw new OrdersFault('INVALID_INPUT', 'Pickup window is not a published slot');
    if (!pair.available) throw new OrdersFault('NO_CAPACITY', 'That pickup window is no longer available');
    if (new Date(pair.returnWindow.start).getTime() > new Date(parsed.requestedReturnBy).getTime()) {
      throw new OrdersFault('DEADLINE_UNAVAILABLE', 'The requested return time cannot be met');
    }

    return {
      parsed,
      area,
      address: address[0].address,
      lines,
      cards,
      breakdown,
      totalMinor,
      provisional: lines.some(line => line.provisional),
      catalogVersion: cards.reduce((max, card) => Math.max(max, card.version), 1),
      returnWindow: pair.returnWindow,
    };
  }

  async createQuote(token: string, input: v2.QuoteInput, key: string): Promise<v2.Quote> {
    const customer = await this.actorOf(token, new Set<v2.ActorRole>(['CUSTOMER']));
    let prepared: Awaited<ReturnType<OrdersService['prepareQuote']>>;
    try {
      prepared = await this.prepareQuote(customer.id, input);
    } catch (error) {
      // A replay must return the stored quote even if the catalog or capacity
      // moved on since. If no stored result exists the original error surfaces.
      // The parsed payload keeps the replay hash identical to the first attempt.
      const parsed = v2.quoteInputSchema.safeParse(input);
      if (!parsed.success) throw error;
      return this.replay(token, customer, 'orders.quote', parsed.data, key, error);
    }
    const result = await this.executor.execute(
      { actor: customer, operation: 'orders.quote', idempotencyKey: key, payload: prepared.parsed as unknown as v2.JsonValue, traceId: randomUUID() },
      async () => { await this.actor(token); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const owned = (await tx.query('SELECT id FROM identity_addresses WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL', [prepared.parsed.addressId, customer.id])).rows[0];
        if (!owned) throw new OrdersFault('NOT_FOUND', 'Address not found');
        const hold = await this.options.availability.hold(prepared.area.id, prepared.parsed.pickupWindow, tx);
        const id = randomUUID();
        const expiresAt = new Date(Math.min(new Date(hold.expiresAt).getTime(), this.clock().getTime() + 30 * 60_000));
        const row = (await tx.query<QuoteRow>(`INSERT INTO orders_v2_quotes
          (id,version,customer_id,status,area_id,address_id,address_snapshot,lines,rate_cards,breakdown,
           total_minor,currency,provisional,pickup_window,return_window,hold_reference,hold_expires_at,
           catalog_version,expires_at,created_at)
          VALUES ($1,1,$2,'OPEN',$3,$4,$5,$6,$7,$8,$9,'INR',$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`, [
          id, customer.id, prepared.area.id, prepared.parsed.addressId, JSON.stringify(prepared.address),
          JSON.stringify(prepared.lines), JSON.stringify(prepared.cards), JSON.stringify(prepared.breakdown),
          prepared.totalMinor, prepared.provisional, JSON.stringify(prepared.parsed.pickupWindow),
          JSON.stringify(prepared.returnWindow), hold.holdId, expiresAt,
          prepared.catalogVersion, expiresAt, this.clock(),
        ])).rows[0];
        await scope.audit({
          aggregateId: id,
          action: 'QUOTE_CREATED',
          reason: 'Customer requested a quote',
          before: {},
          after: { totalMinor: prepared.totalMinor, lines: prepared.lines.length, areaId: prepared.area.id },
        });
        return quote(row) as unknown as v2.JsonValue;
      },
    );
    return v2.quoteSchema.parse(result);
  }

  /** Replay via the command executor without re-running preflight. */
  private async replay<T>(token: string, actor: v2.Actor, operation: string, payload: unknown, key: string, original: unknown): Promise<T> {
    try {
      const result = await this.executor.execute(
        { actor, operation, idempotencyKey: key, payload: payload as v2.JsonValue, traceId: randomUUID() },
        async () => { await this.actor(token); },
        async () => { throw original; },
      );
      return result as T;
    } catch (error) {
      if (error === original) throw original;
      throw error;
    }
  }

  async bookOrder(token: string, input: v2.BookingInput, key: string): Promise<v2.Order> {
    const parsed = v2.bookingInputSchema.parse(input);
    const customer = await this.actorOf(token, new Set<v2.ActorRole>(['CUSTOMER']));
    const traceId = randomUUID();
    const result = await this.executor.execute(
      { actor: customer, operation: 'orders.book', idempotencyKey: key, payload: parsed as unknown as v2.JsonValue, traceId },
      async () => { await this.actor(token); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const quoteRow = (await tx.query<QuoteRow>(
          'SELECT * FROM orders_v2_quotes WHERE id=$1 AND customer_id=$2 FOR UPDATE', [parsed.quoteId, customer.id])).rows[0];
        if (!quoteRow) throw new OrdersFault('NOT_FOUND', 'Quote not found');
        if (quoteRow.status !== 'OPEN') throw new OrdersFault('QUOTE_EXPIRED', 'Quote is no longer open');
        if (quoteRow.version !== parsed.expectedVersion) {
          throw new OrdersFault('VERSION_CONFLICT', 'Quote changed since it was read', quoteRow.version);
        }
        if (quoteRow.expires_at.getTime() <= this.clock().getTime()) throw new OrdersFault('QUOTE_EXPIRED', 'Quote has expired');
        if (quoteRow.hold_reference === null || quoteRow.hold_expires_at === null || quoteRow.hold_expires_at.getTime() <= this.clock().getTime()) {
          throw new OrdersFault('QUOTE_EXPIRED', 'The capacity hold behind this quote has expired');
        }
        const orderId = randomUUID();
        await this.options.availability.reserve(quoteRow.hold_reference, orderId, tx);
        // The facility is the one that owns the reserved bucket, so staff at that
        // facility can work the order and staff elsewhere cannot see it.
        const facilityId = (await tx.query<{ facility_id: string }>(
          `SELECT b.facility_id FROM availability_holds h
             JOIN availability_buckets b ON b.id = h.bucket_id WHERE h.id=$1`,
          [quoteRow.hold_reference])).rows[0]?.facility_id ?? null;
        const lines: v2.OrderLine[] = quoteRow.lines.map(line => ({
          ...line,
          orderLineId: randomUUID(),
          ...(line.declaredGarmentCount === undefined ? {} : { declaredGarmentCount: line.declaredGarmentCount }),
        }));
        const row = (await tx.query<OrderRow>(`INSERT INTO orders_v2_orders
          (id,version,status,customer_id,facility_id,quote_id,area_id,address_snapshot,lines,rate_cards,
           containers,measured_lines,total_minor,currency,payment_model,pickup_window,return_window,hold_id,
           resume_status,quality_check_passed,created_at,updated_at)
          VALUES ($1,1,'CONFIRMED',$2,$14,$3,$4,$5,$6,$7,'[]'::jsonb,NULL,$8,'INR',$9,$10,$11,$12,NULL,false,$13,$13) RETURNING *`, [
          orderId, customer.id, quoteRow.id, quoteRow.area_id, JSON.stringify(quoteRow.address_snapshot),
          JSON.stringify(lines), JSON.stringify(quoteRow.rate_cards), money(quoteRow.total_minor),
          parsed.paymentModel, JSON.stringify(quoteRow.pickup_window), JSON.stringify(quoteRow.return_window),
          quoteRow.hold_reference, this.clock(), facilityId,
        ])).rows[0];
        await tx.query("UPDATE orders_v2_quotes SET status='BOOKED',version=version+1 WHERE id=$1", [quoteRow.id]);
        await this.appendTimeline(tx, orderId, 'CONFIRMED', 'Order confirmed', 'CUSTOMER');
        await scope.audit({
          aggregateId: orderId,
          action: 'ORDER_BOOKED',
          reason: 'Customer confirmed a quoted basket',
          before: { quoteId: quoteRow.id, quoteVersion: quoteRow.version },
          after: { totalMinor: money(quoteRow.total_minor), lines: lines.length },
        });
        const booked = order(row, await this.timeline(orderId, tx));
        await this.options.onBooked?.(booked, tx);
        await scope.publish({ eventId: randomUUID(), eventType: 'order.confirmed.v2', schemaVersion: 2,
          aggregateId: booked.id, aggregateVersion: booked.version, occurredAt: this.clock().toISOString(), traceId,
          payload: { order: booked, quote: quote(quoteRow) } });
        return booked as unknown as v2.JsonValue;
      },
    );
    return v2.orderSchema.parse(result);
  }

  private async ownedOrder(token: string, orderId: string): Promise<{ actor: v2.Actor; row: OrderRow }> {
    v2.idSchema.parse(orderId);
    const actor = await this.actor(token);
    const row = (await this.options.db.query<OrderRow>('SELECT * FROM orders_v2_orders WHERE id=$1', [orderId])).rows[0];
    if (!row) throw new OrdersFault('NOT_FOUND', 'Order not found');
    if (actor.role === 'CUSTOMER' && row.customer_id !== actor.id) throw new OrdersFault('NOT_FOUND', 'Order not found');
    if (actor.role === 'FACILITY' && (row.facility_id === null || !actor.facilityIds.includes(row.facility_id))) {
      throw new OrdersFault('FORBIDDEN', 'This order is not at your facility');
    }
    if (actor.role !== 'CUSTOMER' && !QUEUE_READERS.has(actor.role)) throw new OrdersFault('FORBIDDEN', 'Order access is not permitted for your role');
    return { actor, row };
  }

  async listOrders(token: string, query: { cursor?: string; limit?: number } = {}): Promise<v2.Page<v2.Order>> {
    const customer = await this.actorOf(token, new Set<v2.ActorRole>(['CUSTOMER']));
    const page = v2.pageQuerySchema.parse(query);
    return this.page('customer_id=$1', [customer.id], page);
  }

  async opsQueue(token: string, query: { cursor?: string; limit?: number; status?: string } = {}): Promise<v2.Page<v2.Order>> {
    const actor = await this.actorOf(token, QUEUE_READERS);
    const page = v2.pageQuerySchema.parse(query);
    const status = query.status === undefined ? undefined : v2.orderStatusSchema.parse(query.status);
    const filters: string[] = [];
    const values: unknown[] = [];
    // Facility staff see their own facility. Operators, support and admins see
    // the whole queue, which is the permission the route table grants them.
    if (actor.role === 'FACILITY') {
      if (actor.facilityIds.length === 0) return { items: [], pageInfo: { hasMore: false } };
      values.push(actor.facilityIds);
      filters.push(`facility_id = ANY($${values.length})`);
    }
    if (status !== undefined) {
      values.push(status);
      filters.push(`status = $${values.length}`);
    }
    return this.page(filters.length === 0 ? 'TRUE' : filters.join(' AND '), values, page);
  }

  private async page(where: string, values: unknown[], page: { cursor?: string; limit: number }): Promise<v2.Page<v2.Order>> {
    const cursor = decodeCursor(page.cursor);
    const filters = [where];
    const args = [...values];
    if (cursor) {
      args.push(cursor.at, cursor.id);
      filters.push(`(updated_at, id) < ($${args.length - 1}, $${args.length})`);
    }
    args.push(page.limit + 1);
    const rows = await this.rows<OrderRow>(
      `SELECT * FROM orders_v2_orders WHERE ${filters.join(' AND ')} ORDER BY updated_at DESC, id DESC LIMIT $${args.length}`,
      args,
    );
    const pageRows = rows.slice(0, page.limit);
    const timelines = pageRows.length === 0 ? [] : (await this.rows<TimelineRow>(
      'SELECT * FROM orders_v2_timeline WHERE order_id = ANY($1) ORDER BY order_id, seq',
      [pageRows.map(row => row.id)],
    ));
    const adjustments = pageRows.length === 0 ? [] : (await this.rows<AdjustmentRow>(
      "SELECT * FROM orders_v2_adjustments WHERE order_id = ANY($1) AND state IN ('PROPOSED','ACCEPTED','DECLINED','EXPIRED') ORDER BY created_at DESC",
      [pageRows.map(row => row.id)],
    ));
    return {
      items: pageRows.map(row => order(
        row,
        timelines.filter(event => event.order_id === row.id),
        adjustments.find(item => item.order_id === row.id),
      )),
      pageInfo: {
        hasMore: rows.length > page.limit,
        ...(rows.length > page.limit ? { nextCursor: cursorOf(pageRows[pageRows.length - 1]) } : {}),
      },
    };
  }

  async getOrder(token: string, orderId: string): Promise<v2.Order> {
    const { row } = await this.ownedOrder(token, orderId);
    return order(row, await this.timeline(row.id), await this.currentAdjustment(row.id));
  }

  async getTimeline(token: string, orderId: string): Promise<v2.OrderTimelineEvent[]> {
    const { row } = await this.ownedOrder(token, orderId);
    const events = await this.timeline(row.id);
    return events.map(event => ({
      status: event.status,
      label: event.label,
      at: event.occurred_at.toISOString(),
      ...(event.actor_role === null ? {} : { actorRole: event.actor_role }),
      ...(event.reason === null ? {} : { reason: event.reason }),
    }));
  }

  /**
   * Cross-module cancellation evidence, computed from rows that exist rather
   * than asserted by the caller. Before pickup there is no care, no custody and
   * no assignment, but each of those is checked so a later integrated B05 or B06
   * row stops the order at CANCEL_REQUESTED instead of silently confirming.
   */
  private async cancellationEvidence(
    row: OrderRow,
    tx: PoolClient,
  ): Promise<{ logisticsCancelled: boolean; capacityReleased: boolean; careStopped: boolean; custodyResolved: boolean; financialResolutionRecorded: boolean }> {
    const hold = row.hold_id === null
      ? undefined
      : (await tx.query<{ status: string }>('SELECT status FROM availability_holds WHERE id=$1', [row.hold_id])).rows[0];
    const untouched = row.measured_lines === null;
    return {
      logisticsCancelled: !(await this.reconciliation.activeAssignment(row.id, tx)),
      capacityReleased: hold === undefined || hold.status === 'RELEASED' || hold.status === 'EXPIRED',
      careStopped: untouched,
      custodyResolved: untouched,
      financialResolutionRecorded: !(await this.reconciliation.openObligation(row.id, tx)),
    };
  }

  /** Cancellation releases capacity and, before pickup, completes immediately.
   * After pickup it only records intent; a human must reconcile custody. */
  async cancel(token: string, orderId: string, input: v2.OrderCancellation, key: string): Promise<v2.Order> {
    const parsed = v2.orderCancellationSchema.parse(input);
    const customer = await this.actorOf(token, new Set<v2.ActorRole>(['CUSTOMER']));
    const result = await this.executor.execute(
      { actor: customer, operation: 'orders.cancel', idempotencyKey: key, payload: { ...parsed, orderId } as unknown as v2.JsonValue, traceId: randomUUID() },
      async () => { await this.actor(token); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const row = (await tx.query<OrderRow>('SELECT * FROM orders_v2_orders WHERE id=$1 AND customer_id=$2 FOR UPDATE', [orderId, customer.id])).rows[0];
        if (!row) throw new OrdersFault('NOT_FOUND', 'Order not found');
        const requested = guard(
          { status: row.status, version: row.version, ...(row.resume_status === null ? {} : { resumeStatus: row.resume_status }) },
          { type: 'REQUEST_CANCEL', expectedVersion: parsed.expectedVersion, reason: parsed.reason },
        );
        if (row.hold_id) await this.options.availability.release(row.hold_id, parsed.reason, tx);
        const evidence = await this.cancellationEvidence(row, tx);
        let status: v2.OrderStatus = requested.status;
        if (row.status === 'CONFIRMED' || row.status === 'PICKUP_PENDING') {
          const complete = evidence.logisticsCancelled && evidence.capacityReleased && evidence.careStopped
            && evidence.custodyResolved && evidence.financialResolutionRecorded;
          if (complete) {
            status = guard({ status: requested.status, version: row.version }, {
              type: 'CONFIRM_CANCEL', expectedVersion: parsed.expectedVersion, reason: parsed.reason,
            }, evidence).status;
          }
        }
        const cancelled = status === 'CANCELLED';
        const updated = (await tx.query<OrderRow>(
          'UPDATE orders_v2_orders SET status=$2,version=version+1,updated_at=$3 WHERE id=$1 RETURNING *', [orderId, status, this.clock()])).rows[0];
        await this.appendTimeline(tx, orderId, status, cancelled ? 'Order cancelled' : 'Cancellation requested', 'CUSTOMER', parsed.reason);
        await scope.audit({
          aggregateId: orderId,
          action: cancelled ? 'ORDER_CANCELLED' : 'ORDER_CANCEL_REQUESTED',
          reason: parsed.reason,
          before: { status: row.status, holdId: row.hold_id },
          after: { status, ...evidence },
        });
        return order(updated, await this.timeline(orderId, tx), await this.currentAdjustment(orderId, tx)) as unknown as v2.JsonValue;
      },
    );
    return v2.orderSchema.parse(result);
  }

  /**
   * The only path out of CANCEL_REQUESTED. B05 and B06 own the facts this
   * needs, so the caller supplies a verified actor and B04 re-checks what it
   * can see. Missing facts are reported, never assumed.
   */
  async confirmCancellationBy(actor: v2.Actor, orderId: string, reason: string): Promise<v2.Order> {
    v2.idSchema.parse(orderId);
    if (!reason.trim()) throw new OrdersFault('INVALID_INPUT', 'A cancellation reason is required');
    return this.tx(async tx => {
      const row = (await tx.query<OrderRow>('SELECT * FROM orders_v2_orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
      if (!row) throw new OrdersFault('NOT_FOUND', 'Order not found');
      if (row.hold_id) await this.options.availability.release(row.hold_id, reason, tx);
      const evidence = await this.cancellationEvidence(row, tx);
      const missing = Object.entries(evidence).filter(([, value]) => !value).map(([key]) => key);
      if (missing.length > 0) {
        throw new OrdersFault('REQUIRES_APPROVAL', `Cancellation reconciliation is incomplete: ${missing.join(', ')}`);
      }
      const next = guard({ status: row.status, version: row.version }, {
        type: 'CONFIRM_CANCEL', expectedVersion: row.version, reason,
      }, evidence);
      const updated = (await tx.query<OrderRow>(
        'UPDATE orders_v2_orders SET status=$2,version=version+1,updated_at=$3 WHERE id=$1 RETURNING *', [orderId, next.status, this.clock()])).rows[0];
      await this.appendTimeline(tx, orderId, next.status, 'Order cancelled after reconciliation', actor.role, reason);
      await tx.query(`INSERT INTO v2_audit (actor_id, actor_role, aggregate_id, action, reason, before_value, after_value, trace_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
        actor.id, actor.role, orderId, 'ORDER_CANCELLED', reason,
        JSON.stringify({ status: row.status }), JSON.stringify({ status: next.status, ...evidence }), randomUUID(),
      ]);
      return order(updated, await this.timeline(orderId, tx), await this.currentAdjustment(orderId, tx));
    });
  }

  async reschedule(token: string, orderId: string, input: v2.OrderReschedule, key: string): Promise<v2.Order> {
    const parsed = v2.orderRescheduleSchema.parse(input);
    const customer = await this.actorOf(token, new Set<v2.ActorRole>(['CUSTOMER']));
    const result = await this.executor.execute(
      { actor: customer, operation: 'orders.reschedule', idempotencyKey: key, payload: { ...parsed, orderId } as unknown as v2.JsonValue, traceId: randomUUID() },
      async () => { await this.actor(token); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const row = (await tx.query<OrderRow>('SELECT * FROM orders_v2_orders WHERE id=$1 AND customer_id=$2 FOR UPDATE', [orderId, customer.id])).rows[0];
        if (!row) throw new OrdersFault('NOT_FOUND', 'Order not found');
        if (row.version !== parsed.expectedVersion) throw new OrdersFault('VERSION_CONFLICT', 'Order changed since it was read', row.version);
        if (row.status !== 'CONFIRMED' && row.status !== 'PICKUP_PENDING') {
          throw new OrdersFault('FORBIDDEN', 'Pickup has started; rescheduling now needs staff reconciliation');
        }
        const quoteRow = (await tx.query<QuoteRow>(
          'SELECT * FROM orders_v2_quotes WHERE id=$1 AND customer_id=$2 FOR UPDATE', [parsed.newQuoteId, customer.id])).rows[0];
        if (!quoteRow) throw new OrdersFault('NOT_FOUND', 'Quote not found');
        if (quoteRow.status !== 'OPEN') throw new OrdersFault('QUOTE_EXPIRED', 'Quote is no longer open');
        if (quoteRow.version !== parsed.quoteVersion) throw new OrdersFault('VERSION_CONFLICT', 'Quote changed since it was read', quoteRow.version);
        if (quoteRow.expires_at.getTime() <= this.clock().getTime()) throw new OrdersFault('QUOTE_EXPIRED', 'Quote has expired');
        if (quoteRow.area_id !== row.area_id) throw new OrdersFault('INVALID_INPUT', 'A reschedule must stay inside the same service area');
        if (quoteRow.hold_reference === null) throw new OrdersFault('QUOTE_EXPIRED', 'The new quote has no capacity hold');
        // The unique reservation index allows one live reservation per order, so
        // the superseded one is returned before the replacement is reserved.
        if (row.hold_id && row.hold_id !== quoteRow.hold_reference) {
          await this.options.availability.release(row.hold_id, 'Superseded by reschedule', tx);
        }
        await this.options.availability.reserve(quoteRow.hold_reference, orderId, tx);
        const facilityId = (await tx.query<{ facility_id: string }>(
          `SELECT b.facility_id FROM availability_holds h
             JOIN availability_buckets b ON b.id = h.bucket_id WHERE h.id=$1`,
          [quoteRow.hold_reference])).rows[0]?.facility_id ?? null;
        const lines: v2.OrderLine[] = quoteRow.lines.map(line => ({ ...line, orderLineId: randomUUID() }));
        const updated = (await tx.query<OrderRow>(`UPDATE orders_v2_orders SET
          lines=$2,rate_cards=$3,total_minor=$4,pickup_window=$5,return_window=$6,hold_id=$7,
          quote_id=$8,facility_id=$10,version=version+1,updated_at=$9 WHERE id=$1 RETURNING *`, [
          orderId, JSON.stringify(lines), JSON.stringify(quoteRow.rate_cards), money(quoteRow.total_minor),
          JSON.stringify(quoteRow.pickup_window), JSON.stringify(quoteRow.return_window), quoteRow.hold_reference,
          quoteRow.id, this.clock(), facilityId,
        ])).rows[0];
        await tx.query("UPDATE orders_v2_quotes SET status='BOOKED',version=version+1 WHERE id=$1", [quoteRow.id]);
        await tx.query("UPDATE orders_v2_quotes SET status='EXPIRED',version=version+1 WHERE id=$1", [row.quote_id]);
        await this.appendTimeline(tx, orderId, 'CONFIRMED', 'Order rescheduled', 'CUSTOMER');
        await scope.audit({
          aggregateId: orderId,
          action: 'ORDER_RESCHEDULED',
          reason: 'Customer moved the pickup window',
          before: { pickup: row.pickup_window.start, totalMinor: money(row.total_minor) },
          after: { pickup: quoteRow.pickup_window.start, totalMinor: money(quoteRow.total_minor) },
        });
        return order(updated, await this.timeline(orderId, tx)) as unknown as v2.JsonValue;
      },
    );
    return v2.orderSchema.parse(result);
  }

  async decideAdjustment(token: string, orderId: string, input: v2.AdjustmentDecision, key: string): Promise<v2.Order> {
    const parsed = v2.adjustmentDecisionSchema.parse(input);
    const customer = await this.actorOf(token, new Set<v2.ActorRole>(['CUSTOMER']));
    const result = await this.executor.execute(
      { actor: customer, operation: 'orders.adjustment.decide', idempotencyKey: key, payload: { ...parsed, orderId } as unknown as v2.JsonValue, traceId: randomUUID() },
      async () => { await this.actor(token); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const row = (await tx.query<OrderRow>('SELECT * FROM orders_v2_orders WHERE id=$1 AND customer_id=$2 FOR UPDATE', [orderId, customer.id])).rows[0];
        if (!row) throw new OrdersFault('NOT_FOUND', 'Order not found');
        const current = await this.currentAdjustment(orderId, tx);
        const decision = guard({
          status: row.status,
          version: row.version,
          ...(row.resume_status === null ? {} : { resumeStatus: row.resume_status }),
          ...(current === undefined ? {} : { adjustmentState: current.state, adjustment: { id: current.id, version: current.version, expiresAt: current.expires_at.toISOString() } }),
        }, { type: 'DECIDE_ADJUSTMENT', expectedVersion: parsed.expectedVersion, decision: parsed, now: this.clock().toISOString() },
        // An accepted adjustment returns to AT_FACILITY, which requires the
        // intake this order already recorded.
        { facilityIntakeAccepted: row.measured_lines !== null });
        const state = parsed.decision === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED';
        await tx.query('UPDATE orders_v2_adjustments SET state=$2, decided_at=$3, version=version+1 WHERE id=$1',
          [parsed.adjustmentId, state, this.clock()]);
        const total = parsed.decision === 'ACCEPT' ? money(current!.new_total_minor) : money(row.total_minor);
        const updated = (await tx.query<OrderRow>(`UPDATE orders_v2_orders SET
          status=$2,resume_status=$3,total_minor=$4,version=version+1,updated_at=$5 WHERE id=$1 RETURNING *`, [
          orderId, decision.status, decision.resumeStatus ?? null, total, this.clock(),
        ])).rows[0];
        await this.appendTimeline(tx, orderId, decision.status,
          parsed.decision === 'ACCEPT' ? 'Adjustment accepted' : 'Adjustment declined',
          'CUSTOMER', current?.reason);
        await scope.audit({
          aggregateId: orderId,
          action: `ADJUSTMENT_${state}`,
          reason: current?.reason ?? 'Adjustment decision',
          before: { status: row.status, totalMinor: money(row.total_minor), ...(current === undefined ? {} : { adjustmentState: current.state }) },
          after: { status: decision.status, totalMinor: total, adjustmentState: state },
        });
        return order(updated, await this.timeline(orderId, tx), await this.currentAdjustment(orderId, tx)) as unknown as v2.JsonValue;
      },
    );
    return v2.orderSchema.parse(result);
  }

  private async fulfillmentOrder(token: string, orderId: string, allowed: Set<v2.ActorRole>): Promise<{ actor: v2.Actor; row: OrderRow }> {
    v2.idSchema.parse(orderId);
    const actor = await this.actorOf(token, allowed);
    const row = (await this.options.db.query<OrderRow>('SELECT * FROM orders_v2_orders WHERE id=$1', [orderId])).rows[0];
    if (!row) throw new OrdersFault('NOT_FOUND', 'Order not found');
    if (actor.role === 'FACILITY' && row.facility_id !== null && !actor.facilityIds.includes(row.facility_id)) {
      throw new OrdersFault('FORBIDDEN', 'This order belongs to another facility');
    }
    return { actor, row };
  }

  /**
   * B06 hook: the pickup leg moves a confirmed order into the pickup workflow.
   * There is no customer-facing route for it, so it takes a signed-in staff
   * token rather than becoming an unauthenticated backdoor.
   */
  async markPickupPending(token: string, orderId: string): Promise<v2.Order> {
    const actor = await this.actorOf(token, FULFILLMENT);
    return this.markPickupPendingBy(actor, orderId);
  }

  /** Service-to-service variant for B06, which already authenticated the actor. */
  async markPickupPendingBy(actor: v2.Actor, orderId: string): Promise<v2.Order> {
    v2.idSchema.parse(orderId);
    return this.tx(async tx => {
      const row = (await tx.query<OrderRow>('SELECT * FROM orders_v2_orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
      if (!row) throw new OrdersFault('NOT_FOUND', 'Order not found');
      if (actor.role === 'FACILITY' && (row.facility_id === null || !actor.facilityIds.includes(row.facility_id))) {
        throw new OrdersFault('FORBIDDEN', 'This order is not at your facility');
      }
      const next = guard({ status: row.status, version: row.version },
        { type: 'MARK_PICKUP_PENDING', expectedVersion: row.version });
      const updated = (await tx.query<OrderRow>(
        'UPDATE orders_v2_orders SET status=$2,version=version+1,updated_at=$3 WHERE id=$1 RETURNING *',
        [orderId, next.status, this.clock()])).rows[0];
      await this.appendTimeline(tx, orderId, next.status, 'Pickup started', actor.role);
      await tx.query(`INSERT INTO v2_audit (actor_id, actor_role, aggregate_id, action, reason, before_value, after_value, trace_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
        actor.id, actor.role, orderId, 'ORDER_PICKUP_STARTED', 'Pickup leg started by logistics',
        JSON.stringify({ status: row.status }), JSON.stringify({ status: next.status }), randomUUID(),
      ]);
      return order(updated, await this.timeline(orderId, tx), await this.currentAdjustment(orderId, tx));
    });
  }

  /** Intake is the measured truth. A higher measured total becomes a proposed
   * adjustment; a lower one simply lowers the bill and never adds a charge. */
  async recordIntake(token: string, orderId: string, input: v2.IntakeRecord, key: string): Promise<v2.Order> {
    const parsed = v2.intakeRecordSchema.parse(input);
    const { actor } = await this.fulfillmentOrder(token, orderId, FULFILLMENT);
    const result = await this.executor.execute(
      { actor, operation: 'orders.ops.intake', idempotencyKey: key, payload: { ...parsed, orderId } as unknown as v2.JsonValue, traceId: randomUUID() },
      async () => { await this.fulfillmentOrder(token, orderId, FULFILLMENT); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const row = (await tx.query<OrderRow>('SELECT * FROM orders_v2_orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
        if (!row) throw new OrdersFault('NOT_FOUND', 'Order not found');
        const received = guard({ status: row.status, version: row.version },
          { type: 'RECORD_INTAKE', expectedVersion: parsed.expectedVersion },
          { facilityIntakeAccepted: true });

        const measuredById = new Map(parsed.lines.map(line => [line.orderLineId, line]));
        let measuredTotal = 0;
        for (const line of row.lines) {
          measuredTotal = addMinor(measuredTotal, this.measuredLineTotal(line, measuredById.get(line.orderLineId), row.rate_cards), 'Measured total');
        }
        let total = measuredTotal;
        for (const card of row.rate_cards) {
          for (const extra of card.components) {
            if (extra.kind === 'TAX' || extra.kind === 'FEE') total = addMinor(total, extra.amountMinor, 'Measured total');
          }
        }
        const previous = money(row.total_minor);

        let status: v2.OrderStatus = received.status;
        let adjustment: AdjustmentRow | undefined;
        if (total > previous) {
          const proposed = guard({ status: received.status, version: row.version },
            { type: 'PROPOSE_ADJUSTMENT', expectedVersion: parsed.expectedVersion, previousTotalMinor: previous, newTotalMinor: total, reason: 'Measured weight exceeds the quote' },
            { facilityIntakeAccepted: true });
          status = proposed.status;
          const id = randomUUID();
          adjustment = (await tx.query<AdjustmentRow>(`INSERT INTO orders_v2_adjustments
            (id,order_id,version,reason,previous_total_minor,new_total_minor,delta_minor,state,expires_at,decided_at,created_at)
            VALUES ($1,$2,1,$3,$4,$5,$6,'PROPOSED',$7,NULL,$8) RETURNING *`, [
            id, orderId, 'Measured weight exceeds the quote', previous, total, total - previous,
            new Date(this.clock().getTime() + this.adjustmentMinutes * 60_000), this.clock(),
          ])).rows[0];
        }

        const updated = (await tx.query<OrderRow>(`UPDATE orders_v2_orders SET
          status=$2,measured_lines=$3,containers=$4,total_minor=$5,version=version+1,updated_at=$6
          WHERE id=$1 RETURNING *`, [
          orderId, status, JSON.stringify(parsed.lines), JSON.stringify(parsed.containers),
          adjustment ? previous : total, this.clock(),
        ])).rows[0];
        await this.appendTimeline(tx, orderId, status,
          adjustment ? 'Measured total needs customer consent' : 'Measured intake recorded', actor.role);
        await scope.audit({
          aggregateId: orderId,
          action: 'ORDER_INTAKE_RECORDED',
          reason: adjustment ? 'Measured weight exceeds the quote' : 'Facility recorded measured intake',
          before: { status: row.status, totalMinor: previous },
          after: { status, measuredTotal: total, ...(adjustment === undefined ? {} : { adjustmentId: adjustment.id }), containers: parsed.containers.length },
        });
        return order(updated, await this.timeline(orderId, tx), adjustment) as unknown as v2.JsonValue;
      },
    );
    return v2.orderSchema.parse(result);
  }

  private measuredLineTotal(line: v2.OrderLine, measured: v2.MeasuredLine | undefined, cards: v2.RateCard[]): number {
    const card = cards.find(item => line.rateCardId === undefined || item.id === line.rateCardId) ?? cards[0];
    if (!card) throw new OrdersFault('INVALID_INPUT', 'Order has no rate snapshot for a line');
    if (line.billingUnit === 'KG') {
      if (measured?.measuredWeightGrams === undefined) throw new OrdersFault('INVALID_INPUT', 'KG lines require measuredWeightGrams at intake');
      return priceLine({ rateCard: card, billingUnit: 'KG', estimatedWeightGrams: measured.measuredWeightGrams }, this.clock()).lineTotalMinor;
    }
    const quantity = measured?.measuredPieceQuantity;
    if (quantity === undefined) throw new OrdersFault('INVALID_INPUT', 'PIECE lines require measuredPieceQuantity at intake; countedQuantity includes accessories and is not a billable count');
    return priceLine({ rateCard: card, billingUnit: 'PIECE', pieceQuantity: quantity }, this.clock()).lineTotalMinor;
  }

  /** Care is refused while a proposed adjustment is unanswered, because the
   * customer has not agreed to the price. */
  async recordCare(token: string, orderId: string, input: v2.CareUpdate, key: string): Promise<v2.Order> {
    const parsed = v2.careUpdateSchema.parse(input);
    const { actor } = await this.fulfillmentOrder(token, orderId, FULFILLMENT);
    const result = await this.executor.execute(
      { actor, operation: 'orders.ops.care', idempotencyKey: key, payload: { ...parsed, orderId } as unknown as v2.JsonValue, traceId: randomUUID() },
      async () => { await this.fulfillmentOrder(token, orderId, FULFILLMENT); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const row = (await tx.query<OrderRow>('SELECT * FROM orders_v2_orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
        if (!row) throw new OrdersFault('NOT_FOUND', 'Order not found');
        const current = await this.currentAdjustment(orderId, tx);
        const command: v2.OrderCommand = parsed.target === 'IN_CARE'
          ? { type: 'START_CARE', expectedVersion: parsed.expectedVersion }
          : { type: 'START_QUALITY_CHECK', expectedVersion: parsed.expectedVersion };
        const next = guard({
          status: row.status,
          version: row.version,
          ...(liveAdjustmentState(current?.state) === undefined ? {} : { adjustmentState: liveAdjustmentState(current?.state) }),
        }, command, {
          facilityIntakeAccepted: row.measured_lines !== null,
        });
        const updated = (await tx.query<OrderRow>(
          'UPDATE orders_v2_orders SET status=$2,version=version+1,updated_at=$3 WHERE id=$1 RETURNING *',
          [orderId, next.status, this.clock()])).rows[0];
        await this.appendTimeline(tx, orderId, next.status,
          parsed.target === 'IN_CARE' ? 'Care started' : 'Quality check started', actor.role, parsed.reason);
        await scope.audit({
          aggregateId: orderId,
          action: parsed.target === 'IN_CARE' ? 'CARE_STARTED' : 'QUALITY_CHECK_STARTED',
          reason: parsed.reason ?? 'Facility care update',
          before: { status: row.status },
          after: { status: next.status },
        });
        return order(updated, await this.timeline(orderId, tx), current) as unknown as v2.JsonValue;
      },
    );
    return v2.orderSchema.parse(result);
  }

  async recordQualityCheck(token: string, orderId: string, input: v2.QualityCheck, key: string): Promise<v2.Order> {
    const parsed = v2.qualityCheckSchema.parse(input);
    const { actor } = await this.fulfillmentOrder(token, orderId, FULFILLMENT);
    const traceId = randomUUID();
    const result = await this.executor.execute(
      { actor, operation: 'orders.ops.qc', idempotencyKey: key, payload: { ...parsed, orderId } as unknown as v2.JsonValue, traceId },
      async () => { await this.fulfillmentOrder(token, orderId, FULFILLMENT); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const row = (await tx.query<OrderRow>('SELECT * FROM orders_v2_orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
        if (!row) throw new OrdersFault('NOT_FOUND', 'Order not found');
        const current = await this.currentAdjustment(orderId, tx);
        const snapshot = {
          status: row.status,
          version: row.version,
          ...(liveAdjustmentState(current?.state) === undefined ? {} : { adjustmentState: liveAdjustmentState(current?.state) }),
        };
        // A pass moves to READY_FOR_RETURN and a failure moves to IN_CARE, and
        // both targets require the accepted intake this order already recorded.
        const evidence = {
          facilityIntakeAccepted: row.measured_lines !== null,
          ...(parsed.passed ? { qualityCheckPassed: true } : {}),
        };
        const next = parsed.passed
          ? guard(snapshot, { type: 'PASS_QUALITY_CHECK', expectedVersion: parsed.expectedVersion }, evidence)
          : guard(snapshot, { type: 'REWORK', expectedVersion: parsed.expectedVersion, reason: parsed.note ?? 'Failed quality check' }, evidence);
        const updated = (await tx.query<OrderRow>(`UPDATE orders_v2_orders SET
          status=$2,containers=$3,quality_check_passed=$4,version=version+1,updated_at=$5 WHERE id=$1 RETURNING *`, [
          orderId, next.status, JSON.stringify(parsed.containers), parsed.passed, this.clock(),
        ])).rows[0];
        await this.appendTimeline(tx, orderId, next.status, parsed.passed ? 'Quality check passed' : 'Quality check failed', actor.role, parsed.note);
        await scope.audit({
          aggregateId: orderId,
          action: parsed.passed ? 'QUALITY_CHECK_PASSED' : 'QUALITY_CHECK_FAILED',
          reason: parsed.note ?? (parsed.passed ? 'Quality check passed' : 'Quality check failed'),
          before: { status: row.status, containers: row.containers.length },
          after: { status: next.status, containers: parsed.containers.length },
        });
        const ready = order(updated, await this.timeline(orderId, tx));
        if (parsed.passed && this.options.onReady) {
          const obligation = v2.obligationSchema.parse(await this.options.onReady(ready, tx));
          if (obligation.orderId !== ready.id || obligation.amountDueMinor !== ready.totalMinor) {
            throw new OrdersFault('INVALID_INPUT', 'The return obligation must match the accepted order total');
          }
          await scope.publish({ eventId: randomUUID(), eventType: 'order.ready-for-return.v2', schemaVersion: 2,
            aggregateId: ready.id, aggregateVersion: ready.version, occurredAt: this.clock().toISOString(), traceId,
            payload: { orderId: ready.id, readyAt: this.clock().toISOString(), obligation } });
        }
        return ready as unknown as v2.JsonValue;
      },
    );
    return v2.orderSchema.parse(result);
  }

  async holdOrder(token: string, orderId: string, input: v2.OrderHold, key: string): Promise<v2.Order> {
    const parsed = v2.orderHoldSchema.parse(input);
    const actor = await this.actorOf(token, STAFF);
    const result = await this.executor.execute(
      { actor, operation: 'orders.ops.hold', idempotencyKey: key, payload: { ...parsed, orderId } as unknown as v2.JsonValue, traceId: randomUUID() },
      async () => { await this.actorOf(token, STAFF); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const row = (await tx.query<OrderRow>('SELECT * FROM orders_v2_orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
        if (!row) throw new OrdersFault('NOT_FOUND', 'Order not found');
        const current = await this.currentAdjustment(orderId, tx);
        const next = guard({
          status: row.status,
          version: row.version,
          ...(row.resume_status === null ? {} : { resumeStatus: row.resume_status }),
          ...(current === undefined ? {} : { adjustmentState: current.state }),
        }, { type: 'HOLD', expectedVersion: parsed.expectedVersion, reason: parsed.reason });
        const updated = (await tx.query<OrderRow>(
          'UPDATE orders_v2_orders SET status=$2,resume_status=$3,version=version+1,updated_at=$4 WHERE id=$1 RETURNING *',
          [orderId, next.status, next.resumeStatus ?? null, this.clock()])).rows[0];
        await this.appendTimeline(tx, orderId, next.status, 'Order placed on hold', actor.role, parsed.reason);
        await scope.audit({
          aggregateId: orderId,
          action: 'ORDER_HELD',
          reason: parsed.reason,
          before: { status: row.status },
          after: { status: next.status, ...(next.resumeStatus === undefined ? {} : { resumeStatus: next.resumeStatus }) },
        });
        return order(updated, await this.timeline(orderId, tx), current) as unknown as v2.JsonValue;
      },
    );
    return v2.orderSchema.parse(result);
  }

  async resolveException(token: string, orderId: string, input: v2.ExceptionResolution, key: string): Promise<v2.Order> {
    const parsed = v2.exceptionResolutionSchema.parse(input);
    const actor = await this.actorOf(token, new Set<v2.ActorRole>(['OPERATOR', 'SUPPORT', 'ADMIN']));
    if (parsed.action === 'AGREED_RETURN') {
      throw new OrdersFault('REQUIRES_APPROVAL', 'An agreed unpaid return needs a recorded payment obligation from billing');
    }
    const result = await this.executor.execute(
      { actor, operation: 'orders.ops.exception', idempotencyKey: key, payload: { ...parsed, orderId } as unknown as v2.JsonValue, traceId: randomUUID() },
      async () => { await this.actorOf(token, new Set<v2.ActorRole>(['OPERATOR', 'SUPPORT', 'ADMIN'])); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const row = (await tx.query<OrderRow>('SELECT * FROM orders_v2_orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
        if (!row) throw new OrdersFault('NOT_FOUND', 'Order not found');
        if (parsed.action === 'CANCEL' && row.status === 'CANCEL_REQUESTED') {
          throw new OrdersFault('REQUIRES_APPROVAL', 'Cancellation is already requested; reconcile custody, logistics and money before confirming it');
        }
        if (parsed.action === 'CANCEL' && row.hold_id) {
          await this.options.availability.release(row.hold_id, parsed.reason, tx);
        }
        const snapshot = {
          status: row.status,
          version: row.version,
          ...(row.resume_status === null ? {} : { resumeStatus: row.resume_status }),
        };
        const evidence = { facilityIntakeAccepted: row.measured_lines !== null };
        const next = parsed.action === 'RESUME'
          ? guard(snapshot, { type: 'RESUME', expectedVersion: parsed.expectedVersion, reason: parsed.reason }, evidence)
          : parsed.action === 'ESCALATE'
            ? guard(snapshot, { type: 'REQUIRE_RESOLUTION', expectedVersion: parsed.expectedVersion, reason: parsed.reason }, evidence)
            : guard(snapshot, { type: 'REQUEST_CANCEL', expectedVersion: parsed.expectedVersion, reason: parsed.reason }, evidence);
        const updated = (await tx.query<OrderRow>(
          'UPDATE orders_v2_orders SET status=$2,resume_status=$3,version=version+1,updated_at=$4 WHERE id=$1 RETURNING *',
          [orderId, next.status, next.resumeStatus ?? null, this.clock()])).rows[0];
        await this.appendTimeline(tx, orderId, next.status, `Exception resolved: ${parsed.action}`, actor.role, parsed.reason);
        await scope.audit({
          aggregateId: orderId,
          action: `ORDER_EXCEPTION_${parsed.action}`,
          reason: parsed.reason,
          before: { status: row.status },
          after: { status: next.status },
        });
        return order(updated, await this.timeline(orderId, tx), await this.currentAdjustment(orderId, tx)) as unknown as v2.JsonValue;
      },
    );
    return v2.orderSchema.parse(result);
  }

  /** Unanswered adjustments expire into a hold. Repeating the sweep is a no-op.
   * The order row is locked before the adjustment so the lock order matches the
   * customer decision path; otherwise the two transactions can abort each other. */
  async expireAdjustments(limit = 100): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new OrdersFault('INVALID_INPUT', 'A sweep limit is required');
    let expired = 0;
    while (true) {
      const batch = await this.tx(async tx => {
        const candidates = (await tx.query<{ id: string; order_id: string; reason: string }>(`SELECT id,order_id,reason
          FROM orders_v2_adjustments WHERE state='PROPOSED' AND expires_at <= $1
          ORDER BY expires_at, id LIMIT $2`, [this.clock(), limit])).rows;
        let handled = 0;
        for (const candidate of candidates) {
          const row = (await tx.query<OrderRow>('SELECT * FROM orders_v2_orders WHERE id=$1 FOR UPDATE', [candidate.order_id])).rows[0];
          if (!row || row.status !== 'AWAITING_ADJUSTMENT') continue;
          const closed = await tx.query(
            "UPDATE orders_v2_adjustments SET state='EXPIRED',decided_at=$2,version=version+1 WHERE id=$1 AND state='PROPOSED' RETURNING id",
            [candidate.id, this.clock()],
          );
          if (closed.rowCount === 0) continue;
          const next = guard({ status: row.status, version: row.version, resumeStatus: 'AT_FACILITY' },
            { type: 'HOLD', expectedVersion: row.version, reason: 'Adjustment expired unanswered' });
          const updated = (await tx.query<OrderRow>(`UPDATE orders_v2_orders SET
            status=$2,resume_status=$3,version=version+1,updated_at=$4 WHERE id=$1 RETURNING *`,
          [row.id, next.status, next.resumeStatus ?? null, this.clock()])).rows[0];
          await this.appendTimeline(tx, row.id, next.status, 'Adjustment expired unanswered', undefined, candidate.reason);
          await tx.query(`INSERT INTO v2_audit (actor_id, actor_role, aggregate_id, action, reason, before_value, after_value, trace_id)
            VALUES ($1,'SYSTEM',$2,$3,$4,$5,$6,$7)`, [
            SYSTEM_ACTOR_ID, row.id, 'ADJUSTMENT_EXPIRED', candidate.reason,
            JSON.stringify({ status: row.status, adjustmentId: candidate.id }),
            JSON.stringify({ status: next.status, resumeStatus: next.resumeStatus ?? null, orderVersion: updated.version }),
            randomUUID(),
          ]);
          handled += 1;
        }
        return handled;
      });
      expired += batch;
      if (batch < limit) return expired;
    }
  }
}
