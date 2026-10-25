import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { v2 } from '@laundry/contracts';
import { createPostgresCommandExecutor, canonicalJson } from '../../shared/src/command-executor';
import { CustodyCodeMismatch, LogisticsFault } from './v2-errors';
import type { DeliveryReconciliation } from '../../orders/src/completion';

/**
 * Production-v2 logistics: assignment, pickup and return custody, handover
 * proof, exceptions, provider events and customer tracking.
 *
 * Order state changes never leave this module unguarded. Every one calls
 * `guardOrderCommand` from the contracts package; leg attempts call
 * `assertLegTransition`. The order row and its timeline are written inside the
 * same transaction as the logistics fact and the `v2_audit` row, so a handover
 * cannot record custody without moving the order, and a replay cannot move it
 * twice.
 *
 * No maps, routing, SMS or geocoding provider is called. The distance/ETA
 * calculator, the custody code notifier, the provider signature verifier and
 * the optional auto-assignment port are interfaces with deterministic in-repo
 * fakes. Codes are stored as keyed digests and are never logged.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface DistanceEta {
  distanceMeters: number;
  etaMinutes: number;
}

/** Fake distance and ETA calculator. Haversine straight-line distance over a
 * fixed speed, so the same input always produces the same output. No road
 * network, traffic or map provider is involved. */
export interface DistanceEtaCalculator {
  estimate(from: GeoPoint, to: GeoPoint): DistanceEta;
}

export class FakeDistanceEtaCalculator implements DistanceEtaCalculator {
  constructor(private readonly speedMetersPerSecond = 6) {
    if (!(speedMetersPerSecond > 0)) throw new Error('Fake ETA speed must be positive');
  }

  estimate(from: GeoPoint, to: GeoPoint): DistanceEta {
    const radius = 6_371_000;
    const rad = (value: number) => (value * Math.PI) / 180;
    const dLat = rad(to.lat - from.lat);
    const dLng = rad(to.lng - from.lng);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(dLng / 2) ** 2;
    const distanceMeters = Math.round(2 * radius * Math.asin(Math.min(1, Math.sqrt(a))));
    return { distanceMeters, etaMinutes: Math.max(1, Math.ceil(distanceMeters / this.speedMetersPerSecond / 60)) };
  }
}

export interface AutoAssignmentCandidate {
  riderId: string;
  location: GeoPoint;
}

/**
 * Port for approval-free automatic assignment. Deliberately unused by the
 * published routes: the coordinator can wire a dispatcher here once the
 * approval and rider-capacity rules are agreed. Keeping the interface free of
 * database and provider types means a fake and a real adapter are
 * interchangeable.
 */
export interface AutoAssignmentPort {
  propose(input: {
    orderId: string;
    leg: v2.Leg;
    origin: GeoPoint;
    candidates: readonly AutoAssignmentCandidate[];
  }): Promise<AutoAssignmentCandidate | undefined>;
}

export function createFakeAutoAssignmentPort(calculator: DistanceEtaCalculator = new FakeDistanceEtaCalculator()): AutoAssignmentPort {
  return {
    async propose(input) {
      let best: { candidate: AutoAssignmentCandidate; eta: number } | undefined;
      for (const candidate of input.candidates) {
        const eta = calculator.estimate(input.origin, candidate.location).etaMinutes;
        if (!best || eta < best.eta) best = { candidate, eta };
      }
      return best?.candidate;
    },
  };
}

/** Custody codes leave the process only through this port. The published
 * routes never return the code, so delivery is the notifier's job. */
export interface CustodyCodeNotifier {
  send(input: {
    orderId: string;
    legAttemptId: string;
    riderId: string;
    code: string;
    expiresAt: string;
  }): Promise<void>;
}

/** In-repo fake. It records what a real SMS or push adapter would send, which
 * is how the acceptance suite can present the correct code without a provider. */
export class RecordingCustodyCodeNotifier implements CustodyCodeNotifier {
  readonly sent: Array<{ orderId: string; legAttemptId: string; riderId: string; code: string; expiresAt: string }> = [];

  async send(input: { orderId: string; legAttemptId: string; riderId: string; code: string; expiresAt: string }): Promise<void> {
    this.sent.push(input);
  }

  latest(): { orderId: string; legAttemptId: string; riderId: string; code: string; expiresAt: string } | undefined {
    return this.sent[this.sent.length - 1];
  }
}

/** Provider callbacks are signed. A real adapter would verify raw bytes with
 * the vendor's scheme; this deterministic HMAC fake signs canonical JSON. */
export interface LogisticsProviderVerifier {
  verify(input: { provider: string; body: unknown; headers: Record<string, string | string[] | undefined> }): boolean | Promise<boolean>;
}

export class HmacLogisticsProviderVerifier implements LogisticsProviderVerifier {
  constructor(
    private readonly secret: string,
    private readonly headerName = 'x-logistics-signature',
  ) {
    if (secret.length < 16) throw new Error('Provider signature secret is too short');
  }

  sign(provider: string, body: unknown): string {
    return createHmac('sha256', this.secret).update(`${provider}.${canonicalJson(body)}`).digest('hex');
  }

  verify(input: { provider: string; body: unknown; headers: Record<string, string | string[] | undefined> }): boolean {
    const raw = input.headers[this.headerName];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    if (typeof provided !== 'string' || !/^[a-f0-9]{64}$/.test(provided)) return false;
    const expected = this.sign(input.provider, input.body);
    return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  }
}

export interface LogisticsOptions {
  db: Pool;
  authenticate?: (token: string) => Promise<{ actor: v2.Actor }>;
  clock?: () => Date;
  custodyCodeSecret?: string;
  custodyCodeMinutes?: number;
  custodyCodeAttempts?: number;
  locationFreshMinutes?: number;
  custodyNotifier?: CustodyCodeNotifier;
  verifier?: LogisticsProviderVerifier;
  onReturnAccepted?: DeliveryReconciliation;
}

interface OrderRow {
  id: string;
  version: number;
  status: v2.OrderStatus;
  customer_id: string;
  facility_id: string | null;
  address_snapshot: { label?: string; line1?: string; city?: string; postalCode?: string; coordinates?: GeoPoint };
  lines: Array<{ declaredGarmentCount?: number; pieceQuantity?: number; estimatedWeightGrams?: number }>;
  containers: Array<{ id: string; sealed: boolean; condition: string; garmentCount: number; weightGrams?: number }>;
  measured_lines: Array<{ countedQuantity?: number; measuredWeightGrams?: number; measuredPieceQuantity?: number }> | null;
  total_minor: string | number;
  currency: string;
  pickup_window: v2.ScheduleWindow;
  return_window: v2.ScheduleWindow;
  resume_status: v2.OrderStatus | null;
  quality_check_passed: boolean;
  created_at: Date;
  updated_at: Date;
}

interface AttemptRow {
  id: string;
  leg_id: string;
  order_id: string;
  leg: v2.Leg;
  version: number;
  status: v2.LegAttemptStatus;
  attempt_number: number;
  provider: string | null;
  provider_reference: string | null;
  assigned_to: string | null;
  scheduled_window: v2.ScheduleWindow | null;
  failure_reason: string | null;
  started_at: Date;
  completed_at: Date | null;
}

interface AssignmentRow {
  id: string;
  order_id: string;
  leg_attempt_id: string;
  leg: v2.Leg;
  rider_id: string;
  version: number;
  state: 'ACTIVE' | 'RELEASED' | 'CANCELLED';
  assigned_at: Date;
  accepted_at: Date | null;
  released_at: Date | null;
  cancelled_at: Date | null;
  reason: string | null;
  code_digest: string | null;
  code_expires_at: Date | null;
  code_consumed_at: Date | null;
  code_attempts: number;
}

interface HandoverRow {
  id: string;
  action_id: string;
  request_hash: string;
  order_id: string;
  leg_attempt_id: string;
  assignment_id: string;
  leg: v2.Leg;
  custody_kind: v2.CustodyEventKind;
  method: v2.HandoverMethod;
  code_digest: string | null;
  captured_lat: number | null;
  captured_lng: number | null;
  container_ids: string[];
  garment_count: number;
  condition: v2.GarmentCondition;
  captured_at: Date;
  result: v2.HandoverResult;
}

interface PositionRow {
  order_id: string;
  leg_attempt_id: string;
  assignment_id: string;
  rider_id: string;
  source: 'DEVICE' | 'PROVIDER';
  lat: number;
  lng: number;
  accuracy_meters: number | null;
  reported_at: Date;
}

interface TimelineRow {
  seq: number;
  status: v2.OrderStatus;
  label: string;
  actor_role: v2.ActorRole | null;
  reason: string | null;
  occurred_at: Date;
}

const OPS = new Set<v2.ActorRole>(['FACILITY', 'OPERATOR', 'ADMIN']);
const RIDER = new Set<v2.ActorRole>(['RIDER']);
const CUSTOMER = new Set<v2.ActorRole>(['CUSTOMER']);
const PROVIDER_ACTOR_ID = '00000000-0000-4000-8000-0000000000b6';
const ACTIVE_ATTEMPT: readonly v2.LegAttemptStatus[] = ['REQUESTED', 'BOOKING_UNKNOWN', 'BOOKED', 'ASSIGNED', 'AT_PICKUP', 'IN_TRANSIT', 'CANCEL_REQUESTED'];

const money = (value: string | number): number => Number(value);
const plain = (value: unknown): v2.JsonValue => JSON.parse(JSON.stringify(value)) as v2.JsonValue;
const hashPayload = (value: unknown): string => createHash('sha256').update(canonicalJson(plain(value))).digest('hex');

function sixDigits(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function attemptView(row: AttemptRow): v2.LegAttempt {
  return v2.legAttemptSchema.parse({
    id: row.id,
    legId: row.leg_id,
    orderId: row.order_id,
    leg: row.leg,
    version: row.version,
    status: row.status,
    attemptNumber: row.attempt_number,
    ...(row.provider === null ? {} : { provider: row.provider }),
    ...(row.provider_reference === null ? {} : { providerReference: row.provider_reference }),
    ...(row.assigned_to === null ? {} : { assignedTo: row.assigned_to }),
    ...(row.scheduled_window === null ? {} : { scheduledWindow: row.scheduled_window }),
    startedAt: row.started_at.toISOString(),
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at.toISOString() }),
    ...(row.failure_reason === null ? {} : { failureReason: row.failure_reason }),
  });
}

export async function acceptedReturnForOrder(tx: PoolClient, orderId: string): Promise<v2.LegAttempt | undefined> {
  const row = (await tx.query<AttemptRow>(`SELECT l.* FROM logistics_leg_attempts l
    WHERE l.order_id=$1 AND l.leg='RETURN' AND l.status='COMPLETED' AND EXISTS (
      SELECT 1 FROM logistics_handovers h WHERE h.leg_attempt_id=l.id AND h.order_id=l.order_id
        AND h.accepted=true AND h.leg='RETURN' AND h.custody_kind='RETURN_COMPLETED')
    ORDER BY l.completed_at DESC,l.id DESC LIMIT 1`, [orderId])).rows[0];
  return row ? attemptView(row) : undefined;
}

function assignmentView(row: AssignmentRow): v2.Assignment {
  return v2.assignmentSchema.parse({
    id: row.id,
    legAttemptId: row.leg_attempt_id,
    riderId: row.rider_id,
    version: row.version,
    assignedAt: row.assigned_at.toISOString(),
    ...(row.released_at === null ? {} : { releasedAt: row.released_at.toISOString() }),
    ...(row.reason === null ? {} : { reason: row.reason }),
    ...(row.accepted_at === null ? {} : { acceptedAt: row.accepted_at.toISOString() }),
  });
}

function handoverResult(row: HandoverRow): v2.HandoverResult {
  return v2.handoverResultSchema.parse(row.result);
}

export class LogisticsService {
  private readonly executor: ReturnType<typeof createPostgresCommandExecutor>;
  private readonly clock: () => Date;
  private readonly codeMinutes: number;
  private readonly codeAttempts: number;
  private readonly freshMinutes: number;
  private readonly codeKey: string;

  constructor(private readonly options: LogisticsOptions) {
    this.executor = createPostgresCommandExecutor(options.db);
    this.clock = options.clock ?? (() => new Date());
    this.codeMinutes = options.custodyCodeMinutes ?? 20;
    this.codeAttempts = options.custodyCodeAttempts ?? 5;
    this.freshMinutes = options.locationFreshMinutes ?? 5;
    this.codeKey = options.custodyCodeSecret ?? randomUUID();
    if (!Number.isSafeInteger(this.codeMinutes) || this.codeMinutes < 1 || this.codeMinutes > 1440) {
      throw new Error('Custody code lifetime must be between 1 and 1440 minutes');
    }
    if (!Number.isSafeInteger(this.codeAttempts) || this.codeAttempts < 1 || this.codeAttempts > 20) {
      throw new Error('Custody code attempt limit must be between 1 and 20');
    }
    if (!Number.isSafeInteger(this.freshMinutes) || this.freshMinutes < 1 || this.freshMinutes > 1440) {
      throw new Error('Location freshness must be between 1 and 1440 minutes');
    }
  }

  /** Reads and non-command writes still run in one bounded transaction. */
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
    if (!this.options.authenticate) throw new LogisticsFault('UNAUTHENTICATED', 'Sign in again to continue');
    return (await this.options.authenticate(token)).actor;
  }

  private async actorOf(token: string, allowed: Set<v2.ActorRole>): Promise<v2.Actor> {
    const actor = await this.actor(token);
    if (!allowed.has(actor.role)) throw new LogisticsFault('FORBIDDEN', 'This operation is not permitted for your role');
    return actor;
  }

  private guardOrder(
    snapshot: v2.OrderTransitionSnapshot,
    command: v2.OrderCommand,
    evidence: v2.OrderTransitionEvidence = {},
  ): { status: v2.OrderStatus; resumeStatus?: v2.OrderStatus } {
    try {
      return v2.guardOrderCommand(snapshot, command, evidence);
    } catch (error) {
      if (error instanceof v2.TransitionError) throw new LogisticsFault(error.code, error.message);
      throw error;
    }
  }

  private guardLeg(from: v2.LegAttemptStatus, to: v2.LegAttemptStatus, evidence: { proofVerified?: boolean; bookingReconciled?: boolean; cancellationConfirmed?: boolean } = {}): void {
    try {
      v2.assertLegTransition(from, to, evidence);
    } catch (error) {
      if (error instanceof v2.TransitionError) throw new LogisticsFault(error.code, error.message);
      throw error;
    }
  }

  private digest(code: string): string {
    return createHmac('sha256', this.codeKey).update('logistics-custody-code').update('\0').update(code).digest('hex');
  }

  private codeMatches(code: string, digest: string | null): boolean {
    if (digest === null) return false;
    const provided = Buffer.from(this.digest(code), 'hex');
    const stored = Buffer.from(digest, 'hex');
    return provided.length === stored.length && timingSafeEqual(provided, stored);
  }

  private facilityScope(actor: v2.Actor, order: OrderRow): void {
    if (actor.role !== 'FACILITY') return;
    // A pickup order has no facility until intake. Once one is recorded, the
    // order belongs to that facility and no other facility can dispatch it.
    if (order.facility_id !== null && !actor.facilityIds.includes(order.facility_id)) {
      throw new LogisticsFault('FORBIDDEN', 'This order belongs to another facility');
    }
  }

  private async requireRider(tx: PoolClient, riderId: string): Promise<void> {
    v2.idSchema.parse(riderId);
    const row = (await tx.query(
      `SELECT 1 FROM identity_profiles p JOIN identity_staff s ON s.phone=p.phone
       WHERE p.id=$1 AND p.active AND s.active AND s.role='RIDER'`, [riderId])).rows[0];
    if (!row) throw new LogisticsFault('INVALID_INPUT', 'Assignment requires a provisioned rider');
  }

  private async timeline(orderId: string, client: Pool | PoolClient = this.options.db): Promise<TimelineRow[]> {
    return (await client.query<TimelineRow>('SELECT * FROM orders_v2_timeline WHERE order_id=$1 ORDER BY seq', [orderId])).rows;
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

  private async appendAssignmentEvent(
    tx: PoolClient,
    input: {
      assignment: AssignmentRow;
      kind: 'ASSIGNED' | 'ACCEPTED' | 'RELEASED' | 'CANCELLED' | 'HANDOVER' | 'EXCEPTION';
      actor: { id: string; role: string };
      reason?: string;
    },
  ): Promise<void> {
    await tx.query(`INSERT INTO logistics_assignment_events
      (id,assignment_id,order_id,leg_attempt_id,kind,rider_id,actor_id,actor_role,reason,occurred_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
      randomUUID(), input.assignment.id, input.assignment.order_id, input.assignment.leg_attempt_id,
      input.kind, input.assignment.rider_id, input.actor.id, input.actor.role, input.reason ?? null, this.clock(),
    ]);
  }

  private async activeAssignment(tx: PoolClient, attemptId: string): Promise<AssignmentRow | undefined> {
    return (await tx.query<AssignmentRow>(
      `SELECT * FROM logistics_assignments
       WHERE leg_attempt_id=$1 AND released_at IS NULL AND cancelled_at IS NULL
       ORDER BY assigned_at DESC LIMIT 1 FOR UPDATE`, [attemptId])).rows[0];
  }

  private async assignmentForRider(tx: PoolClient, attemptId: string, riderId: string): Promise<AssignmentRow> {
    const assignment = await this.activeAssignment(tx, attemptId);
    if (!assignment || assignment.rider_id !== riderId || assignment.state !== 'ACTIVE') {
      throw new LogisticsFault('FORBIDDEN', 'This job is not assigned to you');
    }
    return assignment;
  }

  private async lockAttempt(tx: PoolClient, attemptId: string): Promise<AttemptRow> {
    v2.idSchema.parse(attemptId);
    const row = (await tx.query<AttemptRow>('SELECT * FROM logistics_leg_attempts WHERE id=$1 FOR UPDATE', [attemptId])).rows[0];
    if (!row) throw new LogisticsFault('NOT_FOUND', 'Delivery leg attempt not found');
    return row;
  }

  private async lockOrder(tx: PoolClient, orderId: string): Promise<OrderRow> {
    const row = (await tx.query<OrderRow>('SELECT * FROM orders_v2_orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
    if (!row) throw new LogisticsFault('NOT_FOUND', 'Order not found');
    return row;
  }

  /**
   * Internal leg creation. A provider adapter or the coordinator's booking
   * step calls this once per requested leg; no published route creates legs.
   * The partial unique index refuses a second live attempt for one order leg.
   */
  async openLegAttempt(
    orderId: string,
    leg: v2.Leg,
    input: { provider?: string; providerReference?: string; scheduledWindow?: v2.ScheduleWindow; attemptNumber?: number } = {},
    transaction?: PoolClient,
  ): Promise<v2.LegAttempt> {
    v2.idSchema.parse(orderId);
    const parsedLeg = v2.legSchema.parse(leg);
    const work = async (tx: PoolClient) => {
      const order = await this.lockOrder(tx, orderId);
      if (order.status === 'DELIVERED' || order.status === 'CANCELLED') {
        throw new LogisticsFault('INVALID_INPUT', 'A terminal order cannot open a delivery leg');
      }
      const next = input.attemptNumber ?? ((await tx.query<{ n: number }>(
        'SELECT COALESCE(MAX(attempt_number),0)+1 AS n FROM logistics_leg_attempts WHERE order_id=$1 AND leg=$2',
        [orderId, parsedLeg])).rows[0].n);
      try {
        const row = (await tx.query<AttemptRow>(`INSERT INTO logistics_leg_attempts
          (id,leg_id,order_id,leg,version,status,attempt_number,provider,provider_reference,assigned_to,
           scheduled_window,failure_reason,failure_media_ids,failure_captured_at,started_at,completed_at,created_at,updated_at)
          VALUES ($1,$2,$3,$4,1,'BOOKED',$5,$6,$7,NULL,$8,NULL,'[]'::jsonb,NULL,$9,NULL,$9,$9) RETURNING *`, [
          randomUUID(), randomUUID(), orderId, parsedLeg, next,
          input.provider ?? null, input.providerReference ?? null,
          input.scheduledWindow === undefined ? null : JSON.stringify(input.scheduledWindow), this.clock(),
        ])).rows[0];
        return attemptView(row);
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new LogisticsFault('INVALID_INPUT', 'This order leg already has a live attempt');
        }
        throw error;
      }
    };
    return transaction ? work(transaction) : this.tx(work);
  }

  /** Ops route: assign a rider to a booked leg attempt. */
  async assign(token: string, input: v2.AssignmentInput, key: string): Promise<v2.Assignment> {
    const parsed = v2.assignmentInputSchema.parse(input);
    const actor = await this.actorOf(token, OPS);
    if (!this.options.custodyNotifier) throw new LogisticsFault('PROVIDER_UNAVAILABLE', 'Custody-code delivery is not configured');
    let issued: { code: string; orderId: string; legAttemptId: string; riderId: string; expiresAt: string } | undefined;
    const result = await this.executor.execute(
      { actor, operation: 'logistics.ops.assign', idempotencyKey: key, payload: plain(parsed), traceId: randomUUID() },
      async () => { await this.actorOf(token, OPS); },
      async scope => {
        const tx = scope.handle;
        const attempt = await this.lockAttempt(tx, parsed.legAttemptId);
        const order = await this.lockOrder(tx, attempt.order_id);
        this.facilityScope(actor, order);
        if (attempt.version !== parsed.expectedVersion) {
          throw new LogisticsFault('VERSION_CONFLICT', 'Delivery leg changed since it was read', attempt.version);
        }
        await this.requireRider(tx, parsed.riderId);
        const existing = (await tx.query<AssignmentRow>(
          `SELECT * FROM logistics_assignments
           WHERE order_id=$1 AND leg=$2 AND released_at IS NULL AND cancelled_at IS NULL FOR UPDATE`,
          [order.id, attempt.leg])).rows[0];
        if (existing) {
          if (existing.rider_id === parsed.riderId && existing.leg_attempt_id === attempt.id) {
            return assignmentView(existing) as unknown as v2.JsonValue;
          }
          throw new LogisticsFault('INVALID_INPUT', 'This leg already has an active assignment; reassign it instead');
        }
        if (!ACTIVE_ATTEMPT.includes(attempt.status) || attempt.status === 'IN_TRANSIT') {
          throw new LogisticsFault('INVALID_INPUT', `A ${attempt.status} attempt cannot be assigned`);
        }
        let status = attempt.status;
        if (status !== 'BOOKED') {
          this.guardLeg(status, 'BOOKED', { bookingReconciled: status === 'BOOKING_UNKNOWN' });
          status = 'BOOKED';
        }
        this.guardLeg(status, 'ASSIGNED');

        const code = sixDigits();
        const expiresAt = new Date(this.clock().getTime() + this.codeMinutes * 60_000);
        const assignment = (await tx.query<AssignmentRow>(`INSERT INTO logistics_assignments
          (id,order_id,leg_attempt_id,leg,rider_id,version,state,assigned_at,accepted_at,released_at,cancelled_at,
           reason,assigned_by,code_digest,code_expires_at,code_consumed_at,code_attempts,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,1,'ACTIVE',$6,NULL,NULL,NULL,$7,$8,$9,$10,NULL,0,$6,$6) RETURNING *`, [
          randomUUID(), order.id, attempt.id, attempt.leg, parsed.riderId, this.clock(), parsed.reason, actor.id,
          this.digest(code), expiresAt,
        ])).rows[0];

        await tx.query(`UPDATE logistics_leg_attempts
          SET status='ASSIGNED',assigned_to=$2,version=version+1,updated_at=$3 WHERE id=$1`,
        [attempt.id, parsed.riderId, this.clock()]);
        await this.appendAssignmentEvent(tx, { assignment, kind: 'ASSIGNED', actor, reason: parsed.reason });
        await scope.audit({
          aggregateId: order.id,
          action: 'LOGISTICS_ASSIGNED',
          reason: parsed.reason,
          before: { attemptStatus: attempt.status, attemptVersion: attempt.version, riderId: null },
          after: { attemptStatus: 'ASSIGNED', riderId: parsed.riderId, leg: attempt.leg, assignmentId: assignment.id },
        });
        issued = { code, orderId: order.id, legAttemptId: attempt.id, riderId: parsed.riderId, expiresAt: expiresAt.toISOString() };
        return assignmentView(assignment) as unknown as v2.JsonValue;
      },
    );
    // Notify only when this execution issued a new code. A replay returns the
    // stored assignment and must not send a second code.
    if (issued && this.options.custodyNotifier) {
      await this.options.custodyNotifier.send({ ...issued });
    }
    return v2.assignmentSchema.parse(result);
  }

  /** Ops route: release one active assignment and create its replacement. */
  async reassign(token: string, assignmentId: string, input: v2.ReassignmentInput, key: string): Promise<v2.Assignment> {
    const parsed = v2.reassignmentInputSchema.parse(input);
    if (!this.options.custodyNotifier) throw new LogisticsFault('PROVIDER_UNAVAILABLE', 'Custody-code delivery is not configured');
    v2.idSchema.parse(assignmentId);
    const actor = await this.actorOf(token, OPS);
    let issued: { code: string; orderId: string; legAttemptId: string; riderId: string; expiresAt: string } | undefined;
    const result = await this.executor.execute(
      { actor, operation: 'logistics.ops.reassign', idempotencyKey: key, payload: plain({ ...parsed, assignmentId }), traceId: randomUUID() },
      async () => { await this.actorOf(token, OPS); },
      async scope => {
        const tx = scope.handle;
        const current = (await tx.query<AssignmentRow>('SELECT * FROM logistics_assignments WHERE id=$1 FOR UPDATE', [assignmentId])).rows[0];
        if (!current) throw new LogisticsFault('NOT_FOUND', 'Assignment not found');
        const order = await this.lockOrder(tx, current.order_id);
        this.facilityScope(actor, order);
        if (current.released_at !== null || current.cancelled_at !== null) {
          throw new LogisticsFault('INVALID_INPUT', 'This assignment is no longer active');
        }
        if (current.version !== parsed.expectedVersion) {
          throw new LogisticsFault('VERSION_CONFLICT', 'Assignment changed since it was read', current.version);
        }
        if (current.rider_id === parsed.riderId) {
          throw new LogisticsFault('INVALID_INPUT', 'The job is already assigned to that rider');
        }
        await this.requireRider(tx, parsed.riderId);
        const attempt = await this.lockAttempt(tx, current.leg_attempt_id);
        if (attempt.status !== 'ASSIGNED' && attempt.status !== 'AT_PICKUP') {
          throw new LogisticsFault('INVALID_INPUT', `A ${attempt.status} attempt cannot be reassigned`);
        }
        const proof = (await tx.query('SELECT 1 FROM logistics_handovers WHERE leg_attempt_id=$1 AND accepted LIMIT 1', [attempt.id])).rows[0];
        if (proof) throw new LogisticsFault('INVALID_INPUT', 'Custody is already recorded for this attempt');

        const released = (await tx.query<AssignmentRow>(`UPDATE logistics_assignments SET
          state='RELEASED',released_at=$2,reason=$3,version=version+1,code_expires_at=$2,updated_at=$2
          WHERE id=$1 RETURNING *`, [current.id, this.clock(), parsed.reason])).rows[0];
        await this.appendAssignmentEvent(tx, { assignment: released, kind: 'RELEASED', actor, reason: parsed.reason });

        const code = sixDigits();
        const expiresAt = new Date(this.clock().getTime() + this.codeMinutes * 60_000);
        const replacement = (await tx.query<AssignmentRow>(`INSERT INTO logistics_assignments
          (id,order_id,leg_attempt_id,leg,rider_id,version,state,assigned_at,accepted_at,released_at,cancelled_at,
           reason,assigned_by,code_digest,code_expires_at,code_consumed_at,code_attempts,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,1,'ACTIVE',$6,NULL,NULL,NULL,$7,$8,$9,$10,NULL,0,$6,$6) RETURNING *`, [
          randomUUID(), order.id, attempt.id, attempt.leg, parsed.riderId, this.clock(), parsed.reason, actor.id,
          this.digest(code), expiresAt,
        ])).rows[0];
        await tx.query(`UPDATE logistics_leg_attempts SET assigned_to=$2,version=version+1,updated_at=$3 WHERE id=$1`,
          [attempt.id, parsed.riderId, this.clock()]);
        await this.appendAssignmentEvent(tx, { assignment: replacement, kind: 'ASSIGNED', actor, reason: parsed.reason });
        await scope.audit({
          aggregateId: order.id,
          action: 'LOGISTICS_REASSIGNED',
          reason: parsed.reason,
          before: { assignmentId: current.id, riderId: current.rider_id, attemptVersion: attempt.version },
          after: { assignmentId: replacement.id, riderId: parsed.riderId, attemptVersion: attempt.version + 1 },
        });
        issued = { code, orderId: order.id, legAttemptId: attempt.id, riderId: parsed.riderId, expiresAt: expiresAt.toISOString() };
        return assignmentView(replacement) as unknown as v2.JsonValue;
      },
    );
    if (issued && this.options.custodyNotifier) {
      await this.options.custodyNotifier.send({ ...issued });
    }
    return v2.assignmentSchema.parse(result);
  }

  /** Ops route: cancel a leg attempt before the rider has custody. */
  async cancelLeg(token: string, legAttemptId: string, input: v2.LegCancellation, key: string): Promise<v2.LegAttempt> {
    const parsed = v2.legCancellationSchema.parse(input);
    v2.idSchema.parse(legAttemptId);
    const actor = await this.actorOf(token, OPS);
    const result = await this.executor.execute(
      { actor, operation: 'logistics.ops.cancel', idempotencyKey: key, payload: plain({ ...parsed, legAttemptId }), traceId: randomUUID() },
      async () => { await this.actorOf(token, OPS); },
      async scope => {
        const tx = scope.handle;
        const attempt = await this.lockAttempt(tx, legAttemptId);
        const order = await this.lockOrder(tx, attempt.order_id);
        this.facilityScope(actor, order);
        if (attempt.version !== parsed.expectedVersion) {
          throw new LogisticsFault('VERSION_CONFLICT', 'Delivery leg changed since it was read', attempt.version);
        }
        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(attempt.status)) {
          throw new LogisticsFault('INVALID_INPUT', `A ${attempt.status} attempt cannot be cancelled`);
        }
        if (attempt.status === 'IN_TRANSIT') {
          throw new LogisticsFault('INVALID_INPUT', 'Custody is with the rider; record an exception instead of cancelling');
        }
        const active = await this.activeAssignment(tx, attempt.id);
        if (active) {
          const cancelled = (await tx.query<AssignmentRow>(`UPDATE logistics_assignments SET
            state='CANCELLED',cancelled_at=$2,reason=$3,version=version+1,code_expires_at=$2,updated_at=$2
            WHERE id=$1 RETURNING *`, [active.id, this.clock(), parsed.reason])).rows[0];
          await this.appendAssignmentEvent(tx, { assignment: cancelled, kind: 'CANCELLED', actor, reason: parsed.reason });
        }
        let status = attempt.status;
        if (status !== 'CANCEL_REQUESTED') {
          this.guardLeg(status, 'CANCEL_REQUESTED');
          status = 'CANCEL_REQUESTED';
        }
        this.guardLeg(status, 'CANCELLED', { cancellationConfirmed: true });
        const updated = (await tx.query<AttemptRow>(`UPDATE logistics_leg_attempts SET
          status='CANCELLED',assigned_to=NULL,failure_reason=$2,version=version+1,updated_at=$3
          WHERE id=$1 RETURNING *`, [attempt.id, parsed.reason, this.clock()])).rows[0];
        await scope.audit({
          aggregateId: order.id,
          action: 'LOGISTICS_LEG_CANCELLED',
          reason: parsed.reason,
          before: { status: attempt.status, version: attempt.version, assignmentId: active?.id ?? null },
          after: { status: 'CANCELLED', version: updated.version },
        });
        return attemptView(updated) as unknown as v2.JsonValue;
      },
    );
    return v2.legAttemptSchema.parse(result);
  }

  /** Rider route: acknowledge an active assignment. */
  async acceptJob(token: string, jobId: string, input: v2.VersionedCommand, key: string): Promise<v2.Assignment> {
    const parsed = v2.versionedCommandSchema.parse(input);
    v2.idSchema.parse(jobId);
    const rider = await this.actorOf(token, RIDER);
    const result = await this.executor.execute(
      { actor: rider, operation: 'logistics.rider.accept', idempotencyKey: key, payload: plain({ ...parsed, jobId }), traceId: randomUUID() },
      async () => { await this.actorOf(token, RIDER); },
      async scope => {
        const tx = scope.handle;
        const attempt = await this.lockAttempt(tx, jobId);
        const assignment = await this.assignmentForRider(tx, attempt.id, rider.id);
        if (attempt.version !== parsed.expectedVersion) {
          throw new LogisticsFault('VERSION_CONFLICT', 'Job changed since it was read', attempt.version);
        }
        if (assignment.accepted_at !== null) {
          return assignmentView(assignment) as unknown as v2.JsonValue;
        }
        if (attempt.status !== 'ASSIGNED') {
          throw new LogisticsFault('INVALID_INPUT', `A ${attempt.status} job cannot be accepted`);
        }
        const updated = (await tx.query<AssignmentRow>(
          'UPDATE logistics_assignments SET accepted_at=$2,version=version+1,updated_at=$2 WHERE id=$1 RETURNING *',
          [assignment.id, this.clock()])).rows[0];
        await this.appendAssignmentEvent(tx, { assignment: updated, kind: 'ACCEPTED', actor: rider });
        await scope.audit({
          aggregateId: attempt.order_id,
          action: 'LOGISTICS_ASSIGNMENT_ACCEPTED',
          reason: 'Rider accepted the assigned job',
          before: { assignmentId: assignment.id, acceptedAt: null },
          after: { assignmentId: updated.id, acceptedAt: this.clock().toISOString() },
        });
        return assignmentView(updated) as unknown as v2.JsonValue;
      },
    );
    return v2.assignmentSchema.parse(result);
  }

  /** Rider route: list only this rider's live jobs. */
  async listRiderJobs(token: string): Promise<v2.RiderJob[]> {
    const rider = await this.actorOf(token, RIDER);
    // Selecting a whole table row returns its composite text form to pg, so the
    // attempt and assignment are read by id rather than relying on aliases.
    const rows = (await this.options.db.query<{ attempt_id: string; assignment_id: string }>(
      `SELECT a.id AS attempt_id, s.id AS assignment_id FROM logistics_assignments s
       JOIN logistics_leg_attempts a ON a.id=s.leg_attempt_id
       WHERE s.rider_id=$1 AND s.released_at IS NULL AND s.cancelled_at IS NULL
         AND a.status IN ('ASSIGNED','AT_PICKUP','IN_TRANSIT')
       ORDER BY s.assigned_at DESC`, [rider.id])).rows;
    const jobs: v2.RiderJob[] = [];
    for (const row of rows) {
      const attempt = (await this.options.db.query<AttemptRow>(
        'SELECT * FROM logistics_leg_attempts WHERE id=$1', [row.attempt_id])).rows[0];
      const assignment = (await this.options.db.query<AssignmentRow>(
        'SELECT * FROM logistics_assignments WHERE id=$1', [row.assignment_id])).rows[0];
      if (!attempt || !assignment) continue;
      jobs.push(await this.riderJob(attempt, assignment));
    }
    return jobs;
  }

  private async riderJob(attempt: AttemptRow, assignment: AssignmentRow): Promise<v2.RiderJob> {
    const order = (await this.options.db.query<OrderRow>('SELECT * FROM orders_v2_orders WHERE id=$1', [attempt.order_id])).rows[0];
    if (!order) throw new LogisticsFault('NOT_FOUND', 'Order not found');
    const phone = (await this.options.db.query<{ phone: string }>(
      'SELECT phone FROM identity_profiles WHERE id=$1', [order.customer_id])).rows[0]?.phone;
    const address = order.address_snapshot;
    const window = attempt.leg === 'PICKUP' ? order.pickup_window : order.return_window;
    return v2.riderJobSchema.parse({
      id: attempt.id,
      orderId: order.id,
      leg: attempt.leg,
      status: attempt.status,
      version: attempt.version,
      // v2 identity stores no display names. The rider gets a stable privacy
      // handle plus the customer phone a caller needs to coordinate arrival.
      customerName: phone ? `Customer ${phone.slice(-4)}` : 'Customer',
      addressLine1: address.line1 ?? 'Address on file',
      addressCity: address.city ?? 'Bengaluru',
      addressPostalCode: address.postalCode ?? '000000',
      window,
      containerIds: order.containers.map(container => container.id),
      containerCount: order.containers.length,
      ...(phone === undefined ? {} : { contactPhone: phone }),
      assignedTo: assignment.rider_id,
      assignmentActive: true,
    });
  }

  /** Rider route: one job, only when the active assignment is theirs. */
  async getRiderJob(token: string, jobId: string): Promise<v2.RiderJob> {
    v2.idSchema.parse(jobId);
    const rider = await this.actorOf(token, RIDER);
    return this.tx(async tx => {
      const attempt = (await tx.query<AttemptRow>('SELECT * FROM logistics_leg_attempts WHERE id=$1', [jobId])).rows[0];
      if (!attempt) throw new LogisticsFault('NOT_FOUND', 'Job not found');
      const assignment = (await tx.query<AssignmentRow>(
        `SELECT * FROM logistics_assignments
         WHERE leg_attempt_id=$1 AND rider_id=$2 AND released_at IS NULL AND cancelled_at IS NULL`,
        [attempt.id, rider.id])).rows[0];
      if (!assignment) throw new LogisticsFault('NOT_FOUND', 'Job not found');
      return this.riderJob(attempt, assignment);
    });
  }

  /** Rider route: custody handover with a code digest comparison. */
  async recordHandover(token: string, input: v2.RiderHandover, key: string): Promise<v2.HandoverResult> {
    const parsed = v2.riderHandoverSchema.parse(input);
    if (parsed.legAttemptId !== parsed.jobId) {
      throw new LogisticsFault('INVALID_INPUT', 'The handover must name one job consistently');
    }
    const rider = await this.actorOf(token, RIDER);
    const requestHash = hashPayload({ operation: 'logistics.rider.handover', payload: parsed });
    const traceId = randomUUID();
    try {
      const result = await this.executor.execute(
        { actor: rider, operation: 'logistics.rider.handover', idempotencyKey: key, payload: plain(parsed), traceId },
        async () => { await this.actorOf(token, RIDER); },
        async scope => {
          const tx = scope.handle;
          await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [canonicalJson(['handover', parsed.actionId])]);
          const stored = (await tx.query<HandoverRow>('SELECT * FROM logistics_handovers WHERE action_id=$1', [parsed.actionId])).rows[0];
          if (stored) {
            if (stored.request_hash !== requestHash) {
              throw new LogisticsFault('IDEMPOTENCY_CONFLICT', 'This handover action was already used for a different proof');
            }
            return handoverResult(stored) as unknown as v2.JsonValue;
          }
          const attempt = await this.lockAttempt(tx, parsed.jobId);
          const order = await this.lockOrder(tx, attempt.order_id);
          const assignment = await this.assignmentForRider(tx, attempt.id, rider.id);
          if (attempt.version !== parsed.expectedVersion) {
            throw new LogisticsFault('VERSION_CONFLICT', 'Job changed since it was read', attempt.version);
          }
          if (attempt.status === 'COMPLETED' || attempt.status === 'FAILED' || attempt.status === 'CANCELLED') {
            throw new LogisticsFault('INVALID_INPUT', `A ${attempt.status} job cannot record a handover`);
          }
          if (assignment.code_digest === null) {
            throw new LogisticsFault('INVALID_INPUT', 'This assignment has no custody code');
          }
          if (assignment.code_consumed_at !== null) {
            throw new LogisticsFault('INVALID_INPUT', 'The custody code has already been used');
          }
          if (assignment.code_expires_at === null || assignment.code_expires_at.getTime() <= this.clock().getTime()) {
            throw new LogisticsFault('INVALID_INPUT', 'The custody code has expired');
          }
          if (assignment.code_attempts >= this.codeAttempts) {
            throw new LogisticsFault('INVALID_INPUT', 'The custody code is locked after too many attempts');
          }
          if (!this.codeMatches(parsed.code, assignment.code_digest)) {
            throw new CustodyCodeMismatch(assignment.id);
          }

          let status = attempt.status;
          if (status !== 'AT_PICKUP') {
            this.guardLeg(status, 'AT_PICKUP');
            status = 'AT_PICKUP';
          }
          this.guardLeg(status, 'IN_TRANSIT');
          this.guardLeg('IN_TRANSIT', 'COMPLETED', { proofVerified: true });

          let orderStatus = order.status;
          if (attempt.leg === 'PICKUP') {
            if (order.status === 'CONFIRMED') {
              const next = this.guardOrder(
                { status: order.status, version: order.version },
                { type: 'MARK_PICKUP_PENDING', expectedVersion: order.version },
              );
              const moved = (await tx.query<OrderRow>(
                'UPDATE orders_v2_orders SET status=$2,version=version+1,updated_at=$3 WHERE id=$1 RETURNING *',
                [order.id, next.status, this.clock()])).rows[0];
              await this.appendTimeline(tx, order.id, next.status, 'Rider collected the laundry', rider.role);
              orderStatus = moved.status;
            } else if (order.status !== 'PICKUP_PENDING') {
              throw new LogisticsFault('INVALID_INPUT', `A ${order.status} order is not awaiting pickup`);
            }
          } else if (order.status === 'READY_FOR_RETURN') {
            const next = this.guardOrder(
              { status: order.status, version: order.version },
              { type: 'START_RETURN', expectedVersion: order.version },
              {
                facilityIntakeAccepted: order.measured_lines !== null,
                qualityCheckPassed: order.quality_check_passed,
                returnAssignmentActive: true,
              },
            );
            const moved = (await tx.query<OrderRow>(
              'UPDATE orders_v2_orders SET status=$2,version=version+1,updated_at=$3 WHERE id=$1 RETURNING *',
              [order.id, next.status, this.clock()])).rows[0];
            await this.appendTimeline(tx, order.id, next.status, 'Return journey started', rider.role);
            orderStatus = moved.status;
          } else if (order.status !== 'RETURNING') {
            throw new LogisticsFault('INVALID_INPUT', `A ${order.status} order is not on the return leg`);
          }
          // The composed hook below requires persisted custody AND final
          // billing resolution. Without it the order remains RETURNING.

          const updatedAttempt = (await tx.query<AttemptRow>(`UPDATE logistics_leg_attempts SET
            status='COMPLETED',completed_at=$2,version=version+1,updated_at=$2 WHERE id=$1 RETURNING *`,
          [attempt.id, this.clock()])).rows[0];

          const position = (await tx.query<PositionRow>(`SELECT * FROM logistics_positions
            WHERE leg_attempt_id=$1 ORDER BY reported_at DESC LIMIT 1`, [attempt.id])).rows[0];
          const custodyKind: v2.CustodyEventKind = attempt.leg === 'PICKUP' ? 'PICKUP_COMPLETED' : 'RETURN_COMPLETED';
          const handoverId = randomUUID();
          const resultPayload: v2.HandoverResult = {
            legAttemptId: attempt.id,
            accepted: true,
            custodyEventId: handoverId,
            attemptCount: attempt.attempt_number,
            nextAttemptAllowed: false,
            codeExpiresAt: assignment.code_expires_at.toISOString(),
          };
          const row = (await tx.query<HandoverRow>(`INSERT INTO logistics_handovers
            (id,action_id,request_hash,order_id,leg_attempt_id,assignment_id,leg,custody_kind,method,code_digest,
             code_expires_at,photo_media_id,captured_lat,captured_lng,container_ids,garment_count,condition,note,
             actor_id,actor_role,captured_at,accepted,result,created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'CODE',$9,$10,NULL,$11,$12,$13,$14,$15,$16,$17,$18,$19,true,$20,$21) RETURNING *`, [
            handoverId, parsed.actionId, requestHash, order.id, attempt.id, assignment.id, attempt.leg, custodyKind,
            assignment.code_digest, assignment.code_expires_at,
            position?.lat ?? null, position?.lng ?? null,
            JSON.stringify(parsed.containerIds), parsed.garmentCount, parsed.condition, parsed.note ?? null,
            rider.id, rider.role, parsed.capturedAt, JSON.stringify(resultPayload), this.clock(),
          ])).rows[0];
          await tx.query('UPDATE logistics_assignments SET code_consumed_at=$2,version=version+1,updated_at=$2 WHERE id=$1', [assignment.id, this.clock()]);
          await this.appendAssignmentEvent(tx, { assignment, kind: 'HANDOVER', actor: rider, reason: parsed.note });
          await scope.audit({
            aggregateId: order.id,
            action: custodyKind === 'PICKUP_COMPLETED' ? 'LOGISTICS_PICKUP_CUSTODY_RECORDED' : 'LOGISTICS_RETURN_CUSTODY_RECORDED',
            reason: parsed.note ?? 'Custody handover verified by code',
            before: { attemptStatus: attempt.status, attemptVersion: attempt.version, orderStatus: order.status },
            after: {
              attemptStatus: updatedAttempt.status,
              orderStatus,
              handoverId,
              custodyKind,
              containerCount: parsed.containerIds.length,
              garmentCount: parsed.garmentCount,
              condition: parsed.condition,
            },
          });
          if (attempt.leg === 'RETURN') await this.options.onReturnAccepted?.(order.id, tx, {
            actorId: rider.id, actorRole: rider.role, traceId, now: this.clock(),
          });
          return handoverResult(row) as unknown as v2.JsonValue;
        },
      );
      return v2.handoverResultSchema.parse(result);
    } catch (error) {
      // The counter write is separate because the failed command transaction
      // rolled back. It records the guess, never the submitted or expected code.
      if (error instanceof CustodyCodeMismatch) {
        await this.options.db.query(
          'UPDATE logistics_assignments SET code_attempts=code_attempts+1 WHERE id=$1 AND code_consumed_at IS NULL',
          [error.assignmentId],
        ).catch(() => undefined);
      }
      throw error;
    }
  }

  /** Rider route: report a delivery exception, releasing the assignment. */
  async reportException(token: string, jobId: string, input: v2.DeliveryException, key: string): Promise<v2.LegAttempt> {
    const parsed = v2.deliveryExceptionSchema.parse(input);
    v2.idSchema.parse(jobId);
    const rider = await this.actorOf(token, RIDER);
    const result = await this.executor.execute(
      { actor: rider, operation: 'logistics.rider.exception', idempotencyKey: key, payload: plain({ ...parsed, jobId }), traceId: randomUUID() },
      async () => { await this.actorOf(token, RIDER); },
      async scope => {
        const tx = scope.handle;
        const attempt = await this.lockAttempt(tx, jobId);
        const order = await this.lockOrder(tx, attempt.order_id);
        const assignment = await this.assignmentForRider(tx, attempt.id, rider.id);
        if (attempt.version !== parsed.expectedVersion) {
          throw new LogisticsFault('VERSION_CONFLICT', 'Job changed since it was read', attempt.version);
        }
        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(attempt.status)) {
          throw new LogisticsFault('INVALID_INPUT', `A ${attempt.status} job cannot report an exception`);
        }
        this.guardLeg(attempt.status, 'FAILED');
        const released = (await tx.query<AssignmentRow>(`UPDATE logistics_assignments SET
          state='RELEASED',released_at=$2,reason=$3,version=version+1,code_expires_at=$2,updated_at=$2
          WHERE id=$1 RETURNING *`, [assignment.id, this.clock(), parsed.reason])).rows[0];
        await this.appendAssignmentEvent(tx, { assignment: released, kind: 'EXCEPTION', actor: rider, reason: parsed.reason });
        const updated = (await tx.query<AttemptRow>(`UPDATE logistics_leg_attempts SET
          status='FAILED',assigned_to=NULL,failure_reason=$2,failure_media_ids=$3,failure_captured_at=$4,
          version=version+1,updated_at=$5 WHERE id=$1 RETURNING *`, [
          attempt.id, parsed.reason, JSON.stringify(parsed.mediaIds), parsed.capturedAt, this.clock(),
        ])).rows[0];
        await scope.audit({
          aggregateId: order.id,
          action: 'LOGISTICS_LEG_FAILED',
          reason: parsed.reason,
          before: { status: attempt.status, version: attempt.version, assignmentId: assignment.id },
          after: { status: 'FAILED', version: updated.version, mediaIds: parsed.mediaIds.length },
        });
        return attemptView(updated) as unknown as v2.JsonValue;
      },
    );
    return v2.legAttemptSchema.parse(result);
  }

  /** Rider route: append one source-qualified position. */
  async reportLocation(token: string, input: v2.RiderLocationReport, key: string): Promise<v2.Location> {
    const parsed = v2.riderLocationReportSchema.parse(input);
    const rider = await this.actorOf(token, RIDER);
    const result = await this.executor.execute(
      { actor: rider, operation: 'logistics.rider.location', idempotencyKey: key, payload: plain(parsed), traceId: randomUUID() },
      async () => { await this.actorOf(token, RIDER); },
      async scope => {
        const tx = scope.handle;
        const attempt = await this.lockAttempt(tx, parsed.jobId);
        const assignment = await this.assignmentForRider(tx, attempt.id, rider.id);
        if (attempt.version !== parsed.expectedVersion) {
          throw new LogisticsFault('VERSION_CONFLICT', 'Job changed since it was read', attempt.version);
        }
        if (!['ASSIGNED', 'AT_PICKUP', 'IN_TRANSIT'].includes(attempt.status)) {
          throw new LogisticsFault('INVALID_INPUT', `A ${attempt.status} job cannot report a location`);
        }
        const reportedAt = new Date(parsed.reportedAt);
        if (reportedAt.getTime() > this.clock().getTime() + 2 * 60_000) {
          throw new LogisticsFault('INVALID_INPUT', 'Location time cannot be in the future');
        }
        await tx.query(`INSERT INTO logistics_positions
          (id,order_id,leg_attempt_id,assignment_id,rider_id,source,lat,lng,accuracy_meters,reported_at,recorded_at)
          VALUES ($1,$2,$3,$4,$5,'DEVICE',$6,$7,$8,$9,$10)`, [
          randomUUID(), attempt.order_id, attempt.id, assignment.id, rider.id,
          parsed.lat, parsed.lng, parsed.accuracyMeters ?? null, reportedAt, this.clock(),
        ]);
        return this.locationView({
          order_id: attempt.order_id, leg_attempt_id: attempt.id, assignment_id: assignment.id, rider_id: rider.id,
          source: 'DEVICE', lat: parsed.lat, lng: parsed.lng, accuracy_meters: parsed.accuracyMeters ?? null, reported_at: reportedAt,
        }) as unknown as v2.JsonValue;
      },
    );
    return v2.locationSchema.parse(result);
  }

  private locationView(row: PositionRow): v2.Location {
    const stale = row.reported_at.getTime() < this.clock().getTime() - this.freshMinutes * 60_000;
    return v2.locationSchema.parse({
      orderId: row.order_id,
      lat: row.lat,
      lng: row.lng,
      reportedAt: row.reported_at.toISOString(),
      source: row.source,
      stale,
    });
  }

  /**
   * Provider callback. Deduplication uses the contract's PROVIDER_EVENT mode:
   * a unique (provider, provider_event_id) row is the idempotency record, not a
   * client idempotency key. A duplicate inserts nothing and changes nothing.
   */
  async handleProviderEvent(
    provider: string,
    input: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ accepted: boolean; duplicate: boolean }> {
    if (provider.length === 0 || provider.length > 100) throw new LogisticsFault('INVALID_INPUT', 'Provider is not valid');
    const parsed = v2.logisticsWebhookSchema.parse(input);
    const verifier = this.options.verifier;
    if (verifier) {
      const valid = await verifier.verify({ provider, body: parsed, headers });
      if (!valid) throw new LogisticsFault('UNAUTHENTICATED', 'Provider signature is not valid');
    }
    return this.tx(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [canonicalJson(['provider-event', provider, parsed.eventId])]);
      const attempt = (await tx.query<AttemptRow>(
        'SELECT * FROM logistics_leg_attempts WHERE provider=$1 AND provider_reference=$2 FOR UPDATE',
        [provider, parsed.providerReference])).rows[0];
      if (!attempt) throw new LogisticsFault('INVALID_INPUT', 'Provider reference is not known');
      const inserted = (await tx.query(
        `INSERT INTO logistics_provider_events
         (id,provider,provider_event_id,provider_reference,status,proof_reference,occurred_at,payload,applied,received_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`, [
        randomUUID(), provider, parsed.eventId, parsed.providerReference, parsed.status, parsed.proofReference ?? null,
        new Date(parsed.occurredAt), JSON.stringify(parsed), false, this.clock(),
      ])).rows[0];
      if (!inserted) return { accepted: true, duplicate: true };

      let applied = false;
      if (attempt.status !== parsed.status) {
        const evidence: { proofVerified?: boolean; bookingReconciled?: boolean; cancellationConfirmed?: boolean } = {};
        if (parsed.status === 'COMPLETED') evidence.proofVerified = parsed.proofReference !== undefined;
        if (parsed.status === 'BOOKED') evidence.bookingReconciled = true;
        if (parsed.status === 'CANCELLED') evidence.cancellationConfirmed = true;
        try {
          this.guardLeg(attempt.status, parsed.status, evidence);
          await tx.query('UPDATE logistics_leg_attempts SET status=$2,version=version+1,updated_at=$3 WHERE id=$1', [
            attempt.id, parsed.status, this.clock(),
          ]);
          applied = true;
        } catch (error) {
          if (!(error instanceof LogisticsFault)) throw error;
          // An out-of-order or illegal provider status is stored as received and
          // deliberately not applied. It never moves the order.
        }
      }
      await tx.query('UPDATE logistics_provider_events SET applied=$2 WHERE provider=$1 AND provider_event_id=$3', [
        provider, applied, parsed.eventId,
      ]);
      await tx.query(`INSERT INTO v2_audit
        (actor_id,actor_role,aggregate_id,action,reason,before_value,after_value,trace_id)
        VALUES ($1,'PROVIDER',$2,'LOGISTICS_PROVIDER_EVENT',$3,$4,$5,$6)`, [
        PROVIDER_ACTOR_ID, attempt.order_id, `${provider} reported ${parsed.status}`,
        JSON.stringify({ attemptStatus: attempt.status, version: attempt.version }),
        JSON.stringify({ requestedStatus: parsed.status, applied, eventId: parsed.eventId }),
        randomUUID(),
      ]);
      return { accepted: true, duplicate: false };
    });
  }

  private ownedOrder(orderId: string, customerId: string): Promise<OrderRow> {
    return this.tx(async tx => {
      v2.idSchema.parse(orderId);
      const row = (await tx.query<OrderRow>('SELECT * FROM orders_v2_orders WHERE id=$1 AND customer_id=$2', [orderId, customerId])).rows[0];
      if (!row) throw new LogisticsFault('NOT_FOUND', 'Order not found');
      return row;
    });
  }

  /** Customer route: owned tracking, derived from stored events only. */
  async getTracking(token: string, orderId: string): Promise<v2.CustomerTracking> {
    const customer = await this.actorOf(token, CUSTOMER);
    const order = await this.ownedOrder(orderId, customer.id);
    const timeline = await this.timeline(order.id);
    const attempt = (await this.options.db.query<AttemptRow>(
      `SELECT * FROM logistics_leg_attempts WHERE order_id=$1 ORDER BY started_at DESC LIMIT 1`, [order.id])).rows[0];
    const position = attempt
      ? (await this.options.db.query<PositionRow>(
        'SELECT * FROM logistics_positions WHERE leg_attempt_id=$1 ORDER BY reported_at DESC LIMIT 1', [attempt.id])).rows[0]
      : undefined;
    const fresh = position !== undefined && position.reported_at.getTime() >= this.clock().getTime() - this.freshMinutes * 60_000;
    // Step ids are opaque UUIDs by contract. The sequence stays in the
    // rendering order, never in the identifier format, so no caller can
    // reconstruct logistics internals from a customer id.
    // Only stored facts are shown: timeline events and the current status.
    // Unreached milestones are never fabricated as feel-good steps.
    const steps: v2.TrackingStep[] = timeline.map((event, index) => ({
      id: trackingId(order.id, String(event.seq)),
      label: event.label,
      at: event.occurred_at.toISOString(),
      state: index === timeline.length - 1 ? 'CURRENT' : 'DONE',
    }));
    if (steps.length === 0) {
      steps.push({ id: trackingId(order.id, `status:${order.status}`), label: `Status ${order.status}`, state: 'CURRENT' });
    }
    return v2.customerTrackingSchema.parse({
      orderId: order.id,
      status: order.status,
      ...(currentHandoff(order.status) === undefined ? {} : { currentHandoff: currentHandoff(order.status) }),
      steps,
      pickupWindow: order.pickup_window,
      promisedReturnWindow: order.return_window,
      ...(fresh && position !== undefined
        ? { locationUpdatedAt: position.reported_at.toISOString(), locationSource: position.source === 'DEVICE' ? 'RIDER_REPORTED' : 'PROVIDER' }
        : {}),
    });
  }

  /** Customer route: owned custody receipt built from the order and handovers. */
  async getCustodyReceipt(token: string, orderId: string): Promise<v2.CustodyReceipt> {
    const customer = await this.actorOf(token, CUSTOMER);
    const order = await this.ownedOrder(orderId, customer.id);
    const handovers = (await this.options.db.query<HandoverRow>(
      'SELECT * FROM logistics_handovers WHERE order_id=$1 AND accepted ORDER BY created_at', [order.id])).rows;
    const pickupProof = handovers.some(row => row.custody_kind === 'PICKUP_COMPLETED');
    const returnProof = handovers.some(row => row.custody_kind === 'RETURN_COMPLETED');
    const measured = order.measured_lines ?? [];
    const declaredGarmentCount = order.lines.reduce((sum, line) => sum + (line.declaredGarmentCount ?? 0), 0);
    const countedQuantity = measured.reduce((sum, line) => sum + (line.countedQuantity ?? line.measuredPieceQuantity ?? 0), 0);
    const measuredWeightGrams = measured.reduce((sum, line) => sum + (line.measuredWeightGrams ?? 0), 0);
    return v2.custodyReceiptSchema.parse({
      orderId: order.id,
      estimatedQuantity: order.lines.reduce((sum, line) => sum + (line.declaredGarmentCount ?? line.pieceQuantity ?? 0), 0),
      ...(declaredGarmentCount === 0 ? {} : { declaredGarmentCount }),
      ...(countedQuantity === 0 ? {} : { countedQuantity }),
      ...(measuredWeightGrams === 0 ? {} : { measuredWeightGrams }),
      sealedContainerCount: order.containers.filter(container => container.sealed).length,
      amountDueAtReturnMinor: money(order.total_minor),
      currency: 'INR',
      currentHandoff: custodyHandoff(order.status, pickupProof, returnProof),
      updatedAt: order.updated_at.toISOString(),
    });
  }
}

// Stable opaque GUIDs keep the same persisted milestone keyed across refreshes.
function trackingId(orderId: string, milestone: string): string {
  const bytes = createHash('sha256').update(`laundry-tracking-v1\0${orderId}\0${milestone}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function currentHandoff(status: v2.OrderStatus): string | undefined {
  const labels: Partial<Record<v2.OrderStatus, string>> = {
    CONFIRMED: 'Awaiting rider assignment',
    PICKUP_PENDING: 'Rider collecting your laundry',
    AT_FACILITY: 'At the facility',
    AWAITING_ADJUSTMENT: 'Waiting for your approval',
    IN_CARE: 'Laundry in care',
    QUALITY_CHECK: 'Quality check',
    READY_FOR_RETURN: 'Ready for return',
    RETURNING: 'Returning to you',
    DELIVERED: 'Delivered',
    ON_HOLD: 'Order on hold',
    RESOLUTION_REQUIRED: 'Needs attention',
    CANCEL_REQUESTED: 'Cancellation requested',
    CANCELLED: 'Cancelled',
  };
  return labels[status];
}

function custodyHandoff(status: v2.OrderStatus, pickupProof: boolean, returnProof: boolean): v2.CustodyReceipt['currentHandoff'] {
  if (status === 'DELIVERED') return 'DELIVERED';
  if (returnProof) return 'RETURNED';
  if (status === 'RETURNING') return 'RETURN_PENDING';
  if (pickupProof && (status === 'PICKUP_PENDING' || status === 'CONFIRMED')) return 'PICKED_UP';
  switch (status) {
    case 'CONFIRMED': return 'NONE';
    case 'PICKUP_PENDING': return 'PICKUP_PENDING';
    case 'AT_FACILITY':
    case 'AWAITING_ADJUSTMENT': return 'AT_FACILITY';
    case 'IN_CARE':
    case 'QUALITY_CHECK': return 'IN_CARE';
    case 'READY_FOR_RETURN': return 'READY_FOR_RETURN';
    default: return 'NONE';
  }
}
