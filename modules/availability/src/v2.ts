import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { v2 } from '@laundry/contracts';
import { createPostgresCommandExecutor } from '../../shared/src/command-executor';
import { AvailabilityFault } from './errors';
import { localDay, openSlots } from './time';

/**
 * Service areas, published slot pairs and atomic capacity.
 *
 * A bucket is the countable resource for one area, facility and window. Holds
 * are the only path to a reservation, and a hold leaves the HELD state exactly
 * once, so capacity comes back once on release or expiry. Reads never create
 * capacity: an area without provisioned buckets publishes NO_CAPACITY pairs and
 * nothing is bookable.
 */
export interface AvailabilityOptions {
  db: Pool;
  authenticate?: (token: string) => Promise<{ actor: v2.Actor }>;
  clock?: () => Date;
  holdMinutes?: number;
}

interface AreaRow {
  id: string;
  name: string;
  timezone: string;
  polygon: v2.ServiceAreaPoint[];
  hours: v2.ServiceAreaHours[];
  slot_minutes: number;
  pickup_lead_minutes: number;
  booking_horizon_days: number;
  active: boolean;
}

interface BucketRow {
  id: string;
  facility_id: string;
  area_id: string;
  starts_at: Date;
  ends_at: Date;
  timezone: string;
  capacity: number;
  reserved: number;
  version: number;
}

const STAFF = new Set(['OPERATOR', 'ADMIN']);
const CALENDAR_READERS = new Set(['OPERATOR', 'SUPPORT', 'ADMIN']);

function bucket(row: BucketRow): v2.CapacityBucket {
  return v2.capacityBucketSchema.parse({
    id: row.id,
    facilityId: row.facility_id,
    areaId: row.area_id,
    window: { start: row.starts_at.toISOString(), end: row.ends_at.toISOString(), timezone: row.timezone },
    capacity: row.capacity,
    reserved: row.reserved,
    version: row.version,
  });
}

function firstAtOrAfter(slots: ReadonlyArray<{ start: Date; end: Date }>, threshold: number): { start: Date; end: Date } | undefined {
  let low = 0, high = slots.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (slots[middle].start.getTime() < threshold) low = middle + 1; else high = middle;
  }
  return slots[low];
}

function pairId(areaId: string, start: string): string {
  const digest = createHash('sha256').update(`${areaId}:${start}`).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export class AvailabilityService {
  private readonly executor: ReturnType<typeof createPostgresCommandExecutor>;
  private readonly clock: () => Date;
  private readonly holdMinutes: number;
  constructor(private readonly options: AvailabilityOptions) {
    this.executor = createPostgresCommandExecutor(options.db);
    this.clock = options.clock ?? (() => new Date());
    this.holdMinutes = options.holdMinutes ?? 15;
    if (!Number.isSafeInteger(this.holdMinutes) || this.holdMinutes < 1 || this.holdMinutes > 120) {
      throw new Error('Hold lifetime must be between 1 and 120 minutes');
    }
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

  private async area(id: string): Promise<AreaRow> {
    const row = (await this.options.db.query<AreaRow>(
      'SELECT * FROM availability_areas WHERE id=$1 AND active', [id])).rows[0];
    if (!row) throw new AvailabilityFault('NOT_FOUND', 'Service area is not available');
    return row;
  }

  private project(row: AreaRow): v2.ServiceArea {
    return v2.serviceAreaSchema.parse({
      id: row.id,
      name: row.name,
      timezone: row.timezone,
      polygon: row.polygon,
      hours: row.hours,
      active: row.active,
    });
  }

  async checkArea(postalCode: string): Promise<v2.ServiceArea> {
    if (!/^[1-9][0-9]{5}$/.test(postalCode)) throw new AvailabilityFault('NOT_FOUND', 'Postal code is not served');
    const row = (await this.options.db.query<AreaRow>(`SELECT a.* FROM availability_areas a
      JOIN availability_area_postal_codes p ON p.area_id=a.id
      WHERE p.postal_code=$1 AND a.active`, [postalCode])).rows[0];
    if (!row) throw new AvailabilityFault('NOT_FOUND', 'Postal code is not served');
    return this.project(row);
  }

  async listSlots(query: v2.SlotQuery): Promise<v2.SlotPair[]> {
    const parsed = v2.slotQuerySchema.parse(query);
    const area = await this.area(parsed.areaId);
    const serviceIds = [...new Set(parsed.serviceIds)];
    const services = (await this.options.db.query<{ id: string; turnaround_hours: number }>(
      'SELECT id, turnaround_hours FROM catalog_services WHERE id = ANY($1) AND active', [serviceIds])).rows;
    if (services.length !== serviceIds.length) throw new AvailabilityFault('NOT_FOUND', 'One or more services are not published');
    const turnaroundMs = Math.max(...services.map(item => item.turnaround_hours)) * 3_600_000;
    const from = new Date(parsed.from), to = new Date(parsed.to);
    const lower = new Date(Math.max(from.getTime(), this.clock().getTime() + area.pickup_lead_minutes * 60_000));
    const horizonEnd = new Date(lower.getTime() + area.booking_horizon_days * 86_400_000);
    if (this.clock().getTime() > to.getTime() || lower.getTime() >= horizonEnd.getTime()) return [];

    const horizonDays = area.booking_horizon_days;
    const slots = openSlots(localDay(lower, area.timezone), horizonDays, area.hours, area.timezone, area.slot_minutes);
    const buckets = (await this.options.db.query<BucketRow>(`SELECT * FROM availability_buckets
      WHERE area_id=$1 AND starts_at >= $2 AND ends_at <= $3`, [parsed.areaId, lower, new Date(Math.min(to.getTime(), horizonEnd.getTime()))])).rows;
    const byStart = new Map(buckets.map(row => [row.starts_at.getTime(), row]));

    const pairs: v2.SlotPair[] = [];
    for (const pickup of slots) {
      if (pickup.start.getTime() < lower.getTime() || pickup.start.getTime() >= to.getTime()) continue;
      const threshold = pickup.end.getTime() + turnaroundMs;
      const returned = firstAtOrAfter(slots, threshold);
      if (!returned) continue;
      const capacityRow = byStart.get(pickup.start.getTime());
      const deadlineMissed = parsed.requestedReturnBy !== undefined &&
        returned.start.getTime() > new Date(parsed.requestedReturnBy).getTime();
      const noCapacity = !capacityRow || capacityRow.reserved >= capacityRow.capacity;
      const reason = deadlineMissed ? 'DEADLINE_UNAVAILABLE' : noCapacity ? 'NO_CAPACITY' : undefined;
      pairs.push(v2.slotPairSchema.parse({
        id: pairId(area.id, pickup.start.toISOString()),
        pickupWindow: { start: pickup.start.toISOString(), end: pickup.end.toISOString(), timezone: area.timezone },
        returnWindow: { start: returned.start.toISOString(), end: returned.end.toISOString(), timezone: area.timezone },
        available: reason === undefined,
        ...(reason === undefined ? {} : { unavailableReason: reason }),
      }));
      // A single search can span the whole booking horizon; cap the published
      // response so one request cannot assemble a multi-year slot list.
      if (pairs.length >= 400) break;
    }
    return pairs;
  }

  private async staff(token: string, allowed: Set<string>): Promise<v2.Actor> {
    if (!this.options.authenticate) throw new AvailabilityFault('UNAUTHENTICATED', 'Sign in again to continue');
    const { actor } = await this.options.authenticate(token);
    if (!allowed.has(actor.role)) throw new AvailabilityFault('FORBIDDEN', 'This operation requires staff access');
    return actor;
  }

  async operationsCalendar(
    token: string,
    filter: { areaId?: string; from?: string; to?: string } = {},
  ): Promise<v2.OperationsCalendar> {
    await this.staff(token, CALENDAR_READERS);
    const values: unknown[] = [];
    const where: string[] = [];
    if (filter.areaId !== undefined) { values.push(v2.idSchema.parse(filter.areaId)); where.push(`area_id=$${values.length}`); }
    if (filter.from !== undefined) { values.push(new Date(v2.instantSchema.parse(filter.from))); where.push(`ends_at > $${values.length}`); }
    if (filter.to !== undefined) { values.push(new Date(v2.instantSchema.parse(filter.to))); where.push(`starts_at < $${values.length}`); }
    const rows = (await this.options.db.query<BucketRow>(
      `SELECT * FROM availability_buckets ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY starts_at LIMIT 500`, values)).rows;
    return v2.operationsCalendarSchema.parse({
      buckets: rows.map(bucket),
      generatedAt: this.clock().toISOString(),
    });
  }

  async setCapacity(token: string, input: v2.CapacityUpdate, key: string): Promise<v2.CapacityBucket> {
    const parsed = v2.capacityUpdateSchema.parse(input);
    const actor = await this.staff(token, STAFF);
    const result = await this.executor.execute(
      {
        actor,
        operation: 'availability.capacity',
        idempotencyKey: key,
        payload: parsed as unknown as v2.JsonValue,
        traceId: randomUUID(),
      },
      async () => { await this.staff(token, STAFF); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const row = (await tx.query<BucketRow>(
          'SELECT * FROM availability_buckets WHERE id=$1 FOR UPDATE', [parsed.bucketId])).rows[0];
        if (!row) throw new AvailabilityFault('NOT_FOUND', 'Capacity bucket not found');
        if (row.version !== parsed.expectedVersion) {
          throw new AvailabilityFault('VERSION_CONFLICT', 'Capacity changed since it was read', row.version);
        }
        if (parsed.capacity < row.reserved) {
          throw new AvailabilityFault('INVALID_INPUT', 'Capacity cannot be set below the reserved count');
        }
        const updated = (await tx.query<BucketRow>(
          'UPDATE availability_buckets SET capacity=$2, version=version+1, updated_at=$3 WHERE id=$1 RETURNING *',
          [parsed.bucketId, parsed.capacity, this.clock()])).rows[0];
        await scope.audit({
          aggregateId: parsed.bucketId,
          action: 'CAPACITY_UPDATED',
          reason: parsed.reason,
          before: { capacity: row.capacity, reserved: row.reserved, version: row.version },
          after: { capacity: updated.capacity, reserved: updated.reserved, version: updated.version },
        });
        return bucket(updated) as unknown as v2.JsonValue;
      },
    );
    return v2.capacityBucketSchema.parse(result);
  }

  /** Reserve one unit for the exact published window. The conditional bucket
   * update is what makes two concurrent last-slot holds resolve to one. */
  async hold(areaId: string, window: v2.ScheduleWindow): Promise<{ holdId: string; expiresAt: string }> {
    v2.idSchema.parse(areaId);
    const parsed = v2.windowSchema.parse(window);
    const from = new Date(parsed.start), to = new Date(parsed.end);
    if (from.getTime() <= this.clock().getTime()) throw new AvailabilityFault('INVALID_INPUT', 'Pickup window has already started');
    return this.tx(async tx => {
      const candidates = (await tx.query<BucketRow>(`SELECT * FROM availability_buckets
        WHERE area_id=$1 AND starts_at=$2 AND ends_at=$3 AND reserved < capacity
        ORDER BY facility_id, id FOR UPDATE`, [areaId, from, to])).rows;
      const row = candidates[0];
      if (!row) throw new AvailabilityFault('NO_CAPACITY', 'That pickup window is no longer available');
      await tx.query('UPDATE availability_buckets SET reserved=reserved+1, updated_at=$2 WHERE id=$1', [row.id, this.clock()]);
      const holdId = randomUUID();
      const expiresAt = new Date(this.clock().getTime() + this.holdMinutes * 60_000);
      await tx.query(`INSERT INTO availability_holds (id,bucket_id,status,expires_at,created_at)
        VALUES ($1,$2,'HELD',$3,$4)`, [holdId, row.id, expiresAt, this.clock()]);
      return { holdId, expiresAt: expiresAt.toISOString() };
    });
  }

  async reserve(holdId: string, orderId: string): Promise<{ reservationId: string }> {
    v2.idSchema.parse(holdId);
    v2.idSchema.parse(orderId);
    return this.tx(async tx => {
      const hold = (await tx.query<{ id: string; bucket_id: string; order_id: string | null; status: string; expires_at: Date }>(
        'SELECT id,bucket_id,order_id,status,expires_at FROM availability_holds WHERE id=$1 FOR UPDATE', [holdId])).rows[0];
      if (!hold) throw new AvailabilityFault('NOT_FOUND', 'Hold not found');
      if (hold.status === 'RESERVED') {
        if (hold.order_id === orderId) return { reservationId: hold.id };
        throw new AvailabilityFault('VERSION_CONFLICT', 'Hold already belongs to another order');
      }
      if (hold.status !== 'HELD') throw new AvailabilityFault('NOT_FOUND', 'Hold is no longer available');
      if (hold.expires_at.getTime() <= this.clock().getTime()) {
        await this.settle(tx, hold.id, hold.bucket_id, 'EXPIRED');
        throw new AvailabilityFault('NOT_FOUND', 'Hold expired before confirmation');
      }
      try {
        await tx.query("UPDATE availability_holds SET status='RESERVED', order_id=$2 WHERE id=$1", [hold.id, orderId]);
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new AvailabilityFault('VERSION_CONFLICT', 'This order already holds capacity');
        }
        throw error;
      }
      return { reservationId: hold.id };
    });
  }

  async release(holdId: string, reason: string): Promise<{ released: boolean }> {
    v2.idSchema.parse(holdId);
    if (!reason.trim()) throw new AvailabilityFault('INVALID_INPUT', 'A release reason is required');
    return this.tx(async tx => {
      const hold = (await tx.query<{ id: string; bucket_id: string; status: string }>(
        'SELECT id,bucket_id,status FROM availability_holds WHERE id=$1 FOR UPDATE', [holdId])).rows[0];
      if (!hold || (hold.status !== 'HELD' && hold.status !== 'RESERVED')) return { released: false };
      await this.settle(tx, hold.id, hold.bucket_id, 'RELEASED');
      return { released: true };
    });
  }

  /** Idempotent sweep. Capacity returns only for the row that was HELD, so a
   * restarted worker repeating the sweep cannot release twice. */
  async expireHolds(limit = 100): Promise<number> {
    let expired = 0;
    while (true) {
      const batch = await this.tx(async tx => {
        const rows = (await tx.query<{ id: string; bucket_id: string }>(`SELECT id,bucket_id FROM availability_holds
          WHERE status='HELD' AND expires_at <= $1 ORDER BY expires_at LIMIT $2 FOR UPDATE SKIP LOCKED`, [this.clock(), limit])).rows;
        for (const row of rows) await this.settle(tx, row.id, row.bucket_id, 'EXPIRED');
        return rows.length;
      });
      expired += batch;
      if (batch < limit) return expired;
    }
  }

  private async settle(tx: PoolClient, holdId: string, bucketId: string, status: 'RELEASED' | 'EXPIRED'): Promise<void> {
    const settled = await tx.query(
      "UPDATE availability_holds SET status=$2, settled_at=$3 WHERE id=$1 AND status IN ('HELD','RESERVED')",
      [holdId, status, this.clock()]);
    if (!settled.rowCount) return;
    await tx.query('UPDATE availability_buckets SET reserved=GREATEST(reserved-1,0), updated_at=$2 WHERE id=$1', [bucketId, this.clock()]);
  }
}

