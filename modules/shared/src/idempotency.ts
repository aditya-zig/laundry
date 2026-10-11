import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ApiError } from "./errors";

export function hashRequest(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex");
}

/** Idempotency replay inside the caller's transaction. Returns stored response when replaying. */
export async function checkIdempotency(
  tx: Pool | PoolClient,
  scope: string,
  key: string | undefined,
  actorId: string,
  payload: unknown,
): Promise<{ replay: boolean; response?: unknown }> {
  if (!key) return { replay: false };
  const existing = (await tx.query(`SELECT actor_id, request_hash, response FROM idempotency_records WHERE scope = $1 AND key = $2`, [scope, key])).rows[0];
  if (!existing) return { replay: false };
  if (existing.actor_id !== actorId) throw new ApiError("IDEMPOTENCY_CONFLICT", "Idempotency key already used by another actor", { status: 409 });
  if (existing.request_hash !== hashRequest(payload)) {
    throw new ApiError("IDEMPOTENCY_CONFLICT", "Idempotency key reused with a different payload", { status: 409 });
  }
  return { replay: true, response: existing.response };
}

export async function storeIdempotency(
  tx: Pool | PoolClient,
  scope: string,
  key: string | undefined,
  actorId: string,
  payload: unknown,
  response: unknown,
): Promise<void> {
  if (!key) return;
  await tx.query(
    `INSERT INTO idempotency_records (scope, key, actor_id, request_hash, response) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [scope, key, actorId, hashRequest(payload), JSON.stringify(response)],
  );
}

export async function emitOutbox(
  tx: Pool | PoolClient,
  aggregateId: string,
  eventType: string,
  payload: unknown,
): Promise<void> {
  await tx.query(`INSERT INTO outbox (aggregate_id, event_type, payload) VALUES ($1,$2,$3)`, [aggregateId, eventType, JSON.stringify(payload ?? {})]);
}

export function sixDigitOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
