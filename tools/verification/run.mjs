import { spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { requireTestDatabase, writeEvidence } from './evidence.mjs';
import { createTaskPostgres } from '../cloud/postgres.mjs';

let database;
try {
  const scope = process.env.VERIFY_WEB_SCOPE ?? 'legacy';
  if (!['legacy', 'product'].includes(scope)) throw new Error('Unknown browser verification scope.');
  await mkdir('.verification', { recursive: true });
  // A failed build or launch must never reuse an earlier report or manifest.
  const prefix = scope === 'product' ? 'product-' : '';
  await rm(`.verification/${prefix}results.json`, { force: true });
  await rm(`.verification/${prefix}manifest.json`, { force: true });
  requireTestDatabase(process.env.DATABASE_URL);
  let env = process.env;
  if (scope === 'product') {
    env = { ...process.env, EXPO_PUBLIC_API_V2_URL: 'http://127.0.0.1:4499/v2', VITE_API_V2_URL: 'http://127.0.0.1:4499/v2',
      EXPO_PUBLIC_AUTH_ENGINE: 'legacy', VITE_DEMO_MODE: 'false', LAUNDRY_SYNTHETIC_ACCEPTANCE: 'true' };
    // Build explicit task-only exports, not a release bundle with a stale or
    // missing public API URL. Never write to the caller's existing database.
    for (const app of ['@laundry/customer', '@laundry/partner', '@laundry/ops']) {
      const build = spawnSync('pnpm', ['--filter', app, 'build'], { stdio: 'inherit', env });
      if (build.error) throw build.error;
      if (build.status !== 0) throw new Error(`Task export failed for ${app} (exit ${build.status ?? 1}).`);
    }
    database = await createTaskPostgres({ label: 'product-browser', runtime: process.env.LAUNDRY_PG_RUNTIME ?? 'auto',
      ...(process.env.LAUNDRY_PG_BIN_DIR ? { binDir: process.env.LAUNDRY_PG_BIN_DIR } : {}) });
    requireTestDatabase(database.databaseUrl);
    env = { ...env, DATABASE_URL: database.databaseUrl, DATABASE_URL_UNPOOLED: database.databaseUrl };
  }
  let exitCode;
  if (database) {
    // Reuse the task owner's tested SIGINT/SIGTERM forwarding and cleanup;
    // a synchronous child would strand the new database on interruption.
    exitCode = (await database.runAcceptance(['pnpm', 'exec', 'playwright', 'test', '--config', 'playwright.product.config.ts'], { env })).code;
  } else {
    const result = spawnSync('pnpm', ['exec', 'playwright', 'test'], { stdio: 'inherit', env });
    if (result.error) throw result.error;
    exitCode = result.status ?? 1;
  }
  await writeEvidence({ exitCode, scope });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (database) await database.stop({ keep: false });
}
