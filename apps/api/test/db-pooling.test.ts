import { afterEach, beforeAll, expect, it, vi } from "vitest";
import pg from "pg";
import { closePool, getPool, initializeDb } from "../../../modules/shared/src/db";

const original = { ...process.env };
const databaseUrl = process.env.DATABASE_URL!;
beforeAll(() => {
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/^\/laundry_verify_/.test(url.pathname)) throw new Error("Pooling tests require an isolated local verification database");
});
afterEach(async () => {
  await closePool();
  for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "PG_POOL_MAX", "PG_CONNECTION_TIMEOUT_MS", "PG_IDLE_TIMEOUT_MS", "PG_MAX_LIFETIME_SECONDS", "DEMO_MODE", "DEMO_CUSTOMER_PHONE", "DEMO_RIDER_PHONE"])  {
    if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
  }
  vi.restoreAllMocks();
});

it("bounds pool acquisition waits instead of silently opening more connections", async () => {
  process.env.PG_POOL_MAX = "1";
  process.env.PG_CONNECTION_TIMEOUT_MS = "100";
  const pool = getPool();
  const borrowed = await pool.connect();
  try {
    await expect(pool.query("SELECT 1 AS n")).rejects.toThrow(/timeout/i);
  } finally { borrowed.release(); }
  expect((await pool.query("SELECT 1 AS n")).rows).toEqual([{ n: 1 }]);
});

it("runs migrations and seeds on the explicit direct connection, not the application pool", async () => {
  process.env.DATABASE_URL_UNPOOLED = databaseUrl;
  const unavailable = new URL(databaseUrl);
  unavailable.port = "1";
  process.env.DATABASE_URL = unavailable.toString();
  process.env.PG_CONNECTION_TIMEOUT_MS = "100";
  await expect(initializeDb()).resolves.toBeUndefined();
  const check = new pg.Pool({ connectionString: databaseUrl });
  try { expect((await check.query("SELECT to_regclass('public.v2_command_results') AS name")).rows[0].name).toBe("v2_command_results"); }
  finally { await check.end(); }
});

it("fails closed before trying a Neon pooler for schema migration", async () => {
  process.env.DATABASE_URL = "postgres://synthetic:never_log_me@ep-laundry-pooler.ap-southeast-1.aws.neon.tech/laundry_staging?sslmode=require";
  delete process.env.DATABASE_URL_UNPOOLED;
  await expect(initializeDb()).rejects.toThrow(/DATABASE_URL_UNPOOLED/);
});

it("rejects malformed pool limits instead of silently selecting driver defaults", () => {
  for (const value of ["0", "-1", "1.5", "abc", "101"]) {
    process.env.PG_POOL_MAX = value;
    expect(() => getPool()).toThrow(/PG_POOL_MAX/);
  }
});

it("rejects mismatched migration targets without opening a connection", async () => {
  for (const direct of ["postgres://synthetic:private@other.invalid/laundry_verify_wrong", new URL('/different_database', databaseUrl).toString()]) {
    process.env.DATABASE_URL_UNPOOLED = direct;
    await expect(initializeDb()).rejects.toThrow(/same database and endpoint/);
  }
});

it("releases a failed migration transaction and can initialize successfully afterwards", async () => {
  process.env.DEMO_MODE = "true";
  process.env.DEMO_CUSTOMER_PHONE = "+91-90000-00999";
  process.env.DEMO_RIDER_PHONE = process.env.DEMO_CUSTOMER_PHONE;
  await expect(initializeDb()).rejects.toThrow(/duplicate|unique/i);
  const admin = new pg.Pool({ connectionString: databaseUrl });
  try {
    expect((await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = 'laundry-migrations'")).rows[0].n).toBe(0);
    process.env.DEMO_MODE = "false";
    await expect(initializeDb()).resolves.toBeUndefined();
  } finally { await admin.end(); }
});

it("coordinates shutdown without allocating a second pool while a client is borrowed", async () => {
  const first = getPool();
  const borrowed = await first.connect();
  const closing = closePool();
  try { expect(() => getPool()).toThrow(/shutting down/); }
  finally { borrowed.release(); }
  await closing;
  expect(getPool()).not.toBe(first);
});

it("requires verified TLS on Neon without exposing the connection string", async () => {
  const host = "ep-synthetic-pooler.ap-southeast-1.aws.neon.tech";
  process.env.DATABASE_URL = `postgres://synthetic:never_log_me@${host}/laundry_staging?sslmode=disable`;
  expect(() => getPool()).toThrow(/^Neon connections require sslmode=verify-full$/);
  process.env.DATABASE_URL = `postgres://synthetic:never_log_me@${host}/laundry_staging?sslmode=require`;
  const pool = getPool();
  const client = new pg.Client(pool.options);
  expect(client.ssl).toBeTruthy();
  expect(client.ssl).not.toMatchObject({ rejectUnauthorized: false });
  await closePool();
});

it("handles a server-terminated idle connection and recovers without logging credentials", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const pool = getPool();
  const pid = (await pool.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  const idleError = new Promise<void>(resolve => pool.once("error", () => resolve()));
  const admin = new pg.Pool({ connectionString: databaseUrl });
  try {
    await admin.query("SELECT pg_terminate_backend($1)", [pid]);
    await idleError;
    expect((await pool.query("SELECT 1 AS n")).rows).toEqual([{ n: 1 }]);
    expect(log).toHaveBeenCalledWith("[database] idle connection removed", expect.objectContaining({ code: expect.any(String) }));
    expect(JSON.stringify(log.mock.calls)).not.toContain(databaseUrl);
  } finally { await admin.end(); }
});
