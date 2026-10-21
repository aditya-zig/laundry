import type { Pool } from "pg";
import type { PilotLocation, PilotLocationReport } from "@laundry/contracts";
import { ApiError } from "../../shared/src/errors";
import type { Actor } from "../../shared/src/auth";
import { pilotTransaction, requireAccess, requirePilot, type PilotRow } from "./pilot";

/** A reported position older than this is shown as stale, never as live
 * tracking. Two minutes is short enough that a stopped rider does not look
 * like a moving one. */
export const LOCATION_STALE_AFTER_SECONDS = 120;

/** A report may not claim a time further ahead than this. Without the bound a
 * far-future timestamp would compute a negative age and read as fresh. */
export const LOCATION_MAX_FUTURE_SKEW_SECONDS = 120;

/** A report older than this is refused rather than stored: the customer would
 * otherwise see a point describing where the rider was yesterday. */
export const LOCATION_MAX_AGE_SECONDS = 24 * 60 * 60;

/** Recompute freshness from the capture time. Stored bodies are replayed by
 * the idempotency layer; a replayed age is not a fresh age. */
export function withFreshness(location: PilotLocation): PilotLocation {
  const ageSeconds = Math.max(0, Math.round((Date.now() - new Date(location.capturedAt).getTime()) / 1000));
  return { ...location, ageSeconds, stale: ageSeconds > LOCATION_STALE_AFTER_SECONDS };
}

function locationView(row: {
  lat: number;
  lng: number;
  captured_at: Date | string;
  reported_at: Date | string;
  source: string;
}): PilotLocation {
  const capturedAt = new Date(row.captured_at);
  // Freshness is measured on the server clock against the capture time, so a
  // device with a wrong clock cannot make an old point look new.
  const ageSeconds = Math.max(0, Math.round((Date.now() - capturedAt.getTime()) / 1000));
  return {
    lat: Number(row.lat),
    lng: Number(row.lng),
    capturedAt: capturedAt.toISOString(),
    reportedAt: new Date(row.reported_at).toISOString(),
    source: row.source as PilotLocation["source"],
    ageSeconds,
    stale: ageSeconds > LOCATION_STALE_AFTER_SECONDS,
    staleAfterSeconds: LOCATION_STALE_AFTER_SECONDS,
  };
}

/** Records a position the delivery partner claims to be at. The source is
 * stored with the point so a hand-typed coordinate is never presented as a
 * GPS fix, and the capture time travels with it so a stale point can be
 * marked as stale instead of shown as live tracking. */
export async function reportPilotLocation(
  db: Pool,
  actor: Actor,
  orderId: string,
  report: PilotLocationReport,
  key: string,
): Promise<PilotLocation> {
  requirePilot();
  if (actor.role !== "rider") {
    throw new ApiError("FORBIDDEN", "Only the assigned delivery partner reports a position", { status: 403 });
  }
  let loaded: PilotRow | undefined;
  const capturedAt = new Date(report.capturedAt).getTime();
  if (!Number.isFinite(capturedAt)) {
    throw new ApiError("INVALID_INPUT", "capturedAt must be an ISO timestamp", { status: 400 });
  }
  const now = Date.now();
  if (capturedAt > now + LOCATION_MAX_FUTURE_SKEW_SECONDS * 1000) {
    throw new ApiError("INVALID_INPUT", "Position timestamp is too far in the future", { status: 400 });
  }
  if (capturedAt < now - LOCATION_MAX_AGE_SECONDS * 1000) {
    throw new ApiError("INVALID_INPUT", "Position is more than a day old; report a fresh position", { status: 400 });
  }
  const result = await pilotTransaction(
    db,
    actor,
    "pilot.location",
    key,
    { orderId, ...report },
    async (tx) => {
      await tx.query(
        `INSERT INTO pilot_locations (order_id,lat,lng,captured_at,source,actor_id)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (order_id) DO UPDATE SET lat=EXCLUDED.lat, lng=EXCLUDED.lng,
           captured_at=EXCLUDED.captured_at, reported_at=now(), source=EXCLUDED.source, actor_id=EXCLUDED.actor_id`,
        [orderId, report.lat, report.lng, report.capturedAt, report.source, actor.id],
      );
      await tx.query(
        `INSERT INTO pilot_location_reports (order_id,lat,lng,captured_at,source,actor_id) VALUES ($1,$2,$3,$4,$5,$6)`,
        [orderId, report.lat, report.lng, report.capturedAt, report.source, actor.id],
      );
      const stored = (await tx.query(`SELECT * FROM pilot_locations WHERE order_id=$1`, [orderId])).rows[0];
      return locationView(stored);
    },
    async (tx) => {
      // Access is checked before any stored response is replayed, so a
      // delivery partner who lost the order cannot read a replayed report.
      loaded = (await tx.query<PilotRow>(`SELECT * FROM pilot_orders WHERE id=$1 FOR UPDATE`, [orderId])).rows[0];
      requireAccess(loaded, actor);
      if (["DELIVERED", "CANCELLED"].includes(loaded!.data.status)) {
        throw new ApiError("NOT_FOUND", "Tracking is closed for this order", { status: 404 });
      }
    },
  );
  return withFreshness(result);
}

/** The latest reported position. Only the customer who owns the order, the
 * assigned delivery partner and operations may read it. */
export async function getPilotLocation(db: Pool, actor: Actor, orderId: string): Promise<PilotLocation> {
  requirePilot();
  const row = (await db.query<PilotRow>(`SELECT * FROM pilot_orders WHERE id=$1`, [orderId])).rows[0];
  requireAccess(row, actor);
  if (["DELIVERED", "CANCELLED"].includes(row!.data.status)) {
    throw new ApiError("NOT_FOUND", "Tracking is closed for this order", { status: 404 });
  }
  const stored = (await db.query(`SELECT * FROM pilot_locations WHERE order_id=$1`, [orderId])).rows[0];
  if (!stored) throw new ApiError("NOT_FOUND", "No position has been reported for this order", { status: 404 });
  return locationView(stored);
}
