import { afterAll, beforeAll, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { v2 } from "@laundry/contracts";
import { createPostgresCommandExecutor } from "../../../modules/shared/src/command-executor";
import { ApiError } from "../../../modules/shared/src/errors";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const execute = createPostgresCommandExecutor(pool).execute;
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.includes("verify")) throw new Error("Explicit isolated verification database required");
  await pool.query(await readFile(new URL("../../../modules/schema/migrations/006_v2_transactions.sql", import.meta.url), "utf8"));
});
afterAll(async () => pool.end());
it("rechecks current authorization before returning a replay after assignment revocation", async () => {
  const actor: v2.Actor = { id: randomUUID(), role: "RIDER", facilityIds: [], scope: { facilityIds: [] } };
  const command: v2.CommandIdentity = { actor, operation: "test.handover", idempotencyKey: randomUUID(), traceId: randomUUID(), payload: { jobId: randomUUID() } };
  let assigned = true;
  const authorize = async () => { if (!assigned) throw new ApiError("NOT_FOUND", "Job not found"); };
  let mutations = 0;
  const work = async () => { mutations++; return { accepted: true }; };
  expect(await execute(command, authorize, work)).toEqual({ accepted: true });
  assigned = false;
  await expect(execute(command, authorize, work)).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(mutations).toBe(1);
});
