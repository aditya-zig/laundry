import { createHmac, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { ApiError, assertUuid } from "../../shared/src/errors";
import { demoMode, type Actor } from "../../shared/src/auth";

/** Razorpay webhook signature: HMAC-SHA256 of raw body with key secret. */
export function verifyRazorpaySignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const digest = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (digest.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

async function razorpayFetch(path: string, body: unknown) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new ApiError("PROVIDER_UNAVAILABLE", "Razorpay credentials not configured", { status: 502 });
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError("PROVIDER_OUTCOME_UNKNOWN", `Razorpay call failed: ${res.status}`, { status: 502 });
  return res.json();
}

export const razorpayProvider = {
  createOrder: (amountMinor: number, receipt: string) => razorpayFetch("/orders", { amount: amountMinor, currency: "INR", receipt }),
  createRefund: (paymentId: string, amountMinor: number) => razorpayFetch(`/payments/${paymentId}/refund`, { amount: amountMinor }),
};

export async function getPayment(db: Pool, actor: Actor, id: string) {
  if (!["customer", "operator", "admin"].includes(actor.role)) throw new ApiError("NOT_FOUND", "Payment not found", { status: 404 });
  assertUuid(id, "paymentId");
  const pay = (await db.query(`SELECT * FROM payments WHERE id = $1`, [id])).rows[0];
  if (!pay) throw new ApiError("NOT_FOUND", "Payment not found", { status: 404 });
  const order = (await db.query(`SELECT customer_id FROM orders WHERE id = $1`, [pay.order_id])).rows[0];
  if (actor.role === "customer" && order?.customer_id !== actor.id) throw new ApiError("NOT_FOUND", "Payment not found", { status: 404 });
  return {
    id: pay.id as string, orderId: pay.order_id as string, amountMinor: pay.amount_minor as number,
    currency: "INR" as const, status: pay.status as string, paymentUrl: pay.payment_url as string,
  };
}

export async function listReceipts(db: Pool, actor: Actor, orderId: string) {
  if (!["customer", "operator", "admin"].includes(actor.role)) throw new ApiError("NOT_FOUND", "Order not found", { status: 404 });
  assertUuid(orderId, "orderId");
  const order = (await db.query(`SELECT * FROM orders WHERE id = $1`, [orderId])).rows[0];
  if (!order || (actor.role === "customer" && order.customer_id !== actor.id)) throw new ApiError("NOT_FOUND", "Order not found", { status: 404 });
  const rows = (await db.query(`SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at`, [orderId])).rows;
  return rows.map((p) => ({ id: p.id as string, status: p.status as string, amountMinor: p.amount_minor as number, purpose: p.purpose as string }));
}

export async function requestRefund(db: Pool, actor: Actor, input: { orderId: string; paymentId: string; amountMinor: number; reason: string; obligationId?: string }) {
  if (actor.role !== "operator" && actor.role !== "admin") throw new ApiError("FORBIDDEN", "Ops only", { status: 403 });
  // This adapter has no durable live-provider reconciliation or stable external
  // refund reference. Real refunds belong to B05, never to the legacy simulator.
  if (!demoMode()) throw new ApiError("PROVIDER_UNAVAILABLE", "Live refunds are not enabled on the legacy API", { status: 503 });
  if (input.amountMinor <= 0) throw new ApiError("INVALID_INPUT", "Refund amount must be positive", { status: 400 });
  const captured = Number((await db.query(`SELECT COALESCE(SUM(amount_minor),0)::int AS s FROM payments WHERE order_id = $1 AND status = 'CAPTURED'`, [input.orderId])).rows[0].s);
  const refunded = Number((await db.query(`SELECT COALESCE(SUM(amount_minor),0)::int AS s FROM refunds WHERE order_id = $1 AND status <> 'FAILED'`, [input.orderId])).rows[0].s);
  if (input.amountMinor > captured - refunded) throw new ApiError("INVALID_INPUT", "Refunded sums cannot exceed captured sums", { status: 400 });
  const row = (await db.query(
    `INSERT INTO refunds (order_id, payment_id, obligation_id, amount_minor, reason, status) VALUES ($1,$2,$3,$4,$5,'REQUESTED') RETURNING *`,
    [input.orderId, input.paymentId, input.obligationId ?? null, input.amountMinor, input.reason],
  )).rows[0];
  // Explicit demo-only ledger behavior. The presence of keys must not make a
  // simulator contact a commercial provider or send a local UUID as a payment ID.
  await db.query(`UPDATE refunds SET status = 'SUCCEEDED' WHERE id = $1`, [row.id]);
  row.status = "SUCCEEDED";
  return { id: row.id as string, status: row.status as string, amountMinor: row.amount_minor as number };
}

export async function reconciliation(db: Pool, actor: Actor) {
  if (actor.role !== "operator" && actor.role !== "admin") throw new ApiError("FORBIDDEN", "Ops only", { status: 403 });
  const captured = Number((await db.query(`SELECT COALESCE(SUM(amount_minor),0)::int AS s FROM payments WHERE status = 'CAPTURED'`)).rows[0].s);
  const refunded = Number((await db.query(`SELECT COALESCE(SUM(amount_minor),0)::int AS s FROM refunds WHERE status = 'SUCCEEDED'`)).rows[0].s);
  const openObs = (await db.query(`SELECT * FROM refund_obligations WHERE status = 'OPEN' ORDER BY created_at DESC LIMIT 50`)).rows;
  return { capturedMinor: captured, refundedMinor: refunded, netMinor: captured - refunded, openObligations: openObs };
}

/** Authoritative Razorpay event application with inbox dedupe. */
export async function applyRazorpayEvent(db: Pool, eventId: string, event: string, paymentEntity: { id: string; order_id?: string; amount?: number; status?: string }) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const seen = (await client.query(`SELECT event_id FROM inbox WHERE event_id = $1`, [eventId])).rows[0];
    if (seen) { await client.query("COMMIT"); return { duplicate: true }; }
    const pay = paymentEntity.id
      ? (await client.query(`SELECT * FROM payments WHERE provider_ref = $1 OR id = $2`, [paymentEntity.id, paymentEntity.id])).rows[0]
      : null;
    if (pay && (event === "payment.captured" || paymentEntity.status === "captured")) {
      await client.query(`UPDATE payments SET status = 'CAPTURED', provider_ref = $1, updated_at = now() WHERE id = $2`, [paymentEntity.id, pay.id]);
      const { emitOutbox } = await import("../../shared/src/idempotency");
      await emitOutbox(client, pay.order_id as string, "payment.captured.v1", { paymentId: pay.id, orderId: pay.order_id });
    }
    await client.query(`INSERT INTO inbox (event_id) VALUES ($1)`, [eventId]);
    await client.query("COMMIT");
    return { duplicate: false };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* settled */ }
    throw e;
  } finally {
    client.release();
  }
}
