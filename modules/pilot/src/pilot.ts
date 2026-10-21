import type { Pool } from "pg";
import { ApiError } from "../../shared/src/errors";
import { demoMode } from "../../shared/src/auth";
import type { Actor } from "../../shared/src/auth";
import { randomInt, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { PilotBooking, PilotOrder } from "@wandary/contracts";
import { checkIdempotency, storeIdempotency } from "../../shared/src/idempotency";

export function requirePilot() {
  if (process.env.PILOT_ENABLED !== "true") throw new ApiError("NOT_FOUND", "Pilot is not enabled", { status: 404 });
  if (!demoMode()) throw new ApiError("PROVIDER_UNAVAILABLE", "Pilot example rates and boundaries are demo-only", { status: 503 });
}
export const pilotServices = [
  { code: "WASH_FOLD" as const, name: "Wash and fold", rateMinorPerKg: 6000 },
  { code: "WASH_PRESS" as const, name: "Wash and iron", rateMinorPerKg: 9000 },
];

/** Asia/Kolkata is UTC+05:30 all year. Build the UTC instant from an IST wall
 * time so the comment and the value cannot disagree. */
export const PILOT_TIME_ZONE = "Asia/Kolkata" as const;
const IST_OFFSET_MS = 330 * 60 * 1000;
function istDateParts(now = new Date()) {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate() };
}
function istAt(dayOffset: number, hour: number, minute = 0): Date {
  const { year, month, day } = istDateParts();
  return new Date(Date.UTC(year, month, day + dayOffset, hour - 5, minute - 30));
}

/** A handover code stays usable through the slot window plus a 12 hour grace.
 * A booking made today for tomorrow is therefore not expired at pickup, and a
 * customer who comes back late can ask for a new code. */
export const HANDOVER_CODE_GRACE_MS = 12 * 60 * 60 * 1000;
export function handoverExpiry(windowEnd: Date, now = Date.now()): string {
  return new Date(Math.max(windowEnd.getTime() + HANDOVER_CODE_GRACE_MS, now + 2 * 60 * 60 * 1000)).toISOString();
}

export async function pilotConfig(db: Pool) {
  requirePilot();
  for (let day = 1; day <= 3; day++) {
    // Demo overnight windows, not an approved launch promise.
    const pickup = istAt(day, 20, 0);
    const returned = istAt(day + 1, 8, 0);
    await db.query(`INSERT INTO pilot_slots (pickup_start,pickup_end,return_start,return_end,capacity) VALUES ($1,$2,$3,$4,3) ON CONFLICT (pickup_start) DO NOTHING`,
      [pickup, new Date(+pickup + 3600_000), returned, new Date(+returned + 3600_000)]);
  }
  const slots = (await db.query(`SELECT id, pickup_start AS "pickupStart", pickup_end AS "pickupEnd", return_start AS "returnStart", return_end AS "returnEnd", capacity, reserved FROM pilot_slots WHERE pickup_start > now() ORDER BY pickup_start LIMIT 7`)).rows
    .map((slot) => ({ ...slot, timeZone: PILOT_TIME_ZONE }));
  return { demo: true as const, ratesApproved: false as const, timeZone: PILOT_TIME_ZONE, services: pilotServices, slots,
    facility: { name: "Demo laundry · Indiranagar", lat: 12.9784, lng: 77.6408 },
    demoBoundary: { south: 12.96, north: 12.99, west: 77.625, east: 77.66 } };
}

export type PilotRow = { id: string; customer_id: string; rider_id: string | null; slot_id: string; data: PilotOrder };
/** Only used after persisting a failed handover attempt; business state remains unchanged. */
export class RecordedPilotRejection extends ApiError {}
export function requireOperator(actor: Actor) {
  if (!["operator", "admin"].includes(actor.role)) throw new ApiError("FORBIDDEN", "Founder/operations access required", { status: 403 });
}
export function requireAccess(row: PilotRow | undefined, actor: Actor): asserts row is PilotRow {
  const allowed = row && ((actor.role === "customer" && row.customer_id === actor.id) || (actor.role === "rider" && row.rider_id === actor.id) || ["operator", "admin"].includes(actor.role));
  if (!allowed) throw new ApiError("NOT_FOUND", "Order not found", { status: 404 });
}
export async function pilotView(tx: Pool | PoolClient, row: PilotRow, actor: Actor): Promise<PilotOrder> {
  const view = { ...row.data, riderId: row.rider_id };
  if (actor.role !== "customer") { delete view.pickupCode; delete view.returnCode; }
  if (!["READY_FOR_RETURN", "RETURNING", "DELIVERED"].includes(view.status)) delete view.returnCode;
  view.events = (await tx.query(`SELECT action,label,at FROM pilot_events WHERE order_id=$1 ORDER BY id`, [row.id])).rows.map(r => ({ ...r, at: new Date(r.at).toISOString() }));
  return view;
}
export async function getPilotOrder(db: Pool, actor: Actor, id: string) {
  requirePilot();
  const row = (await db.query<PilotRow>(`SELECT * FROM pilot_orders WHERE id=$1`, [id])).rows[0];
  requireAccess(row, actor);
  return pilotView(db, row, actor);
}
export async function listPilotOrders(db: Pool, actor: Actor) {
  requirePilot();
  const condition = actor.role === "customer" ? "customer_id=$1" : actor.role === "rider" ? "rider_id=$1" : ["operator", "admin"].includes(actor.role) ? "$1::uuid IS NOT NULL" : "FALSE AND $1::uuid IS NOT NULL";
  const rows = (await db.query<PilotRow>(`SELECT * FROM pilot_orders WHERE ${condition} ORDER BY created_at DESC LIMIT 50`, [actor.id])).rows;
  return Promise.all(rows.map(row => pilotView(db, row, actor)));
}
export async function pilotTransaction<T>(
  db: Pool,
  actor: Actor,
  scope: string,
  key: string,
  payload: unknown,
  work: (tx: PoolClient) => Promise<T>,
  /**
   * Runs inside the transaction before any stored response is returned.
   * Authorization belongs here: a replayed request must still pass the
   * access check, otherwise a rider who lost the order could read back a
   * cached response for work they may no longer do.
   */
  guard?: (tx: PoolClient) => Promise<void>,
) {
  requirePilot();
  const tx = await db.connect();
  try {
    await tx.query("BEGIN");
    // Serialize duplicate keys before checking their stored response, including concurrent retries.
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [scope + ":" + key]);
    if (guard) await guard(tx);
    const replay = await checkIdempotency(tx, scope, key, actor.id, payload);
    if (replay.replay) { await tx.query("COMMIT"); return replay.response as T; }
    const result = await work(tx);
    await storeIdempotency(tx, scope, key, actor.id, payload, result);
    await tx.query("COMMIT");
    return result;
  } catch (error) { await tx.query(error instanceof RecordedPilotRejection ? "COMMIT" : "ROLLBACK"); throw error; }
  finally { tx.release(); }
}

/** Delivery partners an operations user can assign. */
export async function listPilotRiders(db: Pool, actor: Actor) {
  requirePilot();
  requireOperator(actor);
  const rows = (await db.query(`SELECT id, name FROM users WHERE role='rider' ORDER BY name`)).rows;
  return rows.map((row) => ({ id: row.id as string, name: row.name as string }));
}

export async function setPilotCapacity(db: Pool, actor: Actor, id: string, capacity: number, key: string) {
  requireOperator(actor);
  return pilotTransaction(db, actor, "pilot.capacity", key, { id, capacity }, async tx => {
    const slot = (await tx.query(`SELECT * FROM pilot_slots WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!slot) throw new ApiError("NOT_FOUND", "Slot not found", { status: 404 });
    if (capacity < slot.reserved) throw new ApiError("NO_CAPACITY", "Capacity cannot be lower than existing reservations", { status: 409 });
    const updated = (await tx.query(
      `UPDATE pilot_slots SET capacity=$2 WHERE id=$1
       RETURNING id, pickup_start AS "pickupStart", pickup_end AS "pickupEnd",
                 return_start AS "returnStart", return_end AS "returnEnd", capacity, reserved`,
      [id, capacity],
    )).rows[0];
    return { ...updated, timeZone: PILOT_TIME_ZONE };
  });
}
export async function createPilotOrder(db: Pool, actor: Actor, body: PilotBooking, key: string) {
  if (actor.role !== "customer") throw new ApiError("FORBIDDEN", "Only customers book", { status: 403 });
  const config = await pilotConfig(db);
  const { south, north, west, east } = config.demoBoundary;
  if (body.address.lat < south || body.address.lat > north || body.address.lng < west || body.address.lng > east) throw new ApiError("OUT_OF_AREA", "Outside the demo Indiranagar boundary", { status: 422 });
  return pilotTransaction(db, actor, "pilot.booking", key, body, async tx => {
    const slot = (await tx.query(`SELECT * FROM pilot_slots WHERE id=$1 FOR UPDATE`, [body.slotId])).rows[0];
    if (!slot || +new Date(slot.pickup_start) <= Date.now()) throw new ApiError("DEADLINE_UNAVAILABLE", "Choose a future pickup slot", { status: 409 });
    if (slot.reserved >= slot.capacity) throw new ApiError("NO_CAPACITY", "This slot is full; choose another", { status: 409 });
    const service = pilotServices.find(s => s.code === body.serviceCode)!;
    const id = randomUUID();
    const pickupStart = new Date(slot.pickup_start);
    const pickupEnd = new Date(slot.pickup_end);
    const returnStart = new Date(slot.return_start);
    const returnEnd = new Date(slot.return_end);
    const data: PilotOrder = { id, customerId: actor.id, riderId: null, slotId: body.slotId, version: 1,
      status: "BOOKED", pickupStatus: "PENDING", returnStatus: "PENDING", paymentStatus: "UNPAID",
      serviceCode: body.serviceCode, estimatedWeightGrams: body.estimatedWeightGrams, measuredWeightGrams: null,
      rateMinorPerKg: service.rateMinorPerKg, totalMinor: Math.ceil(body.estimatedWeightGrams * service.rateMinorPerKg / 1000), proposedTotalMinor: null,
      currency: "INR", address: body.address,
      timeZone: PILOT_TIME_ZONE,
      pickupStart: pickupStart.toISOString(), pickupEnd: pickupEnd.toISOString(),
      returnStart: returnStart.toISOString(), returnEnd: returnEnd.toISOString(),
      pickupCodeExpiresAt: handoverExpiry(pickupEnd), returnCodeExpiresAt: handoverExpiry(returnEnd),
      createdAt: new Date().toISOString(), pickupCode: String(randomInt(100000, 1000000)), returnCode: String(randomInt(100000, 1000000)), holdReason: null, events: [] };
    await tx.query(`UPDATE pilot_slots SET reserved=reserved+1 WHERE id=$1`, [body.slotId]);
    const row = (await tx.query<PilotRow>(`INSERT INTO pilot_orders (id,customer_id,slot_id,data) VALUES ($1,$2,$3,$4) RETURNING *`, [id, actor.id, body.slotId, JSON.stringify(data)])).rows[0];
    await tx.query(`INSERT INTO pilot_events (order_id,actor_id,action,label) VALUES ($1,$2,'BOOKED','Slot reserved; payment due at return')`, [id, actor.id]);
    return pilotView(tx, row, actor);
  });
}
