import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { v2 } from "@laundry/contracts";
import { createPostgresCommandExecutor } from "../../../modules/shared/src/command-executor";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
const executor = createPostgresCommandExecutor(pool);
const authorizeSynthetic = async () => { /* No business resource in these transaction-only tests. */ };
const actor: v2.Actor = { id: randomUUID(), role: "CUSTOMER", facilityIds: [], scope: { facilityIds: [] } };
const systemActor: v2.SystemActor = { id: randomUUID(), role: "SYSTEM", consumerScopes: ["executor-test"] };
const identity = (key = randomUUID()): v2.CommandIdentity => ({ actor, operation: "test.book", idempotencyKey: key, payload: { quoteId: "synthetic-quote" }, traceId: randomUUID() });
const confirmation = (): v2.DomainEvent => ({
  eventId: randomUUID(), eventType: "conversation.draft-confirmed.v2", schemaVersion: 2,
  aggregateId: "11111111-1111-4111-8111-111111111111", aggregateVersion: 1,
  occurredAt: "2026-10-22T05:00:00.000Z", traceId: randomUUID(),
  payload: { confirmation: { draftId: "11111111-1111-4111-8111-111111111111", revision: 2, quoteId: "22222222-2222-4222-8222-222222222222", quoteVersion: 1 }, confirmedAt: "2026-10-22T05:00:00.000Z" },
});

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.includes("verify")) throw new Error("V2 executor tests require an explicit isolated local verification database");
  await pool.query(await readFile(new URL("../../../modules/schema/migrations/006_v2_transactions.sql", import.meta.url), "utf8"));
  await pool.query("CREATE TABLE IF NOT EXISTS v2_executor_test_effects (id UUID PRIMARY KEY, intent TEXT NOT NULL)");
});
afterAll(async () => { await pool.end(); });

describe("PostgreSQL v2 command execution", () => {
  it("runs concurrent identical command keys once and returns the original response after reconnect", async () => {
    const command = identity();
    let effects = 0;
    const work = async (scope: v2.TransactionScope<pg.PoolClient>) => {
      effects++;
      const id = randomUUID();
      await scope.handle.query("INSERT INTO v2_executor_test_effects VALUES ($1,$2)", [id, command.idempotencyKey]);
      await new Promise(resolve => setTimeout(resolve, 20));
      return { orderId: id, amountMinor: 15000 };
    };
    const responses = await Promise.all(Array.from({ length: 8 }, () => executor.execute(command, authorizeSynthetic, work)));
    expect(effects).toBe(1);
    for (const response of responses) expect(response).toEqual(responses[0]);
    const otherPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const replay = await createPostgresCommandExecutor(otherPool).execute(command, authorizeSynthetic, async () => { throw new Error("Must not rerun"); });
      expect(replay).toEqual(responses[0]);
    } finally { await otherPool.end(); }
  });

  it("scopes keys by verified actor, not operation, and rejects changed intent", async () => {
    const command = identity();
    await executor.execute(command, authorizeSynthetic, async () => ({ result: "original" }));
    for (const changed of [{ ...command, payload: { quoteId: "changed" } }, { ...command, operation: "test.refund" }]) {
      await expect(executor.execute(changed, authorizeSynthetic, async () => ({ result: "wrong" }))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
    }
    const other = { ...command, actor: { ...actor, id: randomUUID() } };
    expect(await executor.execute(other, authorizeSynthetic, async () => ({ result: "other-owner" }))).toEqual({ result: "other-owner" });
  });

  it("treats JSON object key order as the same payload without ignoring array order", async () => {
    const command = { ...identity(), payload: { a: 1, b: [2, 3] } };
    await executor.execute(command, authorizeSynthetic, async () => ({ result: true }));
    expect(await executor.execute({ ...command, payload: { b: [2, 3], a: 1 } }, authorizeSynthetic, async () => { throw new Error("Replay expected"); })).toEqual({ result: true });
    await expect(executor.execute({ ...command, payload: { a: 1, b: [3, 2] } }, authorizeSynthetic, async () => ({ result: false }))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("rolls back business writes, audit, outbox and response together and allows the original retry", async () => {
    const command = identity();
    const event = { ...confirmation(), traceId: command.traceId };
    const effectId = randomUUID();
    const work = async (scope: v2.TransactionScope<pg.PoolClient>) => {
      await scope.handle.query("INSERT INTO v2_executor_test_effects VALUES ($1,$2)", [effectId, command.idempotencyKey]);
      await scope.audit({ aggregateId: effectId, action: "BOOK", reason: "Synthetic test", before: null, after: { version: 1 } });
      await scope.publish(event);
      return { id: effectId };
    };
    await expect(executor.execute(command, authorizeSynthetic, async scope => { await work(scope); throw new Error("Crash before commit"); })).rejects.toThrow("Crash before commit");
    for (const [table, column, value] of [
      ["v2_executor_test_effects", "id", effectId], ["v2_audit", "aggregate_id", effectId],
      ["v2_outbox", "event_id", event.eventId], ["v2_command_results", "idempotency_key", command.idempotencyKey],
    ]) {
      expect((await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${column}=$1`, [value])).rows[0].count).toBe(0);
    }
    expect(await executor.execute(command, authorizeSynthetic, work)).toEqual({ id: effectId });
    expect((await pool.query("SELECT actor_id FROM v2_audit WHERE aggregate_id=$1", [effectId])).rows).toEqual([{ actor_id: actor.id }]);
    expect((await pool.query("SELECT envelope FROM v2_outbox WHERE event_id=$1", [event.eventId])).rows[0].envelope).toEqual(event);
  });

  it("deduplicates concurrent inbox delivery with the effect and rejects event identity reuse", async () => {
    const event = confirmation();
    const effectId = randomUUID();
    let effects = 0;
    const work = async (scope: v2.TransactionScope<pg.PoolClient>) => {
      effects++;
      await scope.handle.query("INSERT INTO v2_executor_test_effects VALUES ($1,$2)", [effectId, event.eventId]);
    };
    const results = await Promise.all(Array.from({ length: 6 }, () => executor.consume("executor-test", systemActor, event, work)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(effects).toBe(1);
    await expect(executor.consume("executor-test", systemActor, { ...event, aggregateVersion: 2 }, work)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("rolls back a failed inbox handler so redelivery can succeed", async () => {
    const event = confirmation();
    const id = randomUUID();
    await expect(executor.consume("executor-test", systemActor, event, async scope => {
      await scope.handle.query("INSERT INTO v2_executor_test_effects VALUES ($1,$2)", [id, event.eventId]);
      throw new Error("Consumer crash");
    })).rejects.toThrow("Consumer crash");
    expect(await executor.consume("executor-test", systemActor, event, async scope => {
      await scope.handle.query("INSERT INTO v2_executor_test_effects VALUES ($1,$2)", [id, event.eventId]);
    })).toBe(true);
  });

  it("rejects an unscoped system consumer and malformed events before any effect", async () => {
    let called = false;
    const work = async () => { called = true; };
    await expect(executor.consume("unrelated-consumer", systemActor, confirmation(), work)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const event = confirmation();
    await expect(executor.consume("executor-test", systemActor, { ...event, aggregateId: randomUUID() }, work)).rejects.toBeTruthy();
    expect(called).toBe(false);
  });
});
