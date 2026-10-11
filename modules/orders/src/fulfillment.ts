import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { ApiError, assertUuid } from "../../shared/src/errors";
import { emitOutbox } from "../../shared/src/idempotency";
import type { Actor } from "../../shared/src/auth";
import { getOrder } from "./orders";

const CARE_FLOW = ["AT_FACILITY", "IN_CARE", "QUALITY_CHECK", "READY_FOR_RETURN"] as const;

export async function recordIntake(
  db: Pool, actor: Actor, orderId: string, expectedVersion: number,
  measuredLines: { orderLineId: string; quantity: number; weightGrams?: number }[], bagIds: string[],
) {
  assertUuid(orderId, "orderId");
  if (actor.role !== "operator" && actor.role !== "facility") throw new ApiError("FORBIDDEN", "Ops only", { status: 403 });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const order = (await client.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [orderId])).rows[0];
    if (!order) { await client.query("ROLLBACK"); throw new ApiError("NOT_FOUND", "Order not found", { status: 404 }); }
    if (Number(order.version) !== expectedVersion) { await client.query("ROLLBACK"); throw new ApiError("VERSION_CONFLICT", `Expected version ${expectedVersion} but current is ${order.version}`, { status: 409 }); }
    if (!["PICKUP_PENDING", "AT_FACILITY", "AWAITING_ADJUSTMENT"].includes(order.status as string)) {
      await client.query("ROLLBACK");
      throw new ApiError("INVALID_INPUT", `Intake not allowed in ${order.status}`, { status: 400 });
    }
    const orderLines = order.lines as { orderLineId: string; quantity: number; unitPriceMinor: number }[];
    let delta = 0;
    for (const m of measuredLines) {
      const line = orderLines.find((l) => l.orderLineId === m.orderLineId);
      if (!line) { await client.query("ROLLBACK"); throw new ApiError("INVALID_INPUT", `Unknown order line ${m.orderLineId}`, { status: 400 }); }
      if (m.quantity < 0 || m.quantity > 100) { await client.query("ROLLBACK"); throw new ApiError("INVALID_INPUT", "Measured quantity 0..100", { status: 400 }); }
      delta += (m.quantity - line.quantity) * line.unitPriceMinor;
    }
    if (delta === 0) {
      await client.query(`UPDATE orders SET status = 'AT_FACILITY', version = version + 1, updated_at = now() WHERE id = $1`, [orderId]);
      await client.query(`INSERT INTO order_timeline (order_id, status, label) VALUES ($1,'AT_FACILITY','Facility intake complete: counts match')`, [orderId]);
      await emitOutbox(client, orderId, "order.updated.v1", { orderId, customerVisibleStatus: "AT_FACILITY" });
      await client.query("COMMIT");
      return getOrder(db, { id: order.customer_id as string, role: "customer", scopes: [] }, orderId);
    }
    const adjustmentId = randomUUID();
    await client.query(`UPDATE orders SET status = 'AWAITING_ADJUSTMENT', version = version + 1, updated_at = now(), adjustment = $2 WHERE id = $1`,
      [orderId, JSON.stringify({ id: adjustmentId, status: "PENDING", deltaMinor: delta, reason: `Intake count differs by value ${delta}`, measuredLines, bagIds })]);
    await client.query(`INSERT INTO order_timeline (order_id, status, label) VALUES ($1,'AWAITING_ADJUSTMENT','Intake found a price difference; waiting for approval')`, [orderId]);
    await emitOutbox(client, orderId, "order.updated.v1", { orderId, customerVisibleStatus: "AWAITING_ADJUSTMENT" });
    await client.query("COMMIT");
    return getOrder(db, { id: order.customer_id as string, role: "customer", scopes: [] }, orderId);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* settled */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function decideAdjustment(db: Pool, actor: Actor, orderId: string, adjustmentId: string, decision: "ACCEPT" | "DECLINE", expectedVersion?: number) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const order = (await client.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [orderId])).rows[0];
    if (!order) { await client.query("ROLLBACK"); throw new ApiError("NOT_FOUND", "Order not found", { status: 404 }); }
    if (actor.role === "customer" && order.customer_id !== actor.id) { await client.query("ROLLBACK"); throw new ApiError("NOT_FOUND", "Order not found", { status: 404 }); }
    if (actor.role === "customer" && decision !== "ACCEPT" && decision !== "DECLINE") { await client.query("ROLLBACK"); throw new ApiError("INVALID_INPUT", "Bad decision", { status: 400 }); }
    if (expectedVersion !== undefined && Number(order.version) !== expectedVersion) {
      await client.query("ROLLBACK");
      throw new ApiError("VERSION_CONFLICT", `Expected version ${expectedVersion} but current is ${order.version}`, { status: 409 });
    }
    const adj = order.adjustment as { id: string; status: string; deltaMinor: number } | null;
    if (!adj || adj.id !== adjustmentId || adj.status !== "PENDING") { await client.query("ROLLBACK"); throw new ApiError("INVALID_INPUT", "No pending adjustment", { status: 400 }); }
    if (decision === "DECLINE") {
      await client.query(`UPDATE orders SET status = 'AT_FACILITY', version = version + 1, updated_at = now(), adjustment = $2 WHERE id = $1`,
        [orderId, JSON.stringify({ ...adj, status: "DECLINED" })]);
      await client.query(`INSERT INTO order_timeline (order_id, status, label) VALUES ($1,'AT_FACILITY','Adjustment declined; original terms stand')`, [orderId]);
      await client.query("COMMIT");
      return getOrder(db, { id: order.customer_id as string, role: "customer", scopes: [] }, orderId);
    }
    if (adj.deltaMinor > 0) {
      // Higher price: top-up payment gate before care.
      const topupId = randomUUID();
      const origin = (process.env.API_ORIGIN ?? "http://localhost:4100").replace(/\/$/, "");
      await client.query(
        `INSERT INTO payments (id, order_id, quote_id, purpose, amount_minor, currency, status, provider, payment_url, expires_at)
         VALUES ($1,$2,$3,'TOP_UP',$4,'INR','PENDING','demo',$5,$6)`,
        [topupId, orderId, order.quote_id, adj.deltaMinor, `${origin}/demo/pay/${topupId}`, new Date(Date.now() + 30 * 60_000).toISOString()],
      );
      await client.query(`UPDATE orders SET version = version + 1, updated_at = now(), adjustment = $2 WHERE id = $1`,
        [orderId, JSON.stringify({ ...adj, status: "AWAITING_TOPUP", topupPaymentId: topupId })]);
      await client.query(`INSERT INTO order_timeline (order_id, status, label) VALUES ($1,'AWAITING_ADJUSTMENT','Top-up payment required before care')`, [orderId]);
      await client.query("COMMIT");
      throw new ApiError("REQUIRES_APPROVAL", "Top-up payment required before care", { status: 409 });
    }
    // Lower price: tracked refund obligation, care may proceed.
    await client.query(`INSERT INTO refund_obligations (order_id, amount_minor, reason, status) VALUES ($1,$2,'intake lower than quote','OPEN')`, [orderId, Math.abs(adj.deltaMinor)]);
    await client.query(`UPDATE orders SET status = 'AT_FACILITY', total_minor = total_minor + $2, version = version + 1, updated_at = now(), adjustment = $3 WHERE id = $1`,
      [orderId, adj.deltaMinor, JSON.stringify({ ...adj, status: "REFUND_OBLIGATED" })]);
    await client.query(`INSERT INTO order_timeline (order_id, status, label) VALUES ($1,'AT_FACILITY','Lower intake price; refund tracked')`, [orderId]);
    await emitOutbox(client, orderId, "refund.updated.v1", { orderId, status: "OPEN", amount: Math.abs(adj.deltaMinor) });
    await client.query("COMMIT");
    return getOrder(db, { id: order.customer_id as string, role: "customer", scopes: [] }, orderId);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* settled */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function advanceCare(db: Pool, actor: Actor, orderId: string, expectedVersion: number, to: "IN_CARE" | "QUALITY_CHECK" | "READY_FOR_RETURN") {
  if (actor.role !== "operator" && actor.role !== "facility") throw new ApiError("FORBIDDEN", "Ops only", { status: 403 });
  const order = (await db.query(`SELECT * FROM orders WHERE id = $1`, [orderId])).rows[0];
  if (!order) throw new ApiError("NOT_FOUND", "Order not found", { status: 404 });
  if (Number(order.version) !== expectedVersion) throw new ApiError("VERSION_CONFLICT", `Expected version ${expectedVersion} but current is ${order.version}`, { status: 409 });
  if (order.status === "AWAITING_ADJUSTMENT") throw new ApiError("REQUIRES_APPROVAL", "Resolve the pending adjustment first", { status: 409 });
  const adj = order.adjustment as { status?: string } | null;
  if (adj?.status === "AWAITING_TOPUP") {
    const paid = Number((await db.query(`SELECT COUNT(*)::int AS n FROM payments WHERE order_id = $1 AND purpose = 'TOP_UP' AND status = 'CAPTURED'`, [orderId])).rows[0].n);
    if (paid === 0) throw new ApiError("REQUIRES_APPROVAL", "Top-up must be captured before care", { status: 409 });
  }
  const idx = CARE_FLOW.indexOf(to);
  if (idx < 0) throw new ApiError("INVALID_INPUT", "Unknown care target", { status: 400 });
  const orderIdx = CARE_FLOW.indexOf(order.status as (typeof CARE_FLOW)[number]);
  if (orderIdx < 0 || idx !== orderIdx + 1) throw new ApiError("INVALID_INPUT", `Cannot move ${order.status} to ${to}`, { status: 400 });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE orders SET status = $1, version = version + 1, updated_at = now() WHERE id = $2`, [to, orderId]);
    await client.query(`INSERT INTO order_timeline (order_id, status, label) VALUES ($1,$2,$3)`, [orderId, to, `Care: ${to}`]);
    if (to === "READY_FOR_RETURN") await emitOutbox(client, orderId, "order.ready-for-return.v1", { orderId });
    await emitOutbox(client, orderId, "order.updated.v1", { orderId, customerVisibleStatus: to });
    await client.query("COMMIT");
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* settled */ }
    throw e;
  } finally {
    client.release();
  }
  return getOrder(db, { id: order.customer_id as string, role: "customer", scopes: [] }, orderId);
}

export async function rescheduleOrder(db: Pool, actor: Actor, orderId: string, newQuoteId: string, expectedVersion: number) {
  if (actor.role !== "customer") throw new ApiError("FORBIDDEN", "Only customers", { status: 403 });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const order = (await client.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [orderId])).rows[0];
    if (!order || order.customer_id !== actor.id) { await client.query("ROLLBACK"); throw new ApiError("NOT_FOUND", "Order not found", { status: 404 }); }
    if (Number(order.version) !== expectedVersion) { await client.query("ROLLBACK"); throw new ApiError("VERSION_CONFLICT", "Stale order version", { status: 409 }); }
    if (!["CONFIRMED", "PICKUP_PENDING"].includes(order.status as string)) { await client.query("ROLLBACK"); throw new ApiError("INVALID_INPUT", `Cannot reschedule in ${order.status}`, { status: 400 }); }
    const q = (await client.query(`SELECT * FROM quotes WHERE id = $1`, [newQuoteId])).rows[0];
    if (!q || q.customer_id !== actor.id) { await client.query("ROLLBACK"); throw new ApiError("NOT_FOUND", "Quote not found", { status: 404 }); }
    await client.query(`UPDATE orders SET pickup_window = $1, promised_return = $2, version = version + 1, updated_at = now() WHERE id = $3`,
      [JSON.stringify(q.pickup_window), JSON.stringify(q.promised_return), orderId]);
    await client.query(`UPDATE delivery_jobs SET time_window = $1 WHERE order_id = $2 AND leg = 'PICKUP' AND status <> 'COMPLETED'`, [JSON.stringify(q.pickup_window), orderId]);
    await client.query(`INSERT INTO order_timeline (order_id, status, label) VALUES ($1,$2,'Pickup rescheduled')`, [orderId, order.status]);
    await client.query("COMMIT");
    return getOrder(db, actor, orderId);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* settled */ }
    throw e;
  } finally {
    client.release();
  }
}
