import assert from 'node:assert/strict';
import test from 'node:test';
import { taskArchiveCommand } from './task-archive.mjs';

function context(runtime = 'local', overrides = {}, databaseUrl = 'postgres://task_user:synthetic-password@127.0.0.1:45678/laundry_verify_archive_test') {
  return { databaseUrl, describe: () => ({ runtime, status: 'running', port: 45678, database: 'laundry_verify_archive_test', container: 'laundry-pg-archive-test', ...overrides }) };
}

test('local archive tools target only the task database and never put a password in argv', () => {
  for (const tool of ['pg_dump', 'pg_restore']) {
    const command = taskArchiveCommand(context(), tool, { binDir: '/owned/pg/bin', env: { PATH: '/safe/bin', LD_LIBRARY_PATH: '/owned/pg/lib', PGHOSTADDR: 'remote.invalid', PGSERVICE: 'personal', PGDATABASE: 'production' } });
    assert.equal(command.file, `/owned/pg/bin/${tool}`);
    assert.deepEqual(command.args, ['-h', '127.0.0.1', '-p', '45678', '-U', 'task_user', '-d', 'laundry_verify_archive_test']);
    assert.equal(command.env.PGPASSWORD, 'synthetic-password');
    assert.equal(command.env.PGSSLMODE, 'disable');
    assert.equal(command.env.PGHOSTADDR, undefined);
    assert.equal(command.env.PGSERVICE, undefined);
    assert.equal(command.env.PGDATABASE, undefined);
    assert.equal(command.env.LD_LIBRARY_PATH, '/owned/pg/lib');
    assert.equal(command.args.join(' ').includes('synthetic-password'), false);
  }
});

test('Docker dump and restore stay in the owned container, preserving stdin for restore', () => {
  assert.deepEqual(taskArchiveCommand(context('docker'), 'pg_dump', { env: {} }).args, ['exec', 'laundry-pg-archive-test', 'pg_dump', '-U', 'task_user', '-d', 'laundry_verify_archive_test']);
  assert.deepEqual(taskArchiveCommand(context('docker'), 'pg_restore', { env: {} }).args.slice(0, 4), ['exec', '-i', 'laundry-pg-archive-test', 'pg_restore']);
});

test('refuses remote, non-task, stopped, mismatched or ambiguous database targets', () => {
  for (const databaseUrl of [
    'postgres://u:p@remote.invalid:45678/laundry_verify_archive_test',
    'postgres://u:p@127.0.0.1:45678/production',
    'postgres://u:p@127.0.0.1:9999/laundry_verify_archive_test',
    'postgres://u:p@127.0.0.1:45678/laundry_verify_archive_test?host=remote.invalid',
    'postgres://u@127.0.0.1:45678/laundry_verify_archive_test',
  ]) assert.throws(() => taskArchiveCommand(context('local', {}, databaseUrl), 'pg_dump'));
  assert.throws(() => taskArchiveCommand(context('local', { status: 'stopped' }), 'pg_dump'));
  assert.throws(() => taskArchiveCommand(context('other'), 'pg_dump'));
  assert.throws(() => taskArchiveCommand(context('docker', { container: '--privileged' }), 'pg_dump'));
  assert.throws(() => taskArchiveCommand(context(), 'psql'));
});
