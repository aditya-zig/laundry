import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { createTaskPostgres } from '../cloud/postgres.mjs';
import { prepareIdentityRecovery } from './identity-recovery.mjs';
import { taskArchiveCommand } from './task-archive.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const quote = name => '"' + name.replaceAll('"', '""') + '"';

async function fingerprint(db) {
  const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const result = [];
  for (const { tablename } of tables) {
    const { rows: [{ data, count }] } = await db.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS data, count(*)::int AS count FROM public.${quote(tablename)} t`);
    result.push({ table: tablename, count, sha256: hash(JSON.stringify(data)) });
  }
  const sequences = [];
  for (const { sequencename } of (await db.query("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows) {
    const { rows: [state] } = await db.query(`SELECT last_value::text, is_called FROM public.${quote(sequencename)}`);
    sequences.push({ sequence: sequencename, ...state });
  }
  return { tables: result, sequences };
}

async function main() {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim());
  const contexts = [], pools = [];
  let signalled = false, activeChild;
  const interrupted = () => { signalled = true; activeChild?.kill('SIGTERM'); };
  process.on('SIGINT', interrupted); process.on('SIGTERM', interrupted);
  try {
    const sourceJourney = process.env.LAUNDRY_RESTORE_SOURCE ?? 'legacy';
    assert.ok(['legacy', 'customer-v2'].includes(sourceJourney), 'Unknown restore source journey');
    const taskOptions = { runtime: process.env.LAUNDRY_PG_RUNTIME ?? 'auto', ...(process.env.LAUNDRY_PG_BIN_DIR ? { binDir: process.env.LAUNDRY_PG_BIN_DIR } : {}) };
    const source = await createTaskPostgres({ ...taskOptions, label: 'restore-source' }); contexts.push(source);
    const target = await createTaskPostgres({ ...taskOptions, label: 'restore-target' }); contexts.push(target);
    if (signalled) throw new Error('Restore verification interrupted');
    // Run the explicitly selected actual-application journey, never a canned
    // database dump. Legacy covers three demo apps; customer-v2 proves only its
    // named customer/optional ops scope. Neither proves physical fulfillment.
    // Keep the source RUNNING until pg_dump: Docker task storage is intentionally
    // tmpfs, so stop/start is not a persistence guarantee for this test harness.
    const code = await new Promise((accept, reject) => {
      activeChild = spawn(sourceJourney === 'legacy' ? 'pnpm' : process.execPath,
        sourceJourney === 'legacy' ? ['verify:browser'] : ['tools/verification/customer-v2-browser.cjs'],
        { stdio: 'inherit', env: { ...process.env,
          DATABASE_URL: source.databaseUrl, DATABASE_URL_UNPOOLED: source.databaseUrl,
          DEMO_MODE: sourceJourney === 'legacy' ? 'true' : 'false',
          LAUNDRY_SYNTHETIC_ACCEPTANCE: 'true', VERIFY_ALLOW_DIRTY: dirty ? '1' : '0' } });
      const timer = setTimeout(() => activeChild?.kill('SIGTERM'), 180000);
      activeChild.once('error', error => { clearTimeout(timer); reject(error); });
      activeChild.once('close', status => { clearTimeout(timer); activeChild = undefined; accept(status); });
    });
    if (code !== 0 || signalled) throw new Error(`Source browser journey failed or interrupted (exit ${code})`);
    const a = new pg.Pool({ connectionString: source.databaseUrl, max: 1 }); pools.push(a);
    const b = new pg.Pool({ connectionString: target.databaseUrl, max: 1 }); pools.push(b);
    const verifyIdentityRecovery = await prepareIdentityRecovery(a);
    const before = await fingerprint(a);
    let facts;
    if (sourceJourney === 'legacy') {
      ({ rows: [facts] } = await a.query(`SELECT
        (SELECT count(*)::int FROM orders WHERE status='DELIVERED') AS delivered,
        (SELECT count(*)::int FROM payments WHERE status='CAPTURED') AS captures,
        (SELECT coalesce(sum(amount_minor),0)::text FROM payments WHERE status='CAPTURED') AS captured_minor,
        (SELECT count(*)::int FROM delivery_jobs WHERE status='COMPLETED') AS completed_legs,
        (SELECT count(*)::int FROM reviews) AS reviews`));
      assert.equal(facts.delivered, 1); assert.equal(facts.captures, 1);
      assert.ok(BigInt(facts.captured_minor) > 0n);
      assert.equal(facts.completed_legs, 2); assert.equal(facts.reviews, 1);
    } else {
      ({ rows: [facts] } = await a.query(`SELECT
        (SELECT count(*)::int FROM orders_v2_orders) AS orders,
        (SELECT count(*)::int FROM v2_audit WHERE action='ADJUSTMENT_ACCEPTED') AS accepted_decisions,
        (SELECT count(*)::int FROM billing_obligations) AS obligations,
        (SELECT count(*)::int FROM logistics_leg_attempts WHERE leg='PICKUP') AS pickup_legs,
        (SELECT count(*)::int FROM logistics_leg_attempts WHERE leg='RETURN') AS return_legs`));
      assert.equal(facts.orders, 1); assert.equal(facts.accepted_decisions, 1);
      assert.equal(facts.obligations, 1); assert.equal(facts.pickup_legs, 1);
      assert.equal(facts.return_legs, process.env.LAUNDRY_VERIFY_OPS_FACILITY === 'true' ? 1 : 0);
    }
    assert.equal((await b.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0, 'Restore target must start empty');
    const sourceState = source.describe(), targetState = target.describe();
    const dumpCommand = taskArchiveCommand(source, 'pg_dump', taskOptions);
    const dump = spawnSync(dumpCommand.file, [...dumpCommand.args, '--format=custom', '--no-owner', '--no-acl'],
      { env: dumpCommand.env, maxBuffer: 50 * 1024 * 1024, timeout: 60000 });
    if (dump.error || dump.status !== 0 || !dump.stdout?.length) throw new Error('pg_dump failed; no recovery success claimed');
    await mkdir('.data/backups', { recursive: true, mode: 0o700 });
    const archivePath = `.data/backups/fixture-restore-${randomUUID()}.dump`;
    const archive = resolve(archivePath);
    // Never inherit an existing file's permissions or follow an old archive symlink.
    await writeFile(archive, dump.stdout, { mode: 0o600, flag: 'wx' });
    const restoreCommand = taskArchiveCommand(target, 'pg_restore', taskOptions);
    const restore = spawnSync(restoreCommand.file, [...restoreCommand.args, '--no-owner', '--no-acl', '--exit-on-error'],
      { env: restoreCommand.env, input: dump.stdout, maxBuffer: 2 * 1024 * 1024, timeout: 60000 });
    if (restore.error || restore.status !== 0) throw new Error('pg_restore failed; no recovery success claimed');
    assert.deepEqual(await fingerprint(b), before, 'Restored tables and sequences differ from the source');
    const identity = await verifyIdentityRecovery(b);
    if (sourceJourney === 'legacy') {
      const restoredOrder = (await b.query('SELECT id,customer_id FROM orders LIMIT 1')).rows[0];
      await assert.rejects(b.query(`INSERT INTO reviews (order_id,customer_id,overall,comment,media_ids,consent)
        VALUES ($1,$2,5,'Synthetic duplicate after recovery','[]',true)`, [restoredOrder.id, restoredOrder.customer_id]), error => error.code === '23505');
      assert.equal((await b.query('SELECT count(*)::int AS n FROM reviews')).rows[0].n, 1, 'Recovery lost review uniqueness');
    } else {
      await assert.rejects(b.query('INSERT INTO orders_v2_orders SELECT * FROM orders_v2_orders'), error => error.code === '23505');
      assert.equal((await b.query('SELECT count(*)::int AS n FROM orders_v2_orders')).rows[0].n, 1, 'Recovery lost order uniqueness');
    }
    if (signalled) throw new Error('Restore verification interrupted');
    await mkdir('.verification', { recursive: true });
    const serverVersion = (await a.query('SHOW server_version')).rows[0].server_version;
    const receipt = { testedSha: revision, dirty, checkedAt: new Date().toISOString(), sourceJourney, serverVersion,
      runtime: { source: sourceState.runtime, target: targetState.runtime },
      scope: `Synthetic ${sourceJourney} application rows and encrypted identity backup/restore; fake external providers; not cloud restore, physical fulfillment or whole-product v2 acceptance`,
      archive: { sha256: hash(dump.stdout), sizeBytes: dump.stdout.length, privateLocalPath: archivePath }, facts, identity, restoredTables: before.tables.length,
      fingerprints: before, duplicateReviewRejectedAfterRestore: sourceJourney === 'legacy', duplicateOrderRejectedAfterRestore: sourceJourney === 'customer-v2', productionReady: false };
    await writeFile('.verification/restore-rehearsal.json', JSON.stringify(receipt, null, 2));
    console.log(`Recovery verified (${sourceJourney}, PostgreSQL ${serverVersion}): ${before.tables.length} tables, all sequences, selected application facts, uniqueness and encrypted identity recovery. Production readiness NOT claimed.`);
  } finally {
    for (const db of pools.reverse()) await db.end();
    // Always attempt all owned cleanup, including if one cleanup fails.
    const failures = [];
    for (const context of contexts.reverse()) try { await context.stop({ keep: false }); } catch (error) { failures.push(error); }
    process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
    if (failures.length) throw new Error('Recovery contexts could not all be removed; inspect the owned task workdirs');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
