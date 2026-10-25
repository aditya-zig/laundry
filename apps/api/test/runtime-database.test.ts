import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { initializeDb, getPool, closePool } from '../../../modules/shared/src/db';
import { verifyRuntimeDatabase } from '../../../modules/shared/src/runtime-database';

let runtime: pg.Pool;
const role = 'laundry_runtime_' + randomBytes(8).toString('hex');
const password = randomBytes(24).toString('hex');
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/laundry_verify_')) throw new Error('Disposable PostgreSQL required');
  await initializeDb();
  await getPool().query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await getPool().query(`GRANT CONNECT ON DATABASE "${url.pathname.slice(1)}" TO ${role}`);
  await getPool().query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  const tables = (await getPool().query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'identity\\_%' ESCAPE '\\'")).rows;
  for (const table of tables) await getPool().query(`GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public."${table.tablename}" TO ${role}`);
  url.username = role; url.password = password;
  runtime = new pg.Pool({ connectionString: url.toString(), max: 2 });
});
afterAll(async () => {
  await runtime?.end();
  try { await getPool().query(`DROP OWNED BY ${role}`); await getPool().query(`DROP ROLE ${role}`); }
  finally { await closePool(); }
});

it('accepts real non-owner runtime credentials with complete DML-only identity grants', async () => {
  await expect(verifyRuntimeDatabase(runtime)).resolves.toBeUndefined();
  expect((await runtime.query('SELECT current_user AS name')).rows[0].name).toBe(role);
  await expect(runtime.query('CREATE TABLE public.should_never_exist (id int)')).rejects.toMatchObject({ code: '42501' });
  await expect(runtime.query('SELECT * FROM users')).rejects.toMatchObject({ code: '42501' });
});

it('rejects owner/migration credentials instead of reusing them for the live API', async () => {
  await expect(verifyRuntimeDatabase(getPool())).rejects.toThrow(/role must not/);
});

it('rejects incomplete grants even when another listed DML privilege is present', async () => {
  await getPool().query(`REVOKE DELETE ON identity_addresses FROM ${role}`);
  try { await expect(verifyRuntimeDatabase(runtime)).rejects.toThrow(/grants are incomplete/); }
  finally { await getPool().query(`GRANT DELETE ON identity_addresses TO ${role}`); }
  await expect(verifyRuntimeDatabase(runtime)).resolves.toBeUndefined();
});

it('rejects inherited owner membership even with NOINHERIT', async () => {
  const owner = (await getPool().query('SELECT current_user AS name')).rows[0].name;
  await getPool().query(`ALTER ROLE ${role} NOINHERIT`);
  await getPool().query(`GRANT "${owner}" TO ${role}`);
  try { await expect(verifyRuntimeDatabase(runtime)).rejects.toThrow(/owner|administrative/); }
  finally { await getPool().query(`REVOKE "${owner}" FROM ${role}`); await getPool().query(`ALTER ROLE ${role} INHERIT`); }
});

it('rejects table TRUNCATE authority and schema CREATE authority', async () => {
  await getPool().query(`GRANT TRUNCATE ON identity_addresses TO ${role}`);
  try { await expect(verifyRuntimeDatabase(runtime)).rejects.toThrow(/destructive/); }
  finally { await getPool().query(`REVOKE TRUNCATE ON identity_addresses FROM ${role}`); }
  await getPool().query(`GRANT CREATE ON SCHEMA public TO ${role}`);
  try { await expect(verifyRuntimeDatabase(runtime)).rejects.toThrow(/schema-create/); }
  finally { await getPool().query(`REVOKE CREATE ON SCHEMA public FROM ${role}`); }
});
