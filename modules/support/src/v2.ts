import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ZodError, type ZodType } from 'zod';
import { v2 } from '@laundry/contracts';
import { createPostgresCommandExecutor } from '../../shared/src/command-executor';
import { SupportFault } from './errors';

/**
 * Production-v2 support incidents, messages and rewash requests.
 *
 * An incident is a record of a complaint, never an order command. Opening one
 * leaves the order status and version untouched, and a rewash request creates a
 * new work item instead of pretending the original order was completed again.
 * Closing an incident requires a named operator, a reason and an outcome, so an
 * incident cannot quietly disappear.
 */
export interface SupportOptions {
  db: Pool;
  authenticate?: (token: string) => Promise<{ actor: v2.Actor }>;
  clock?: () => Date;
}

interface IncidentRow {
  id: string;
  order_id: string;
  customer_id: string;
  status: v2.IncidentStatus;
  category: v2.IncidentCategory;
  summary: string;
  detail: string | null;
  media_ids: string[];
  resolution_outcome: v2.IncidentResolution['outcome'] | null;
  refund_amount_minor: string | number | null;
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: Date | null;
  rewash_request_id: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface MessageRow {
  id: string;
  incident_id: string;
  seq: number;
  author_role: v2.IncidentMessage['authorRole'];
  author_id: string;
  body: string;
  media_ids: string[];
  created_at: Date;
}

interface RewashRow {
  id: string;
  incident_id: string;
  order_id: string;
  status: v2.RewashRequest['status'];
  reason: string;
  created_at: Date;
  completed_at: Date | null;
  version: number;
}

interface OrderRow {
  id: string;
  customer_id: string;
  status: v2.OrderStatus;
  version: number;
}

const CUSTOMERS = new Set<v2.ActorRole>(['CUSTOMER']);
const STAFF = new Set<v2.ActorRole>(['OPERATOR', 'SUPPORT', 'ADMIN']);
const MESSAGE_READERS = new Set<v2.ActorRole>(['CUSTOMER', 'OPERATOR', 'SUPPORT', 'ADMIN']);
/** An order can only be washed again once it physically came back. */
const REWASHABLE = new Set<v2.OrderStatus>(['READY_FOR_RETURN', 'RETURNING', 'DELIVERED']);

function parse<T>(schema: ZodType<T>, value: unknown, label: string): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new SupportFault('INVALID_INPUT', `${label}: ${error.issues[0]?.message ?? 'invalid input'}`);
    }
    throw error;
  }
}

function id(value: string, label: string): string {
  return parse(v2.idSchema, value, label);
}

const money = (value: string | number): number => Number(value);

function cursorOf(row: { created_at: Date; id: string }): string {
  return Buffer.from(`${row.created_at.toISOString()}|${row.id}`).toString('base64url');
}

function decodeCursor(cursor: string | undefined): { at: Date; id: string } | undefined {
  if (cursor === undefined) return undefined;
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const split = raw.lastIndexOf('|');
  if (split === -1) throw new SupportFault('INVALID_INPUT', 'Cursor is not valid');
  const at = new Date(raw.slice(0, split));
  if (Number.isNaN(at.getTime())) throw new SupportFault('INVALID_INPUT', 'Cursor is not valid');
  return { at, id: raw.slice(split + 1) };
}

function seqCursor(value: number | undefined): string | undefined {
  return value === undefined ? undefined : Buffer.from(`s|${value}`).toString('base64url');
}

function decodeSeqCursor(cursor: string | undefined): number | undefined {
  if (cursor === undefined) return undefined;
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!raw.startsWith('s|')) throw new SupportFault('INVALID_INPUT', 'Cursor is not valid');
  const seq = Number(raw.slice(2));
  if (!Number.isSafeInteger(seq) || seq < 0) throw new SupportFault('INVALID_INPUT', 'Cursor is not valid');
  return seq;
}

export class SupportService {
  private readonly executor: ReturnType<typeof createPostgresCommandExecutor>;
  private readonly clock: () => Date;
  constructor(private readonly options: SupportOptions) {
    this.executor = createPostgresCommandExecutor(options.db);
    this.clock = options.clock ?? (() => new Date());
  }

  private async actor(token: string): Promise<v2.Actor> {
    if (!this.options.authenticate) throw new SupportFault('UNAUTHENTICATED', 'Sign in again to continue');
    return (await this.options.authenticate(token)).actor;
  }

  private async actorOf(token: string, allowed: Set<v2.ActorRole>): Promise<v2.Actor> {
    const actor = await this.actor(token);
    if (!allowed.has(actor.role)) throw new SupportFault('FORBIDDEN', 'This operation is not permitted for your role');
    return actor;
  }

  private async rows<T extends object>(sql: string, values: unknown[] = []): Promise<T[]> {
    return (await this.options.db.query(sql, values)).rows as T[];
  }

  private incident(row: IncidentRow): v2.Incident {
    return parse(v2.incidentSchema, {
      id: row.id,
      orderId: row.order_id,
      status: row.status,
      category: row.category,
      summary: row.summary,
      ...(row.detail === null ? {} : { detail: row.detail }),
      mediaIds: row.media_ids,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      ...(row.resolved_at === null ? {} : { resolvedAt: row.resolved_at.toISOString() }),
      ...(row.resolution === null ? {} : { resolution: row.resolution }),
      ...(row.rewash_request_id === null ? {} : { rewashRequestId: row.rewash_request_id }),
      version: row.version,
    }, 'Stored incident is not valid');
  }

  private message(row: MessageRow): v2.IncidentMessage {
    return parse(v2.incidentMessageSchema, {
      id: row.id,
      incidentId: row.incident_id,
      authorRole: row.author_role,
      authorId: row.author_id,
      body: row.body,
      mediaIds: row.media_ids,
      createdAt: row.created_at.toISOString(),
    }, 'Stored incident message is not valid');
  }

  private rewash(row: RewashRow): v2.RewashRequest {
    return parse(v2.rewashRequestSchema, {
      id: row.id,
      incidentId: row.incident_id,
      orderId: row.order_id,
      status: row.status,
      reason: row.reason,
      createdAt: row.created_at.toISOString(),
      ...(row.completed_at === null ? {} : { completedAt: row.completed_at.toISOString() }),
      version: row.version,
    }, 'Stored rewash request is not valid');
  }

  /** A customer sees only their own incident; staff see every incident they are
   * routed to. A customer asking for someone else's incident gets NOT_FOUND so
   * the route does not confirm that the incident exists. */
  private async visibleIncident(actor: v2.Actor, incidentId: string, client: Pool | PoolClient = this.options.db): Promise<IncidentRow> {
    const row = (await client.query<IncidentRow>('SELECT * FROM support_v2_incidents WHERE id=$1', [id(incidentId, 'incidentId')])).rows[0];
    if (!row) throw new SupportFault('NOT_FOUND', 'Incident not found');
    if (actor.role === 'CUSTOMER') {
      if (row.customer_id !== actor.id) throw new SupportFault('NOT_FOUND', 'Incident not found');
      return row;
    }
    if (!MESSAGE_READERS.has(actor.role)) throw new SupportFault('FORBIDDEN', 'Incident access is not permitted for your role');
    return row;
  }

  private authorRole(role: v2.ActorRole): v2.IncidentMessage['authorRole'] {
    if (role === 'CUSTOMER' || role === 'SUPPORT' || role === 'OPERATOR') return role;
    // The message contract has no ADMIN author. An administrator writing into
    // the thread is recorded as an operator, the role that shares the queue.
    if (role === 'ADMIN') return 'OPERATOR';
    throw new SupportFault('FORBIDDEN', 'This role cannot write to an incident');
  }

  async createIncident(token: string, orderId: string, input: v2.IncidentInput, key: string): Promise<v2.Incident> {
    const parsed = parse(v2.incidentInputSchema, input, 'Incident');
    const pathOrderId = id(orderId, 'orderId');
    if (parsed.orderId !== pathOrderId) throw new SupportFault('INVALID_INPUT', 'Order id in the body must match the path');
    const customer = await this.actorOf(token, CUSTOMERS);
    const result = await this.executor.execute(
      { actor: customer, operation: 'support.incidents.create', idempotencyKey: key, payload: { ...parsed, orderId: pathOrderId } as unknown as v2.JsonValue, traceId: randomUUID() },
      async () => { await this.actorOf(token, CUSTOMERS); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const order = (await tx.query<OrderRow>('SELECT id,customer_id,status,version FROM orders_v2_orders WHERE id=$1 AND customer_id=$2', [pathOrderId, customer.id])).rows[0];
        if (!order) throw new SupportFault('NOT_FOUND', 'Order not found');
        const at = this.clock();
        const row = (await tx.query<IncidentRow>(`INSERT INTO support_v2_incidents
          (id,order_id,customer_id,status,category,summary,detail,media_ids,resolution_outcome,refund_amount_minor,
           resolution,resolved_by,resolved_at,rewash_request_id,version,created_at,updated_at)
          VALUES ($1,$2,$3,'OPEN',$4,$5,$6,$7,NULL,NULL,NULL,NULL,NULL,NULL,1,$8,$8) RETURNING *`, [
          randomUUID(), order.id, customer.id, parsed.category, parsed.summary, parsed.detail ?? null,
          JSON.stringify(parsed.mediaIds), at,
        ])).rows[0];
        await scope.audit({
          aggregateId: row.id,
          action: 'INCIDENT_OPENED',
          reason: 'Customer opened a support incident',
          before: {},
          after: { orderId: order.id, category: parsed.category, mediaIds: parsed.mediaIds.length },
        });
        return this.incident(row) as unknown as v2.JsonValue;
      },
    );
    return parse(v2.incidentSchema, result, 'Incident');
  }

  async listIncidents(token: string, query: { cursor?: string; limit?: number } = {}): Promise<v2.Page<v2.Incident>> {
    const customer = await this.actorOf(token, CUSTOMERS);
    const page = parse(v2.pageQuerySchema, query, 'Page query');
    const cursor = decodeCursor(page.cursor);
    const args: unknown[] = [customer.id];
    let where = 'customer_id=$1';
    if (cursor) {
      args.push(cursor.at, cursor.id);
      where += ` AND (created_at, id) < ($2::timestamptz, $3::uuid)`;
    }
    args.push(page.limit + 1);
    const rows = await this.rows<IncidentRow>(
      `SELECT * FROM support_v2_incidents WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${args.length}`,
      args,
    );
    const items = rows.slice(0, page.limit);
    return {
      items: items.map(row => this.incident(row)),
      pageInfo: {
        hasMore: rows.length > page.limit,
        ...(rows.length > page.limit && items.length > 0 ? { nextCursor: cursorOf(items[items.length - 1]) } : {}),
      },
    };
  }

  async listMessages(token: string, incidentId: string, query: { cursor?: string; limit?: number } = {}): Promise<v2.Page<v2.IncidentMessage>> {
    const actor = await this.actor(token);
    if (!MESSAGE_READERS.has(actor.role)) throw new SupportFault('FORBIDDEN', 'Incident access is not permitted for your role');
    await this.visibleIncident(actor, incidentId);
    const page = parse(v2.pageQuerySchema, query, 'Page query');
    const last = decodeSeqCursor(page.cursor);
    const args: unknown[] = [incidentId];
    let where = 'incident_id=$1';
    if (last !== undefined) {
      args.push(last);
      where += ` AND seq > $2`;
    }
    args.push(page.limit + 1);
    const rows = await this.rows<MessageRow>(
      `SELECT * FROM support_v2_incident_messages WHERE ${where} ORDER BY seq ASC LIMIT $${args.length}`,
      args,
    );
    const items = rows.slice(0, page.limit);
    return {
      items: items.map(row => this.message(row)),
      pageInfo: {
        hasMore: rows.length > page.limit,
        ...(rows.length > page.limit && items.length > 0 ? { nextCursor: seqCursor(items[items.length - 1].seq) } : {}),
      },
    };
  }

  async appendMessage(token: string, incidentId: string, input: v2.IncidentMessageInput, key: string): Promise<v2.IncidentMessage> {
    const parsed = parse(v2.incidentMessageInputSchema, input, 'Incident message');
    const actor = await this.actor(token);
    if (!MESSAGE_READERS.has(actor.role)) {
      throw new SupportFault('FORBIDDEN', 'This role cannot write to an incident');
    }
    const result = await this.executor.execute(
      { actor, operation: 'support.incidents.messages', idempotencyKey: key, payload: { ...parsed, incidentId } as unknown as v2.JsonValue, traceId: randomUUID() },
      async () => {
        const current = await this.actor(token);
        if (!MESSAGE_READERS.has(current.role)) throw new SupportFault('FORBIDDEN', 'Incident access is not permitted for your role');
      },
      async scope => {
        const tx: PoolClient = scope.handle;
        // Lock the incident so two writers cannot pick the same sequence number.
        const incident = (await tx.query<IncidentRow>('SELECT * FROM support_v2_incidents WHERE id=$1 FOR UPDATE', [id(incidentId, 'incidentId')])).rows[0];
        if (!incident) throw new SupportFault('NOT_FOUND', 'Incident not found');
        if (actor.role === 'CUSTOMER' && incident.customer_id !== actor.id) throw new SupportFault('NOT_FOUND', 'Incident not found');
        const row = (await tx.query<MessageRow>(`INSERT INTO support_v2_incident_messages
          (id,incident_id,seq,author_role,author_id,body,media_ids,created_at)
          SELECT $1,$2,COALESCE(MAX(seq),0)+1,$3,$4,$5,$6,$7 FROM support_v2_incident_messages WHERE incident_id=$2
          RETURNING *`, [
          randomUUID(), incident.id, this.authorRole(actor.role), actor.id, parsed.body,
          JSON.stringify(parsed.mediaIds), this.clock(),
        ])).rows[0];
        await scope.audit({
          aggregateId: incident.id,
          action: 'INCIDENT_MESSAGE_ADDED',
          reason: `Message added by ${actor.role.toLowerCase()}`,
          before: { status: incident.status, version: incident.version },
          after: { messageId: row.id, seq: row.seq, mediaIds: parsed.mediaIds.length },
        });
        return this.message(row) as unknown as v2.JsonValue;
      },
    );
    return parse(v2.incidentMessageSchema, result, 'Incident message');
  }

  /** Resolution is the only way an incident closes. A different key on an
   * already closed incident is refused, so a second click cannot overwrite the
   * first decision or its reason. */
  async resolveIncident(token: string, incidentId: string, input: v2.IncidentResolutionInput, key: string): Promise<v2.Incident> {
    const parsed = parse(v2.incidentResolutionInputSchema, input, 'Incident resolution');
    const actor = await this.actorOf(token, STAFF);
    const result = await this.executor.execute(
      { actor, operation: 'support.incidents.resolve', idempotencyKey: key, payload: { ...parsed, incidentId } as unknown as v2.JsonValue, traceId: randomUUID() },
      async () => { await this.actorOf(token, STAFF); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const incident = (await tx.query<IncidentRow>('SELECT * FROM support_v2_incidents WHERE id=$1 FOR UPDATE', [id(incidentId, 'incidentId')])).rows[0];
        if (!incident) throw new SupportFault('NOT_FOUND', 'Incident not found');
        if (incident.status === 'RESOLVED' || incident.status === 'REJECTED') {
          throw new SupportFault('INVALID_INPUT', 'This incident already has a recorded resolution');
        }
        if (incident.version !== parsed.expectedVersion) {
          throw new SupportFault('VERSION_CONFLICT', 'Incident changed since it was read', incident.version);
        }
        const at = this.clock();
        const row = (await tx.query<IncidentRow>(`UPDATE support_v2_incidents SET
          status='RESOLVED',resolution=$2,resolution_outcome=$3,refund_amount_minor=$4,resolved_by=$5,
          resolved_at=$6,version=version+1,updated_at=$6 WHERE id=$1 RETURNING *`, [
          incident.id, parsed.reason, parsed.outcome,
          parsed.outcome === 'REFUND' ? parsed.refundAmountMinor! : null, actor.id, at,
        ])).rows[0];
        await scope.audit({
          aggregateId: incident.id,
          action: 'INCIDENT_RESOLVED',
          reason: parsed.reason,
          before: { status: incident.status, version: incident.version },
          after: {
            status: row.status,
            version: row.version,
            outcome: parsed.outcome,
            ...(parsed.refundAmountMinor === undefined ? {} : { refundAmountMinor: parsed.refundAmountMinor }),
          },
        });
        return this.incident(row) as unknown as v2.JsonValue;
      },
    );
    return parse(v2.incidentSchema, result, 'Incident');
  }

  /** A rewash is a new request against the same order. The original order keeps
   * its status, version and timeline; only after a later completion event does
   * the rewash row carry a completion time. */
  async requestRewash(token: string, incidentId: string, input: v2.RewashRequestInput, key: string): Promise<v2.RewashRequest> {
    const parsed = parse(v2.rewashRequestInputSchema, input, 'Rewash request');
    const customer = await this.actorOf(token, CUSTOMERS);
    const result = await this.executor.execute(
      { actor: customer, operation: 'support.rewash.create', idempotencyKey: key, payload: { ...parsed, incidentId } as unknown as v2.JsonValue, traceId: randomUUID() },
      async () => { await this.actorOf(token, CUSTOMERS); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const incident = (await tx.query<IncidentRow>('SELECT * FROM support_v2_incidents WHERE id=$1 FOR UPDATE', [id(incidentId, 'incidentId')])).rows[0];
        if (!incident || incident.customer_id !== customer.id) throw new SupportFault('NOT_FOUND', 'Incident not found');
        if (incident.status === 'RESOLVED' || incident.status === 'REJECTED') {
          throw new SupportFault('INVALID_INPUT', 'A closed incident cannot request a rewash');
        }
        if (incident.version !== parsed.expectedVersion) {
          throw new SupportFault('VERSION_CONFLICT', 'Incident changed since it was read', incident.version);
        }
        const order = (await tx.query<OrderRow>('SELECT id,customer_id,status,version FROM orders_v2_orders WHERE id=$1 AND customer_id=$2', [incident.order_id, customer.id])).rows[0];
        if (!order) throw new SupportFault('NOT_FOUND', 'Order not found');
        if (!REWASHABLE.has(order.status)) {
          throw new SupportFault('INVALID_INPUT', 'A rewash needs an order that has been returned or is on its way back');
        }
        const existing = (await tx.query<{ id: string }>('SELECT id FROM support_v2_rewashes WHERE incident_id=$1', [incident.id])).rows[0];
        if (existing) throw new SupportFault('INVALID_INPUT', 'A rewash request already exists for this incident');
        const at = this.clock();
        const row = (await tx.query<RewashRow>(`INSERT INTO support_v2_rewashes
          (id,incident_id,order_id,status,reason,created_at,completed_at,version)
          VALUES ($1,$2,$3,'REQUESTED',$4,$5,NULL,1) RETURNING *`, [
          randomUUID(), incident.id, order.id, parsed.reason, at,
        ])).rows[0];
        await tx.query('UPDATE support_v2_incidents SET rewash_request_id=$2,version=version+1,updated_at=$3 WHERE id=$1', [incident.id, row.id, at]);
        await scope.audit({
          aggregateId: incident.id,
          action: 'REWASH_REQUESTED',
          reason: parsed.reason,
          before: { status: incident.status, orderStatus: order.status },
          after: { rewashRequestId: row.id, rewashStatus: row.status, orderStatus: order.status, orderVersion: order.version },
        });
        return this.rewash(row) as unknown as v2.JsonValue;
      },
    );
    return parse(v2.rewashRequestSchema, result, 'Rewash request');
  }
}
