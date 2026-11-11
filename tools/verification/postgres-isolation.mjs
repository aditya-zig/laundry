import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createTaskPostgres } from '../cloud/postgres.mjs';

const { Client } = createRequire(new URL('../../apps/api/package.json', import.meta.url))('pg');
const resources = [];
const clients = [];
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const workdirExists = handle => access(handle.workdir).then(() => true, () => false);

assert.equal(git('status', '--porcelain'), '', 'Isolation acceptance requires a clean source revision');
const proof = {
  scenario: 'P01-04',
  testedSha: git('rev-parse', 'HEAD'),
  syntheticOnly: true,
  commercialCalls: 0,
  productionReady: false,
};

try {
  for (const label of ['p01-owner', 'p01-peer']) {
    const handle = await createTaskPostgres({ label });
    resources.push(handle);
    const client = new Client({ connectionString: handle.databaseUrl });
    clients.push(client);
    await client.connect();
    await client.query('CREATE TABLE peer_marker (label text PRIMARY KEY)');
    await client.query('INSERT INTO peer_marker VALUES ($1)', [label]);
  }

  assert.notEqual(resources[0].port, resources[1].port);
  assert.notEqual(resources[0].workdir, resources[1].workdir);
  for (const [index, label] of ['p01-owner', 'p01-peer'].entries()) {
    assert.deepEqual((await clients[index].query('SELECT label FROM peer_marker')).rows, [{ label }]);
  }

  await clients[0].end();
  await resources[0].stop();
  assert.equal(await workdirExists(resources[0]), false);
  assert.equal((await resources[1].status()).running, true);
  assert.deepEqual((await clients[1].query('SELECT label FROM peer_marker')).rows, [{ label: 'p01-peer' }]);
  Object.assign(proof, {
    passed: true,
    distinctPorts: true,
    distinctWorkdirs: true,
    isolatedRows: true,
    stoppedOwnerWorkdirRemoved: true,
    peerStillRunningWithOriginalRow: true,
  });
} finally {
  await Promise.allSettled(clients.map(client => client.end()));
  const cleanup = await Promise.allSettled(resources.map(handle => handle.stop()));
  assert.equal(cleanup.every(result => result.status === 'fulfilled'), true, 'Owned isolation resources must clean up');
  assert.equal((await Promise.all(resources.map(workdirExists))).some(Boolean), false);
}

assert.equal(git('status', '--porcelain'), '', 'Source changed during isolation acceptance');
proof.allOwnedWorkdirsRemoved = true;
await mkdir('.verification', { recursive: true });
await writeFile('.verification/p01-isolation.json', JSON.stringify(proof, null, 2) + '\n');
console.log('PASS: two real PostgreSQL tasks keep separate rows/ports; removing the owner preserves its live peer; both owned workdirs clean up.');
