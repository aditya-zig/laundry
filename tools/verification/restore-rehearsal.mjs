import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { createTaskPostgres } from '../cloud/postgres.mjs';

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
    const source = await createTaskPostgres({ runtime: 'docker', label: 'restore-source' }); contexts.push(source);
    const target = await createTaskPostgres({ runtime: 'docker', label: 'restore-target' }); contexts.push(target);
    if (signalled) throw new Error('Restore verification interrupted');
    // This creates real synthetic rows through all three actual web applications,
    // SDK/API and PostgreSQL. Provider identities and payment remain labeled demo.
    // Keep the source RUNNING until pg_dump: Docker task storage is intentionally
    // tmpfs, so stop/start is not a persistence guarantee for this test harness.
    const code = await new Promise((accept, reject) => {
      activeChild = spawn('pnpm', ['verify:browser'], { stdio: 'inherit', env: { ...process.env,
        DATABASE_URL: source.databaseUrl, DATABASE_URL_UNPOOLED: source.databaseUrl,
        DEMO_MODE: 'true', VERIFY_ALLOW_DIRTY: dirty ? '1' : '0' } });
      const timer = setTimeout(() => activeChild?.kill('SIGTERM'), 180000);
      activeChild.once('error', error => { clearTimeout(timer); reject(error); });
      activeChild.once('close', status => { clearTimeout(timer); activeChild = undefined; accept(status); });
    });
    if (code !== 0 || signalled) throw new Error(`Source browser journey failed or interrupted (exit ${code})`);
    const a = new pg.Pool({ connectionString: source.databaseUrl, max: 1 }); pools.push(a);
    const b = new pg.Pool({ connectionString: target.databaseUrl, max: 1 }); pools.push(b);
    const before = await fingerprint(a);
    const { rows: [facts] } = await a.query(`SELECT
      (SELECT count(*)::int FROM orders WHERE status='DELIVERED') AS delivered,
      (SELECT count(*)::int FROM payments WHERE status='CAPTURED') AS captures,
      (SELECT coalesce(sum(amount_minor),0)::text FROM payments WHERE status='CAPTURED') AS captured_minor,
      (SELECT count(*)::int FROM delivery_jobs WHERE status='COMPLETED') AS completed_legs,
      (SELECT count(*)::int FROM reviews) AS reviews`);
    assert.equal(facts.delivered, 1); assert.equal(facts.captures, 1);
    assert.ok(BigInt(facts.captured_minor) > 0n);
    assert.equal(facts.completed_legs, 2); assert.equal(facts.reviews, 1);
    assert.equal((await b.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0, 'Restore target must start empty');
    const sourceState = source.describe(), targetState = target.describe();
    const dump = spawnSync('docker', ['exec', sourceState.container, 'pg_dump', '-U', new URL(source.databaseUrl).username, '-d', sourceState.database,
      '--format=custom', '--no-owner', '--no-acl'], { maxBuffer: 50 * 1024 * 1024, timeout: 60000 });
    if (dump.error || dump.status !== 0 || !dump.stdout?.length) throw new Error('pg_dump failed; no recovery success claimed');
    await mkdir('.data/backups', { recursive: true, mode: 0o700 });
    const archive = resolve('.data/backups/fixture-restore.dump');
    await writeFile(archive, dump.stdout, { mode: 0o600 });
    const restore = spawnSync('docker', ['exec', '-i', targetState.container, 'pg_restore', '-U', new URL(target.databaseUrl).username, '-d', targetState.database,
      '--no-owner', '--no-acl', '--exit-on-error'], { input: dump.stdout, maxBuffer: 2 * 1024 * 1024, timeout: 60000 });
    if (restore.error || restore.status !== 0) throw new Error('pg_restore failed; no recovery success claimed');
    assert.deepEqual(await fingerprint(b), before, 'Restored tables and sequences differ from the source');
    const restoredOrder = (await b.query('SELECT id,customer_id FROM orders LIMIT 1')).rows[0];
    await assert.rejects(b.query(`INSERT INTO reviews (order_id,customer_id,overall,comment,media_ids,consent)
      VALUES ($1,$2,5,'Synthetic duplicate after recovery','[]',true)`, [restoredOrder.id, restoredOrder.customer_id]), error => error.code === '23505');
    assert.equal((await b.query('SELECT count(*)::int AS n FROM reviews')).rows[0].n, 1, 'Recovery lost review uniqueness');
    if (signalled) throw new Error('Restore verification interrupted');
    await mkdir('.verification', { recursive: true });
    const receipt = { testedSha: revision, dirty, checkedAt: new Date().toISOString(), scope: 'PostgreSQL 17 synthetic legacy web journey backup/restore, not cloud restore, physical fulfillment or production-v2 acceptance',
      archive: { sha256: hash(dump.stdout), sizeBytes: dump.stdout.length, privateLocalPath: '.data/backups/fixture-restore.dump' }, facts, restoredTables: before.tables.length,
      fingerprints: before, duplicateReviewRejectedAfterRestore: true, productionReady: false };
    await writeFile('.verification/restore-rehearsal.json', JSON.stringify(receipt, null, 2));
    console.log(`Recovery verified: ${before.tables.length} tables, all sequences, captures, both custody legs and review uniqueness.`);
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
