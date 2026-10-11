import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { ApiError } from "../../shared/src/errors";
import { checkIdempotency, storeIdempotency } from "../../shared/src/idempotency";
import type { Actor } from "../../shared/src/auth";

interface QuoteLineInput { serviceId: string; garmentTypeId: string; quantity: number; estimatedWeightGrams?: number; careNotes?: string }

const MAX_GARMENTS = 100;
const MAX_LINES = 20;

export function bucketKeyFor(windowStartIso: string): string {
  const d = new Date(windowStartIso);
  const hour = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()));
  return `slot:${hour.toISOString()}`;
}

async function priceLines(db: Pool, lines: QuoteLineInput[]) {
  let subtotal = 0;
  let slowestHours = 0;
  let provisional = false;
  const priced = [];
  for (const line of lines) {
    if (line.quantity < 1 || line.quantity > 100) throw new ApiError("INVALID_INPUT", "Quantity must be 1..100", { status: 400, fieldErrors: { quantity: "1..100" } });
    const svc = (await db.query(`SELECT * FROM services WHERE id = $1 AND active = TRUE`, [line.serviceId])).rows[0];
    if (!svc) throw new ApiError("INVALID_INPUT", `Unknown service ${line.serviceId}`, { status: 400, fieldErrors: { serviceId: "unknown service" } });
    const garment = (await db.query(`SELECT * FROM garment_types WHERE id = $1 AND service_id = $2`, [line.garmentTypeId, line.serviceId])).rows[0];
    if (!garment) throw new ApiError("INVALID_INPUT", "Garment type does not belong to the service", { status: 400, fieldErrors: { garmentTypeId: "mismatch" } });
    if (line.estimatedWeightGrams !== undefined && (line.estimatedWeightGrams < 1 || line.estimatedWeightGrams > 50000)) {
      throw new ApiError("INVALID_INPUT", "estimatedWeightGrams must be 1..50000", { status: 400 });
    }
    if (line.estimatedWeightGrams !== undefined) provisional = true;
    const unit = garment.price_minor as number;
    const total = unit * line.quantity;
    subtotal += total;
    slowestHours = Math.max(slowestHours, svc.turnaround_hours as number);
    priced.push({ ...line, unitPriceMinor: unit, lineTotalMinor: total });
  }
  return { priced, subtotal, slowestHours, provisional };
}

export async function createQuote(
  db: Pool, actor: Actor, input: { addressId: string; lines: QuoteLineInput[]; pickupWindow: { start: string; end: string; timezone: string }; requestedReturnBy: string; timezone: string },
  meta: { idempotencyKey?: string },
) {
  if (actor.role !== "customer") throw new ApiError("FORBIDDEN", "Only customers can quote", { status: 403 });
  if (!input.lines || input.lines.length < 1 || input.lines.length > MAX_LINES) throw new ApiError("INVALID_INPUT", "Order needs 1..20 lines", { status: 400 });
  const totalQty = input.lines.reduce((n, l) => n + l.quantity, 0);
  if (totalQty > MAX_GARMENTS) throw new ApiError("INVALID_INPUT", "Maximum 100 garments per order", { status: 400 });
  const pickupStart = Date.parse(input.pickupWindow.start);
  const pickupEnd = Date.parse(input.pickupWindow.end);
  if (!(pickupEnd > pickupStart)) throw new ApiError("INVALID_INPUT", "Pickup window end must be after start", { status: 400 });
  if (!input.timezone) throw new ApiError("INVALID_INPUT", "timezone is required", { status: 400 });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const replay = await checkIdempotency(client, "quotes", meta.idempotencyKey, actor.id, input);
    if (replay.replay) { await client.query("COMMIT"); return replay.response as never; }

    const addr = (await client.query(`SELECT * FROM addresses WHERE id = $1 AND deleted = FALSE`, [input.addressId])).rows[0];
    if (!addr) { await client.query("ROLLBACK"); throw new ApiError("NOT_FOUND", "Address not found", { status: 404 }); }
    if (addr.owner_id !== actor.id) { await client.query("ROLLBACK"); throw new ApiError("NOT_FOUND", "Address not found", { status: 404 }); }

    const { priced, subtotal, slowestHours, provisional } = await priceLines(client as unknown as Pool, input.lines);
    const feasibleReturn = pickupEnd + slowestHours * 3600_000;
    if (Date.parse(input.requestedReturnBy) < feasibleReturn) {
      await client.query("ROLLBACK");
      throw new ApiError("DEADLINE_UNAVAILABLE", "Requested return is earlier than the slowest service turnaround", { status: 422 });
    }
    const promisedStart = new Date(feasibleReturn).toISOString();
    const promisedEnd = new Date(feasibleReturn + 6 * 3600_000).toISOString();

    // Real concurrency guard: lock the capacity row for this slot.
    const key = bucketKeyFor(input.pickupWindow.start);
    let bucket = (await client.query(`SELECT * FROM capacity_buckets WHERE bucket_key = $1 FOR UPDATE`, [key])).rows[0];
    if (!bucket) {
      bucket = (await client.query(
        `INSERT INTO capacity_buckets (bucket_key, window_start, window_end, capacity_total, reserved) VALUES ($1,$2,$3,2,0) RETURNING *`,
        [key, input.pickupWindow.start, input.pickupWindow.end])).rows[0];
    }
    const activeHolds = Number((await client.query(
      `SELECT COUNT(*)::int AS n FROM capacity_holds WHERE bucket_key = $1 AND released = FALSE AND expires_at > now()`, [key])).rows[0].n);
    if (activeHolds >= Number(bucket.capacity_total)) {
      await client.query("ROLLBACK");
      throw new ApiError("NO_CAPACITY", "Pickup slot is full; choose another window", { status: 409 });
    }
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const hold = (await client.query(
      `INSERT INTO capacity_holds (bucket_key, expires_at) VALUES ($1,$2) RETURNING *`, [key, expiresAt])).rows[0];

    const tax = Math.round(subtotal * 0.12);
    const total = subtotal + tax;
    const breakdown = [
      ...priced.map((l) => ({ label: `${l.quantity} x garment @ ${l.unitPriceMinor}`, amountMinor: l.lineTotalMinor })),
      { label: "Pickup fee", amountMinor: 0 },
      { label: "Tax (demo 12%)", amountMinor: tax },
    ];
    const rateCard = (await client.query(`SELECT * FROM rate_cards ORDER BY version DESC LIMIT 1`)).rows[0];
    const quoteId = randomUUID();
    await client.query(
      `INSERT INTO quotes (id, version, customer_id, address_id, lines, breakdown, total_minor, currency, provisional, pickup_window, promised_return, rate_card_id, rate_card_version, hold_id, expires_at)
       VALUES ($1,1,$2,$3,$4,$5,$6,'INR',$7,$8,$9,$10,$11,$12,$13)`,
      [quoteId, actor.id, input.addressId, JSON.stringify(priced), JSON.stringify(breakdown), total, provisional,
        JSON.stringify(input.pickupWindow), JSON.stringify({ start: promisedStart, end: promisedEnd, timezone: input.timezone }),
        rateCard?.id ?? null, rateCard?.version ?? 1, hold.id, expiresAt],
    );
    await client.query(`UPDATE capacity_holds SET quote_id = $1 WHERE id = $2`, [quoteId, hold.id]);
    const quote = {
      id: quoteId, version: 1, expiresAt,
      rateCardId: rateCard?.id, rateCardVersion: rateCard?.version ?? 1,
      lines: priced, totalMinor: total, currency: "INR", provisional,
      pickupWindow: input.pickupWindow,
      promisedReturnWindow: { start: promisedStart, end: promisedEnd, timezone: input.timezone },
      breakdown,
    };
    await storeIdempotency(client, "quotes", meta.idempotencyKey, actor.id, input, quote);
    await client.query("COMMIT");
    return quote;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* settled */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function getQuote(db: Pool, actor: Actor, id: string) {
  const row = (await db.query(`SELECT * FROM quotes WHERE id = $1`, [id])).rows[0];
  if (!row || row.customer_id !== actor.id) throw new ApiError("NOT_FOUND", "Quote not found", { status: 404 });
  return toQuote(row);
}

function toQuote(row: Record<string, never>) {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string, version: r.version as number, expiresAt: new Date(r.expires_at as string).toISOString(),
    rateCardId: (r.rate_card_id as string) ?? undefined, rateCardVersion: r.rate_card_version as number,
    lines: r.lines as unknown[], totalMinor: r.total_minor as number, currency: "INR" as const,
    provisional: r.provisional as boolean,
    pickupWindow: r.pickup_window as { start: string; end: string; timezone: string },
    promisedReturnWindow: r.promised_return as { start: string; end: string; timezone: string },
    breakdown: r.breakdown as { label: string; amountMinor: number }[],
  };
}
