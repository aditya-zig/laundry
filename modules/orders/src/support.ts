import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { ApiError } from "../../shared/src/errors";
import type { Actor } from "../../shared/src/auth";

export async function createSupportIncident(db: Pool, actor: Actor, orderId: string, message: string) {
  const order = (await db.query(`SELECT * FROM orders WHERE id = $1`, [orderId])).rows[0];
  if (!order || (actor.role === "customer" && order.customer_id !== actor.id)) throw new ApiError("NOT_FOUND", "Order not found", { status: 404 });
  const row = (await db.query(
    `INSERT INTO support_incidents (order_id, customer_id, messages) VALUES ($1,$2,$3) RETURNING *`,
    [orderId, order.customer_id, JSON.stringify([{ id: randomUUID(), from: actor.role, text: message, at: new Date().toISOString() }])],
  )).rows[0];
  return { id: row.id as string, status: row.status as string };
}

export async function getSupportIncident(db: Pool, actor: Actor, id: string) {
  const row = (await db.query(`SELECT * FROM support_incidents WHERE id = $1`, [id])).rows[0];
  if (!row) throw new ApiError("NOT_FOUND", "Support incident not found", { status: 404 });
  if (actor.role === "customer" && row.customer_id !== actor.id) throw new ApiError("NOT_FOUND", "Support incident not found", { status: 404 });
  return { id: row.id as string, status: row.status as string, messages: row.messages as unknown[] };
}

export async function postSupportMessage(db: Pool, actor: Actor, id: string, message: string) {
  const row = (await db.query(`SELECT * FROM support_incidents WHERE id = $1`, [id])).rows[0];
  if (!row) throw new ApiError("NOT_FOUND", "Support incident not found", { status: 404 });
  if (actor.role === "customer" && row.customer_id !== actor.id) throw new ApiError("NOT_FOUND", "Support incident not found", { status: 404 });
  const messages = [...(row.messages as unknown[]), { id: randomUUID(), from: actor.role, text: message, at: new Date().toISOString() }];
  await db.query(`UPDATE support_incidents SET messages = $1 WHERE id = $2`, [JSON.stringify(messages), id]);
  return { id, status: row.status as string, messages };
}

export async function submitReview(db: Pool, actor: Actor, input: { orderId: string; overall: number; serviceScore?: number; deliveryScore?: number; comment?: string; mediaIds?: string[]; publishConsent: boolean }) {
  if (actor.role !== "customer") throw new ApiError("FORBIDDEN", "Only customers review", { status: 403 });
  if (input.overall < 1 || input.overall > 5) throw new ApiError("INVALID_INPUT", "overall must be 1..5", { status: 400 });
  const order = (await db.query(`SELECT * FROM orders WHERE id = $1`, [input.orderId])).rows[0];
  if (!order || order.customer_id !== actor.id) throw new ApiError("NOT_FOUND", "Order not found", { status: 404 });
  if (order.status !== "DELIVERED") throw new ApiError("INVALID_INPUT", "Only delivered orders can be reviewed", { status: 400 });
  const dup = (await db.query(`SELECT id FROM reviews WHERE order_id = $1`, [input.orderId])).rows[0];
  if (dup) throw new ApiError("INVALID_INPUT", "One review per order", { status: 400 });
  const row = (await db.query(
    `INSERT INTO reviews (order_id, customer_id, overall, service_score, delivery_score, comment, media_ids, consent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [input.orderId, actor.id, input.overall, input.serviceScore ?? null, input.deliveryScore ?? null,
      input.comment ?? null, JSON.stringify(input.mediaIds ?? []), input.publishConsent],
  )).rows[0];
  return toReview(row);
}

export function toReview(r: Record<string, unknown>) {
  return {
    id: r.id as string, orderId: r.order_id as string, overall: r.overall as number,
    serviceScore: (r.service_score as number) ?? undefined, deliveryScore: (r.delivery_score as number) ?? undefined,
    comment: (r.comment as string) ?? undefined, mediaIds: (r.media_ids ?? []) as string[],
    publishConsent: r.consent as boolean, version: r.version as number,
    createdAt: new Date(r.created_at as string).toISOString(),
  };
}

export async function listServiceReviews(db: Pool, serviceId: string) {
  const rows = (await db.query(
    `SELECT r.* FROM reviews r JOIN orders o ON o.id = r.order_id
     WHERE r.status = 'APPROVED' AND o.lines::text LIKE '%' || $1 || '%' ORDER BY r.created_at DESC LIMIT 50`, [serviceId])).rows;
  return rows.map(toReview);
}

export async function moderateReview(db: Pool, actor: Actor, id: string, approve: boolean) {
  if (actor.role !== "operator" && actor.role !== "admin") throw new ApiError("FORBIDDEN", "Ops only", { status: 403 });
  const row = (await db.query(`UPDATE reviews SET status = $1 WHERE id = $2 RETURNING *`, [approve ? "APPROVED" : "REJECTED", id])).rows[0];
  if (!row) throw new ApiError("NOT_FOUND", "Review not found", { status: 404 });
  return toReview(row);
}
