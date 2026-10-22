import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { ApiError, assertUuid } from "../../shared/src/errors";
import { checkIdempotency, storeIdempotency, emitOutbox } from "../../shared/src/idempotency";
import type { Actor } from "../../shared/src/auth";
import { toJob } from "../../orders/src/orders";

async function orderForJob(db: { query: Pool["query"] }, jobId: string) {
  const job = (await db.query(`SELECT * FROM delivery_jobs WHERE id = $1`, [jobId])).rows[0];
  if (!job) throw new ApiError("NOT_FOUND", "Delivery job not found", { status: 404 });
  const order = (await db.query(`SELECT * FROM orders WHERE id = $1`, [job.order_id])).rows[0];
  return { job, order };
}

export async function listPartnerJobs(db: Pool, actor: Actor) {
  if (actor.role !== "rider") throw new ApiError("FORBIDDEN", "Riders only", { status: 403 });
  const rows = (await db.query(`SELECT * FROM delivery_jobs WHERE assigned_to = $1 OR (assigned_to IS NULL AND status = 'BOOKED') ORDER BY created_at DESC LIMIT 50`, [actor.id])).rows;
  return rows.map(toJob);
}

export async function acceptJob(db: Pool, actor: Actor, jobId: string) {
  assertUuid(jobId, "jobId");
  if (actor.role !== "rider") throw new ApiError("FORBIDDEN", "Riders only", { status: 403 });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const job = (await client.query(`SELECT * FROM delivery_jobs WHERE id = $1 FOR UPDATE`, [jobId])).rows[0];
    if (!job) { await client.query("ROLLBACK"); throw new ApiError("NOT_FOUND", "Delivery job not found", { status: 404 }); }
    if (job.assigned_to && job.assigned_to !== actor.id) { await client.query("ROLLBACK"); throw new ApiError("VERSION_CONFLICT", "Job already assigned", { status: 409 }); }
    if (!["BOOKED", "ASSIGNED"].includes(job.status as string)) { await client.query("ROLLBACK"); throw new ApiError("INVALID_INPUT", `Cannot accept job in ${job.status}`, { status: 400 }); }
    // One active attempt per leg: rider cannot hold two active jobs on the same leg.
    await client.query(`UPDATE delivery_jobs SET assigned_to = $1, status = 'ASSIGNED', version = version + 1, updated_at = now() WHERE id = $2`, [actor.id, jobId]);
    await emitOutbox(client, job.order_id as string, "delivery.updated.v1", { jobId, orderId: job.order_id, leg: job.leg, status: "ASSIGNED" });
    await client.query("COMMIT");
    return toJob((await db.query(`SELECT * FROM delivery_jobs WHERE id = $1`, [jobId])).rows[0]);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* settled */ }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Handover proof. Pickup OTP is customer-visible only; the rider submits it
 * blind. Stale assignment (reassigned job) cannot complete. Pickup completion
 * never marks the order delivered; only a return-leg proof with valid OTP can.
 */
export async function recordHandover(
  db: Pool, actor: Actor, input: { jobId: string; actionId: string; bagIds: string[]; method: "OTP" | "PROVIDER_PROOF" | "OPERATOR_EXCEPTION"; proofReference?: string; otp?: string; capturedAt: string },
  expectedVersion: number,
) {
  if (actor.role !== "rider" && !(actor.role === "operator" && input.method === "OPERATOR_EXCEPTION")) {
    throw new ApiError("FORBIDDEN", "Riders submit handovers; operator exceptions are audited separately", { status: 403 });
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const dup = (await client.query(`SELECT * FROM handover_actions WHERE action_id = $1`, [input.actionId])).rows[0];
    if (dup) {
      const job = (await client.query(`SELECT * FROM delivery_jobs WHERE id = $1`, [input.jobId])).rows[0];
      await client.query("COMMIT");
      return toJob(job);
    }
    const { job, order } = await orderForJob(client, input.jobId);
    if (!job) { await client.query("ROLLBACK"); throw new ApiError("NOT_FOUND", "Delivery job not found", { status: 404 }); }
    if (actor.role === "rider" && job.assigned_to !== actor.id) { await client.query("ROLLBACK"); throw new ApiError("FORBIDDEN", "Stale assignment: job is not yours", { status: 403 }); }
    if (Number(job.version) !== expectedVersion) { await client.query("ROLLBACK"); throw new ApiError("VERSION_CONFLICT", `Expected version ${expectedVersion} but current is ${job.version}`, { status: 409 }); }
    if (job.status === "COMPLETED") { await client.query("ROLLBACK"); throw new ApiError("INVALID_INPUT", "Job already completed", { status: 400 }); }
    if (input.method === "OTP") {
      const want = job.leg === "PICKUP" ? (order.pickup_otp as string) : (order.return_otp as string);
      if (!input.otp || input.otp !== want) {
        await client.query("ROLLBACK");
        throw new ApiError("INVALID_INPUT", "Handover proof failed: wrong OTP", { status: 400 });
      }
    } else if (input.method === "PROVIDER_PROOF") {
      if (!input.proofReference) { await client.query("ROLLBACK"); throw new ApiError("INVALID_INPUT", "proofReference required", { status: 400 }); }
    } else {
      if (actor.role !== "operator") { await client.query("ROLLBACK"); throw new ApiError("FORBIDDEN", "Operator exception needs an operator", { status: 403 }); }
    }
    await client.query(`INSERT INTO handover_actions (action_id, job_id, method, proof_ref) VALUES ($1,$2,$3,$4)`,
      [input.actionId, input.jobId, input.method, input.proofReference ?? input.otp ?? null]);
    await client.query(`UPDATE delivery_jobs SET status = 'COMPLETED', bag_ids = $1, version = version + 1, updated_at = now() WHERE id = $2`,
      [JSON.stringify(input.bagIds), input.jobId]);
    await emitOutbox(client, job.order_id as string, "delivery.updated.v1",
      { jobId: input.jobId, orderId: job.order_id, leg: job.leg, status: "COMPLETED", proofReference: input.proofReference });
    if (job.leg === "RETURN") {
      await client.query(`UPDATE orders SET status = 'DELIVERED', version = version + 1, updated_at = now() WHERE id = $1`, [job.order_id]);
      await client.query(`INSERT INTO order_timeline (order_id, status, label) VALUES ($1,'DELIVERED','Return handover complete')`, [job.order_id]);
      await emitOutbox(client, job.order_id as string, "order.delivered.v1", { orderId: job.order_id, deliveredAt: new Date().toISOString() });
    }
    // Pickup completion intentionally leaves the order alone: facility intake
    // (recordIntake) is what moves it to AT_FACILITY.
    await client.query("COMMIT");
    return toJob((await db.query(`SELECT * FROM delivery_jobs WHERE id = $1`, [input.jobId])).rows[0]);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* settled */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function reportException(db: Pool, actor: Actor, jobId: string, reason: string) {
  if (actor.role !== "rider") throw new ApiError("FORBIDDEN", "Riders only", { status: 403 });
  const job = (await db.query(`SELECT * FROM delivery_jobs WHERE id = $1`, [jobId])).rows[0];
  if (!job || job.assigned_to !== actor.id) throw new ApiError("NOT_FOUND", "Delivery job not found", { status: 404 });
  const updated = (await db.query(`UPDATE delivery_jobs SET status = 'FAILED', version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`, [jobId])).rows[0];
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await emitOutbox(client, job.order_id as string, "delivery.updated.v1", { jobId, orderId: job.order_id, leg: job.leg, status: "FAILED", reason });
    await client.query("COMMIT");
  } finally { client.release(); }
  return toJob(updated);
}

export async function opsDispatch(
  db: Pool, actor: Actor, jobId: string,
  input: { assignedTo: string; expectedVersion: number; idempotencyKey?: string },
) {
  if (actor.role !== "operator" && actor.role !== "admin") throw new ApiError("FORBIDDEN", "Ops only", { status: 403 });
  assertUuid(jobId, "jobId");
  assertUuid(input.assignedTo, "assignedTo");
  const tx = await db.connect();
  try {
    await tx.query("BEGIN");
    if (input.idempotencyKey) {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`delivery-dispatch:${input.idempotencyKey}`]);
    }
    const job = (await tx.query("SELECT * FROM delivery_jobs WHERE id = $1 FOR UPDATE", [jobId])).rows[0];
    if (!job) throw new ApiError("NOT_FOUND", "Delivery job not found", { status: 404 });
    const payload = { jobId, assignedTo: input.assignedTo, expectedVersion: input.expectedVersion };
    const replay = await checkIdempotency(tx, "delivery-dispatch", input.idempotencyKey, actor.id, payload);
    if (replay.replay) {
      await tx.query("COMMIT");
      return replay.response as ReturnType<typeof toJob>;
    }
    if (Number(job.version) !== input.expectedVersion) throw new ApiError("VERSION_CONFLICT", "Dispatch version is stale", { status: 409 });
    if (!["REQUESTED", "BOOKED", "ASSIGNED"].includes(job.status) || job.dispatch_mode !== "MANUAL") {
      throw new ApiError("INVALID_INPUT", "This delivery cannot be assigned by manual dispatch", { status: 409 });
    }
    const rider = (await tx.query("SELECT id FROM users WHERE id = $1 AND role = 'rider' FOR SHARE", [input.assignedTo])).rows[0];
    if (!rider) throw new ApiError("INVALID_INPUT", "Assignment requires a provisioned rider", { status: 400 });
    const updated = (await tx.query(
      "UPDATE delivery_jobs SET assigned_to = $1, status = 'ASSIGNED', version = version + 1, updated_at = now() WHERE id = $2 RETURNING *",
      [input.assignedTo, jobId],
    )).rows[0];
    const result = toJob(updated);
    await tx.query(
      `INSERT INTO v2_audit (actor_id, actor_role, aggregate_id, action, reason, before_value, after_value, trace_id)
       VALUES ($1, $2, $3, 'delivery.assigned.v1', $4, $5, $6, $7)`,
      [actor.id, actor.role, jobId, "Operator assigned a provisioned rider", JSON.stringify(toJob(job)), JSON.stringify(result), randomUUID()],
    );
    await emitOutbox(tx, job.order_id, "delivery.updated.v1", { jobId, orderId: job.order_id, leg: job.leg, status: "ASSIGNED" });
    await storeIdempotency(tx, "delivery-dispatch", input.idempotencyKey, actor.id, payload, result);
    await tx.query("COMMIT");
    return result;
  } catch (error) {
    try { await tx.query("ROLLBACK"); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally {
    tx.release();
  }
}

export async function opsCancelDelivery(db: Pool, actor: Actor, jobId: string, reason: string) {
  if (actor.role !== "operator" && actor.role !== "admin") throw new ApiError("FORBIDDEN", "Ops only", { status: 403 });
  void reason;
  const updated = (await db.query(`UPDATE delivery_jobs SET status = 'CANCELLED', version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`, [jobId])).rows[0];
  if (!updated) throw new ApiError("NOT_FOUND", "Delivery job not found", { status: 404 });
  return toJob(updated);
}

export async function applyDeliveryEvent(db: Pool, eventId: string, evt: { jobId: string; status: string }) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const seen = (await client.query(`SELECT event_id FROM inbox WHERE event_id = $1`, [eventId])).rows[0];
    if (seen) { await client.query("COMMIT"); return { duplicate: true }; }
    await client.query(`UPDATE delivery_jobs SET status = $1, version = version + 1 WHERE id = $2`, [evt.status, evt.jobId]);
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
