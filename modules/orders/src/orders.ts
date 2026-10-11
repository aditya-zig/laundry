import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { ApiError, assertUuid } from "../../shared/src/errors";
import { checkIdempotency, storeIdempotency, emitOutbox, sixDigitOtp } from "../../shared/src/idempotency";
import type { Actor } from "../../shared/src/auth";

export function toOrderView(
  order: Record<string, unknown>,
  timeline: { status: string; label: string; at: string }[],
  deliveries: unknown[],
  opts?: { revealPickupOtp?: boolean; revealReturnOtp?: boolean },
) {
  const lines = (order.lines as { orderLineId?: string }[]).map((l) => ({
    ...l, orderLineId: (l.orderLineId ?? randomUUID()) as string,
  }));
  const view: Record<string, unknown> = {
    id: order.id as string, version: order.version as number, status: order.status as string,
    customerId: order.customer_id as string,
    ...(order.facility_id ? { facilityId: order.facility_id as string } : {}),
    lines, totalMinor: order.total_minor as number, currency: "INR",
    pickupWindow: order.pickup_window, promisedReturnWindow: order.promised_return,
    createdAt: new Date(order.created_at as string).toISOString(),
    timeline, paymentStatus: order.payment_status as string,
    ...(order.adjustment ? { adjustment: order.adjustment } : {}),
    deliveries,
  };
  if (opts?.revealPickupOtp && order.pickup_otp) view.pickupOtp = order.pickup_otp;
  if (opts?.revealReturnOtp && order.return_otp) view.returnOtp = order.return_otp;
  return view;
}

async function timelineFor(db: { query: Pool["query"] }, orderId: string) {
  const rows = (await db.query(`SELECT status, label, at FROM order_timeline WHERE order_id = $1 ORDER BY id`, [orderId])).rows;
  return rows.map((r: Record<string, unknown>) => ({ status: r.status as string, label: r.label as string, at: new Date(r.at as string).toISOString() }));
}

async function jobsFor(db: { query: Pool["query"] }, orderId: string) {
  const rows = (await db.query(`SELECT * FROM delivery_jobs WHERE order_id = $1 ORDER BY leg, attempt`, [orderId])).rows;
  return rows.map(toJob);
}

export function toJob(j: Record<string, unknown>) {
  const job = j as Record<string, string | number | unknown>;
  return {
    id: job.id as string, orderId: job.order_id as string, leg: job.leg as "PICKUP" | "RETURN",
    status: job.status as string, version: job.version as number,
    customerName: job.customer_name as string, address: job.address as string,
    window: (job.time_window ?? job.window) as { start: string; end: string; timezone: string },
    bagIds: (job.bag_ids ?? []) as string[], provider: job.provider as string,
    dispatchMode: job.dispatch_mode as "PROVIDER" | "MANUAL",
    capabilities: (job.capabilities ?? ["OTP_HANDOVER"]) as string[],
    ...(job.assigned_to ? { assignedTo: job.assigned_to as string } : {}),
  };
}

function apiOrigin(): string {
  return (process.env.API_ORIGIN ?? "http://localhost:4100").replace(/\/$/, "");
}

export async function createCheckout(db: Pool, actor: Actor, quoteId: string, expectedVersion: number | undefined, meta: { idempotencyKey?: string }) {
  if (actor.role !== "customer") throw new ApiError("FORBIDDEN", "Only customers can checkout", { status: 403 });
  assertUuid(quoteId, "quoteId");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const payload = { quoteId, expectedVersion: expectedVersion ?? null };
    const replay = await checkIdempotency(client, "checkouts", meta.idempotencyKey, actor.id, payload);
    if (replay.replay) { await client.query("COMMIT"); return replay.response as never; }

    const q = (await client.query(`SELECT * FROM quotes WHERE id = $1 FOR UPDATE`, [quoteId])).rows[0];
    if (!q || q.customer_id !== actor.id) { await client.query("ROLLBACK"); throw new ApiError("NOT_FOUND", "Quote not found", { status: 404 }); }
    if (expectedVersion !== undefined && Number(q.version) !== expectedVersion) {
      await client.query("ROLLBACK");
      throw new ApiError("VERSION_CONFLICT", `Expected version ${expectedVersion} but current is ${q.version}`, { status: 409 });
    }
    if (new Date(q.expires_at).getTime() < Date.now()) { await client.query("ROLLBACK"); throw new ApiError("QUOTE_EXPIRED", "Quote expired; request a fresh quote", { status: 410 }); }
    const existing = (await client.query(`SELECT * FROM orders WHERE quote_id = $1`, [quoteId])).rows[0];
    if (existing) {
      const pay = (await client.query(`SELECT * FROM payments WHERE order_id = $1 AND purpose = 'INITIAL' ORDER BY created_at DESC LIMIT 1`, [existing.id])).rows[0];
      const checkout = toCheckout(existing, pay);
      await storeIdempotency(client, "checkouts", meta.idempotencyKey, actor.id, payload, checkout);
      await client.query("COMMIT");
      return checkout;
    }
    const hold = q.hold_id ? (await client.query(`SELECT * FROM capacity_holds WHERE id = $1`, [q.hold_id])).rows[0] : null;
    if (!hold || hold.released || new Date(hold.expires_at).getTime() < Date.now()) {
      await client.query("ROLLBACK");
      throw new ApiError("QUOTE_EXPIRED", "Capacity hold expired; request a fresh quote", { status: 410 });
    }
    const addr = (await client.query(`SELECT * FROM addresses WHERE id = $1`, [q.address_id])).rows[0];
    const orderId = randomUUID();
    const lines = (q.lines as { orderLineId?: string }[]).map((l) => ({ ...l, orderLineId: randomUUID() }));
    await client.query(
      `INSERT INTO orders (id, version, customer_id, quote_id, status, lines, total_minor, currency, pickup_window, promised_return, address_snapshot, payment_status, pickup_otp, return_otp)
       VALUES ($1,1,$2,$3,'AWAITING_PAYMENT',$4,$5,'INR',$6,$7,$8,'CREATED',$9,$10)`,
      [orderId, actor.id, quoteId, JSON.stringify(lines), q.total_minor, JSON.stringify(q.pickup_window),
        JSON.stringify(q.promised_return),
        JSON.stringify(addr ? { line1: addr.line1, city: addr.city, postalCode: addr.postal_code, label: addr.label } : {}),
        sixDigitOtp(), sixDigitOtp()],
    );
    await client.query(`INSERT INTO order_timeline (order_id, status, label) VALUES ($1,'AWAITING_PAYMENT','Checkout created')`, [orderId]);
    const paymentId = randomUUID();
    const paymentUrl = `${apiOrigin()}/demo/pay/${paymentId}`;
    const payExpiry = new Date(Date.now() + 30 * 60_000).toISOString();
    await client.query(
      `INSERT INTO payments (id, order_id, quote_id, purpose, amount_minor, currency, status, provider, payment_url, expires_at)
       VALUES ($1,$2,$3,'INITIAL',$4,'INR','PENDING','demo',$5,$6)`,
      [paymentId, orderId, quoteId, q.total_minor, paymentUrl, payExpiry],
    );
    await emitOutbox(client, orderId, "checkout.created.v1", { orderId, quoteId, paymentId });
    const checkout = { orderId, paymentId, paymentUrl, expiresAt: payExpiry, status: "AWAITING_PAYMENT" as const };
    await storeIdempotency(client, "checkouts", meta.idempotencyKey, actor.id, payload, checkout);
    await client.query("COMMIT");
    return checkout;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* settled */ }
    throw e;
  } finally {
    client.release();
  }
}

function toCheckout(order: Record<string, unknown>, pay: Record<string, unknown> | undefined) {
  if (!pay) throw new ApiError("PROVIDER_OUTCOME_UNKNOWN", "Payment record missing", { status: 502 });
  return {
    orderId: order.id as string, paymentId: pay.id as string,
    paymentUrl: pay.payment_url as string,
    expiresAt: new Date(pay.expires_at as string).toISOString(),
    status: "AWAITING_PAYMENT" as const,
  };
}

/** Demo capture. In real mode this route refuses; Razorpay webhook owns capture. */
export async function capturePayment(db: Pool, actor: Actor, paymentId: string, meta: { idempotencyKey?: string }) {
  assertUuid(paymentId, "paymentId");
  const { demoMode } = await import("../../shared/src/auth");
  if (!demoMode()) throw new ApiError("FORBIDDEN", "Demo capture disabled in real mode", { status: 403 });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const replay = await checkIdempotency(client, "capture", meta.idempotencyKey ?? `capture:${paymentId}`, actor.id, { paymentId });
    if (replay.replay) { await client.query("COMMIT"); return replay.response as never; }
    const pay = (await client.query(`SELECT * FROM payments WHERE id = $1 FOR UPDATE`, [paymentId])).rows[0];
    if (!pay) { await client.query("ROLLBACK"); throw new ApiError("NOT_FOUND", "Payment not found", { status: 404 }); }
    if (pay.status === "CAPTURED") {
      const order = (await client.query(`SELECT * FROM orders WHERE id = $1`, [pay.order_id])).rows[0];
      const view = toOrderView(order, await timelineFor(client, order.id as string), await jobsFor(client, order.id as string), { revealPickupOtp: true });
      await storeIdempotency(client, "capture", meta.idempotencyKey ?? `capture:${paymentId}`, actor.id, { paymentId }, view);
      await client.query("COMMIT");
      return view;
    }
    if (pay.status !== "PENDING") { await client.query("ROLLBACK"); throw new ApiError("PAYMENT_PENDING", `Payment is ${pay.status}`, { status: 409 }); }
    const order = (await client.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [pay.order_id])).rows[0];
    if (!order) { await client.query("ROLLBACK"); throw new ApiError("NOT_FOUND", "Order not found", { status: 404 }); }
    if (order.customer_id !== actor.id && actor.role !== "operator") { await client.query("ROLLBACK"); throw new ApiError("NOT_FOUND", "Order not found", { status: 404 }); }
    // Late capture on a cancelled order creates a refund obligation instead of confirming.
    if (order.status === "CANCELLED" || order.status === "CANCEL_REQUESTED") {
      await client.query(`UPDATE payments SET status = 'CAPTURED', updated_at = now() WHERE id = $1`, [paymentId]);
      const ob = (await client.query(
        `INSERT INTO refund_obligations (order_id, amount_minor, reason, status) VALUES ($1,$2,'late capture on cancelled order','OPEN') RETURNING *`,
        [order.id, pay.amount_minor])).rows[0];
      await emitOutbox(client, order.id as string, "refund.updated.v1", { refundId: null, obligationId: ob.id, orderId: order.id, status: "OPEN", amount: pay.amount_minor });
      const view = toOrderView(order, await timelineFor(client, order.id as string), await jobsFor(client, order.id as string));
      await storeIdempotency(client, "capture", meta.idempotencyKey ?? `capture:${paymentId}`, actor.id, { paymentId }, view);
      await client.query("COMMIT");
      return view;
    }
    await client.query(`UPDATE payments SET status = 'CAPTURED', updated_at = now() WHERE id = $1`, [paymentId]);
    if (pay.purpose === "TOP_UP") {
      // Top-up settles a pending adjustment; order state and legs stay put.
      const adj = (order.adjustment ?? {}) as Record<string, unknown>;
      await client.query(`UPDATE orders SET status = 'AT_FACILITY', total_minor = total_minor + $1, version = version + 1, updated_at = now(), adjustment = $2 WHERE id = $3`,
        [pay.amount_minor, JSON.stringify({ ...adj, status: "TOPUP_PAID", topupPaymentId: paymentId }), order.id]);
      await client.query(`INSERT INTO order_timeline (order_id, status, label) VALUES ($1,'AT_FACILITY','Top-up captured; intake resolved, care may proceed')`, [order.id]);
      await emitOutbox(client, order.id as string, "payment.captured.v1", { paymentId, orderId: order.id, quoteId: pay.quote_id, purpose: pay.purpose, amount: pay.amount_minor });
      const topped = (await client.query(`SELECT * FROM orders WHERE id = $1`, [order.id])).rows[0];
      const topView = toOrderView(topped, await timelineFor(client, topped.id as string), await jobsFor(client, topped.id as string));
      await storeIdempotency(client, "capture", meta.idempotencyKey ?? `capture:${paymentId}`, actor.id, { paymentId }, topView);
      await client.query("COMMIT");
      return topView;
    }
    const nextStatus = "CONFIRMED";
    await client.query(`UPDATE orders SET status = $1, payment_status = 'CAPTURED', version = version + 1, updated_at = now() WHERE id = $2`, [nextStatus, order.id]);
    await client.query(`INSERT INTO order_timeline (order_id, status, label) VALUES ($1,'CONFIRMED','Payment captured')`, [order.id]);
    await emitOutbox(client, order.id as string, "payment.captured.v1", { paymentId, orderId: order.id, quoteId: pay.quote_id, purpose: pay.purpose, amount: pay.amount_minor });
    await emitOutbox(client, order.id as string, "order.confirmed.v1", { orderId: order.id });
    // Schedule pickup + return legs in the same transaction.
    const snap = order.address_snapshot as { line1?: string; city?: string; postalCode?: string };
    const addressText = [snap?.line1, snap?.city, snap?.postalCode].filter(Boolean).join(", ");
    const cust = (await client.query(`SELECT name FROM users WHERE id = $1`, [order.customer_id])).rows[0];
    const existingJobs = Number((await client.query(`SELECT COUNT(*)::int AS n FROM delivery_jobs WHERE order_id = $1`, [order.id])).rows[0].n);
    if (existingJobs === 0) {
      await client.query(
        `INSERT INTO delivery_jobs (order_id, leg, status, provider, dispatch_mode, time_window, address, customer_name)
         VALUES ($1,'PICKUP','BOOKED','manual','MANUAL',$2,$3,$4), ($1,'RETURN','BOOKED','manual','MANUAL',$5,$3,$4)`,
        [order.id, JSON.stringify(order.pickup_window), addressText || "demo address", cust?.name ?? "Demo Customer", JSON.stringify(order.promised_return)],
      );
    }
    await client.query(`UPDATE orders SET status = 'PICKUP_PENDING', version = version + 1, updated_at = now() WHERE id = $1`, [order.id]);
    await client.query(`INSERT INTO order_timeline (order_id, status, label) VALUES ($1,'PICKUP_PENDING','Pickup scheduled')`, [order.id]);
    const updated = (await client.query(`SELECT * FROM orders WHERE id = $1`, [order.id])).rows[0];
    const view = toOrderView(updated, await timelineFor(client, updated.id as string), await jobsFor(client, updated.id as string), { revealPickupOtp: updated.customer_id === actor.id || actor.role === "operator" });
    await storeIdempotency(client, "capture", meta.idempotencyKey ?? `capture:${paymentId}`, actor.id, { paymentId }, view);
    await client.query("COMMIT");
    return view;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* settled */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function getOrder(db: Pool, actor: Actor, orderId: string) {
  assertUuid(orderId, "orderId");
  const order = (await db.query(`SELECT * FROM orders WHERE id = $1`, [orderId])).rows[0];
  if (!order) throw new ApiError("NOT_FOUND", "Order not found", { status: 404 });
  if (actor.role === "customer" && order.customer_id !== actor.id) throw new ApiError("NOT_FOUND", "Order not found", { status: 404 });
  if (actor.role === "rider") {
    const mine = Number((await db.query(`SELECT COUNT(*)::int AS n FROM delivery_jobs WHERE order_id = $1 AND assigned_to = $2`, [orderId, actor.id])).rows[0].n);
    if (mine === 0) throw new ApiError("NOT_FOUND", "Order not found", { status: 404 });
  }
  const timeline = await timelineFor(db, orderId);
  const jobs = await jobsFor(db, orderId);
  const isCustomer = actor.role === "customer" && order.customer_id === actor.id;
  const revealReturn = isCustomer && ["READY_FOR_RETURN", "RETURNING", "DELIVERED"].includes(order.status as string);
  const scrubbedJobs = actor.role === "rider" ? jobs : jobs;
  return toOrderView(order, timeline, scrubbedJobs, {
    revealPickupOtp: isCustomer || actor.role === "operator",
    revealReturnOtp: revealReturn || actor.role === "operator",
  });
}

export async function listOrders(db: Pool, actor: Actor) {
  const rows = actor.role === "customer"
    ? (await db.query(`SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 50`, [actor.id])).rows
    : (await db.query(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 50`)).rows;
  const out = [];
  for (const o of rows) {
    out.push(toOrderView(o, await timelineFor(db, o.id as string), await jobsFor(db, o.id as string)));
  }
  return out;
}

export async function cancelOrder(db: Pool, actor: Actor, orderId: string, reason: string, expectedVersion: number) {
  assertUuid(orderId, "orderId");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const order = (await client.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [orderId])).rows[0];
    if (!order || (actor.role === "customer" && order.customer_id !== actor.id)) { await client.query("ROLLBACK"); throw new ApiError("NOT_FOUND", "Order not found", { status: 404 }); }
    if (Number(order.version) !== expectedVersion) { await client.query("ROLLBACK"); throw new ApiError("VERSION_CONFLICT", `Expected version ${expectedVersion} but current is ${order.version}`, { status: 409 }); }
    if (["IN_CARE", "QUALITY_CHECK", "READY_FOR_RETURN", "RETURNING", "DELIVERED", "CANCELLED"].includes(order.status as string)) {
      await client.query("ROLLBACK");
      throw new ApiError("INVALID_INPUT", `Cannot cancel order in ${order.status}`, { status: 400 });
    }
    await client.query(`UPDATE orders SET status = 'CANCEL_REQUESTED', version = version + 1, updated_at = now() WHERE id = $1`, [orderId]);
    await client.query(`UPDATE delivery_jobs SET status = 'CANCEL_REQUESTED', version = version + 1 WHERE order_id = $1 AND status NOT IN ('COMPLETED','CANCELLED')`, [orderId]);
    await client.query(`UPDATE delivery_jobs SET status = 'CANCELLED', version = version + 1 WHERE order_id = $1 AND status = 'CANCEL_REQUESTED'`, [orderId]);
    const captured = (await client.query(`SELECT COALESCE(SUM(amount_minor),0)::int AS s FROM payments WHERE order_id = $1 AND status = 'CAPTURED'`, [orderId])).rows[0].s as number;
    if (captured > 0) {
      await client.query(`INSERT INTO refund_obligations (order_id, amount_minor, reason, status) VALUES ($1,$2,$3,'OPEN')`, [orderId, captured, reason || "order cancelled"]);
    }
    await client.query(`UPDATE orders SET status = 'CANCELLED', version = version + 1, updated_at = now() WHERE id = $1`, [orderId]);
    await client.query(`INSERT INTO order_timeline (order_id, status, label) VALUES ($1,'CANCEL_REQUESTED','Cancel requested: ' || $2), ($1,'CANCELLED','Order cancelled')`, [orderId, reason || "cancelled"]);
    await emitOutbox(client, orderId, "order.updated.v1", { orderId, customerVisibleStatus: "CANCELLED" });
    await client.query("COMMIT");
    return getOrder(db, actor.role === "customer" ? actor : { id: order.customer_id as string, role: "customer", scopes: [] }, orderId);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* settled */ }
    throw e;
  } finally {
    client.release();
  }
}
