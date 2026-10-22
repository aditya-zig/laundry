import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { v2 } from "@laundry/contracts";
import { ApiError } from "./errors";

/** Stable JSON hashing treats object-key order as irrelevant, array order as intent.
 * Refuse lossy JSON values instead of silently hashing NaN/undefined as null. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(Reflect.get(value, key))}`).join(",")}}`;
  }
  throw new ApiError("INVALID_INPUT", "Command payload must be lossless JSON");
}
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const nonempty = (value: string, field: string) => {
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw new ApiError("INVALID_INPUT", `${field} must be nonempty and at most 200 characters`);
};

export function createPostgresCommandExecutor(pool: Pool): v2.CommandExecutor<PoolClient> {
  async function transact<T>(run: (tx: PoolClient) => Promise<T>): Promise<T> {
    const tx = await pool.connect();
    let poisoned = false;
    try {
      await tx.query("BEGIN");
      const result = await run(tx);
      await tx.query("COMMIT");
      return result;
    } catch (error) {
      try { await tx.query("ROLLBACK"); } catch { poisoned = true; }
      throw error;
    } finally { tx.release(poisoned); }
  }

  async function scope(tx: PoolClient, actor: { id: string; role: string }, traceId: string): Promise<v2.TransactionScope<PoolClient>> {
    const now = (await tx.query<{ now: Date }>("SELECT transaction_timestamp() AS now")).rows[0].now.toISOString();
    return {
      handle: tx,
      now,
      async audit(input) {
        v2.idSchema.parse(input.aggregateId);
        nonempty(input.action, "Audit action");
        if (!input.reason?.trim()) throw new ApiError("INVALID_INPUT", "Audit reason is required");
        await tx.query(`INSERT INTO v2_audit (actor_id, actor_role, aggregate_id, action, reason, before_value, after_value, trace_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [actor.id, actor.role, input.aggregateId, input.action, input.reason, canonicalJson(input.before), canonicalJson(input.after), traceId]);
      },
      async publish(input) {
        const event = v2.domainEventSchema.parse(input);
        if (event.traceId !== traceId) throw new ApiError("INVALID_INPUT", "Event trace must match the transaction trace");
        await tx.query(`INSERT INTO v2_outbox (event_id, aggregate_id, aggregate_version, event_type, envelope)
          VALUES ($1,$2,$3,$4,$5)`, [event.eventId, event.aggregateId, event.aggregateVersion, event.eventType, canonicalJson(event)]);
      },
    };
  }

  return {
    async execute(identity, authorize, work) {
      const actor = v2.actorSchema.parse(identity.actor);
      const traceId = v2.idSchema.parse(identity.traceId);
      const key = v2.idempotencyKeySchema.parse(identity.idempotencyKey);
      nonempty(identity.operation, "Operation");
      const requestHash = hash({ operation: identity.operation, payload: identity.payload });
      return transact(async tx => {
        // A transaction-scoped lock serializes first writers too. Row locks alone
        // cannot lock the as-yet nonexistent idempotency result.
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([actor.id, key])]);
        await authorize(tx);
        const existing = (await tx.query<{ request_hash: string; response: v2.JsonValue }>(
          "SELECT request_hash, response FROM v2_command_results WHERE actor_id = $1 AND idempotency_key = $2", [actor.id, key],
        )).rows[0];
        if (existing) {
          if (existing.request_hash !== requestHash) throw new ApiError("IDEMPOTENCY_CONFLICT", "Idempotency key reused with different intent", { status: 409, traceId });
          return existing.response as Awaited<ReturnType<typeof work>>;
        }
        const result = await work(await scope(tx, actor, traceId));
        const response = canonicalJson(result);
        await tx.query(`INSERT INTO v2_command_results (actor_id, idempotency_key, operation, request_hash, response, trace_id)
          VALUES ($1,$2,$3,$4,$5,$6)`, [actor.id, key, identity.operation, requestHash, response, traceId]);
        return result;
      });
    },
    async consume(consumer, identity, input, work) {
      nonempty(consumer, "Consumer");
      const actor = v2.systemActorSchema.parse(identity);
      if (!actor.consumerScopes.includes(consumer)) throw new ApiError("FORBIDDEN", "System actor is not scoped to this consumer");
      const event = v2.domainEventSchema.parse(input);
      const eventHash = hash(event);
      return transact(async tx => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson(["inbox", consumer, event.eventId])]);
        const existing = (await tx.query<{ event_hash: string }>("SELECT event_hash FROM v2_inbox WHERE consumer = $1 AND event_id = $2", [consumer, event.eventId])).rows[0];
        if (existing) {
          if (existing.event_hash !== eventHash) throw new ApiError("IDEMPOTENCY_CONFLICT", "Event identity reused with different content", { traceId: event.traceId });
          return false;
        }
        await work(await scope(tx, actor, event.traceId));
        await tx.query("INSERT INTO v2_inbox (consumer, event_id, event_hash) VALUES ($1,$2,$3)", [consumer, event.eventId, eventHash]);
        return true;
      });
    },
  };
}
