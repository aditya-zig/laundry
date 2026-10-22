import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createTaskPostgres, main, openTaskPostgres } from './postgres.mjs';

const RUN_LOCAL = 't01_local_abcdef';
const RUN_DOCKER = 't01_docker_abcdef';
const CONTAINER_ID = 'c'.repeat(64);

function ok(stdout = '') {
  return { code: 0, signal: null, stdout, stderr: '' };
}

function localRun({ file, args }) {
  const name = basename(file);
  if (name === 'initdb') {
    const dataDir = args[args.indexOf('-D') + 1];
    return mkdir(dataDir, { recursive: true })
      .then(() => writeFile(join(dataDir, 'postgresql.conf'), ''))
      .then(() => ok());
  }
  if (name === 'pg_ctl') {
    const command = args.at(-1);
    if (command === 'status') return { code: 3, signal: null, stdout: '', stderr: 'no server running' };
    if (command === 'start' || command === 'stop') return ok();
    return { code: 1, signal: null, stdout: '', stderr: `unexpected pg_ctl ${command}` };
  }
  if (name === 'psql') {
    return ok('1\n');
  }
  return { code: 127, signal: null, stdout: '', stderr: `unexpected command ${file}` };
}

function makeAdapter(overrides = {}) {
  const calls = [];
  const signals = new Map();
  const executables = overrides.executables ?? {
    initdb: '/pg/bin/initdb',
    pg_ctl: '/pg/bin/pg_ctl',
    psql: '/pg/bin/psql',
  };
  let pgRunning = false;
  let containerExists = Boolean(overrides.containerExists);
  let foreign = false;
  const execute = overrides.run ?? localRun;
  const childResult = Object.hasOwn(overrides, 'childResult') ? overrides.childResult : { code: 0, signal: null };

  const adapter = {
    calls,
    signals,
    get pgRunning() {
      return pgRunning;
    },
    get containerExists() {
      return containerExists;
    },
    set foreign(value) {
      foreign = value;
    },
    async findExecutable(name) {
      calls.push({ op: 'find', name });
      return executables[name] ?? null;
    },
    async exists(file) {
      calls.push({ op: 'exists', file });
      return true;
    },
    async run(file, args, options = {}) {
      calls.push({ op: 'run', file, args, options });
      if (basename(file) === 'pg_ctl') {
        const command = args.at(-1);
        if (command === 'status') {
          return pgRunning
            ? ok('pg_ctl: server is running')
            : { code: 3, signal: null, stdout: '', stderr: 'pg_ctl: no server running' };
        }
        if (command === 'start') {
          pgRunning = true;
          return ok('server started');
        }
        if (command === 'stop') {
          pgRunning = false;
          return ok('server stopped');
        }
      }
      if (basename(file) === 'docker') {
        if (args[0] === 'version') return ok('17.0\n');
        if (args[0] === 'inspect') {
          if (!containerExists) {
            return { code: 1, signal: null, stdout: '', stderr: 'Error: No such object: container' };
          }
          if (args.some(argument => String(argument).includes('{{.Id}}'))) {
            const label = foreign ? 'someone_else' : overrides.runId;
            return ok(`${CONTAINER_ID}|true|${label}|p01\n`);
          }
          return ok('[{}]\n');
        }
        if (args[0] === 'run') {
          containerExists = true;
          return ok(`${CONTAINER_ID}\n`);
        }
        if (args[0] === 'exec') return ok('1\n');
        if (args[0] === 'start' || args[0] === 'stop' || args[0] === 'rm') {
          if (args[0] === 'rm') containerExists = false;
          return ok('');
        }
      }
      return execute({ file, args, options, adapter });
    },
    spawnChild(file, args, options = {}) {
      calls.push({ op: 'spawnChild', file, args, options });
      let settle;
      const completed = new Promise(resolve => {
        settle = resolve;
      });
      const child = {
        kill(signal) {
          calls.push({ op: 'kill', signal });
          settle({ code: null, signal });
        },
      };
      if (childResult !== null) {
        queueMicrotask(() => settle({ code: 0, signal: null, ...childResult }));
      }
      return { child, completed };
    },
    async makePort() {
      return 55432;
    },
    async sleep() {},
    randomHex(bytes) {
      return 'ab'.repeat(bytes).slice(0, bytes * 2);
    },
    onSignal(signal, handler) {
      signals.set(signal, handler);
    },
    offSignal(signal, handler) {
      if (signals.get(signal) === handler) signals.delete(signal);
    },
    emitSignal(signal) {
      const handler = signals.get(signal);
      if (handler) handler();
    },
  };
  return adapter;
}

async function temporaryRoot() {
  return mkdtemp(join(tmpdir(), 'laundry-pg-test-'));
}

async function readSecret(workdir) {
  const secret = JSON.parse(await readFile(join(workdir, 'secret.json'), 'utf8'));
  return secret.password;
}

async function withLocal(overrides, body) {
  const root = await temporaryRoot();
  const adapter = makeAdapter(overrides);
  const logs = [];
  const workdir = join(root, `run-${RUN_LOCAL}`);
  try {
    const handle = await createTaskPostgres({
      adapter,
      logger: line => logs.push(line),
      root,
      label: 'local',
      runId: RUN_LOCAL,
      port: 55432,
      runtime: 'local',
      startTimeoutMs: 500,
      pollMs: 50,
      ...overrides.options,
    });
    return await body({ handle, adapter, logs, root, workdir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('local runtime initialises one loopback cluster, runs a child with DATABASE_URL and removes only its workdir', async () => {
  await withLocal({}, async ({ handle, adapter, logs, workdir }) => {
    assert.equal(handle.describe().runtime, 'local');
    assert.match(handle.databaseUrl, /^postgres:\/\/[^:@/]+:[a-f0-9]{32,128}@127\.0\.0\.1:55432\/laundry_verify_t01_local_abcdef$/);
    const password = await readSecret(workdir);
    assert.ok(password.length >= 32);

    const initdb = adapter.calls.find(call => call.op === 'run' && basename(call.file) === 'initdb');
    assert.ok(initdb);
    assert.ok(initdb.args.includes('--auth-host=scram-sha-256'));
    assert.ok(initdb.args.includes('--auth-local=trust'));
    assert.equal(initdb.args.includes(password), false);
    const dataDir = initdb.args[initdb.args.indexOf('-D') + 1];
    assert.ok(dataDir.startsWith(workdir + '/'));
    assert.equal(adapter.calls.some(call => call.op === 'run' && basename(call.file) === 'docker'), false);
    assert.equal(logs.join('\n').includes(password), false);

    const result = await handle.runAcceptance(['node', '-e', 'process.exit(0)']);
    assert.equal(result.code, 0);
    assert.equal(result.cleanupError, null);
    const spawn = adapter.calls.find(call => call.op === 'spawnChild');
    assert.ok(spawn);
    assert.equal(spawn.args[0], '-e');
    assert.equal(spawn.options.env.DATABASE_URL, handle.databaseUrl);
    assert.equal(spawn.options.env.DATABASE_URL.includes(password), true);
    assert.equal(existsSync(workdir), false);
    assert.equal(adapter.signals.size, 0);
  });
});

test('local readiness passes its task password to psql without inheriting a hosted migration URL', async () => {
  const previous = process.env.DATABASE_URL_UNPOOLED;
  process.env.DATABASE_URL_UNPOOLED = 'postgres://other:private@remote.example.invalid/production';
  try {
    await withLocal({}, async ({ handle, adapter, workdir }) => {
      const password = await readSecret(workdir);
      const probes = adapter.calls.filter(call => call.op === 'run' && basename(call.file) === 'psql');
      assert.ok(probes.length > 0);
      for (const probe of probes) assert.equal(probe.options.env.PGPASSWORD, password);
      await handle.runAcceptance(['node', '-e', 'process.exit(0)']);
      const child = adapter.calls.find(call => call.op === 'spawnChild');
      assert.equal(child.options.env.DATABASE_URL_UNPOOLED, handle.databaseUrl);
    });
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL_UNPOOLED;
    else process.env.DATABASE_URL_UNPOOLED = previous;
  }
});

test('start resumes a stopped kept context and refuses a live one', async () => {
  await withLocal({}, async ({ handle, adapter, workdir }) => {
    await assert.rejects(handle.start(), /already running/);
    await handle.stop({ keep: true });
    assert.equal(existsSync(workdir), true);
    assert.equal(adapter.pgRunning, false);

    const reopened = await openTaskPostgres({
      adapter,
      logger: () => {},
      workdir,
      startTimeoutMs: 500,
      pollMs: 50,
    });
    const started = await reopened.start();
    assert.equal(started.status, 'running');
    assert.equal(adapter.pgRunning, true);
    await reopened.stop();
    assert.equal(existsSync(workdir), false);
  });
});

test('a failing acceptance child propagates its exit code and still cleans the task cluster', async () => {
  await withLocal({ childResult: { code: 7, signal: null } }, async ({ handle, adapter, workdir }) => {
    const result = await handle.runAcceptance(['node', '-e', 'process.exit(7)']);
    assert.equal(result.code, 7);
    assert.equal(result.cleanupError, null);
    assert.equal(existsSync(workdir), false);
    assert.equal(adapter.pgRunning, false);
  });
});

test('SIGINT stops the child, removes the cluster and reports the signal exit code', async () => {
  await withLocal({ childResult: null }, async ({ handle, adapter, workdir }) => {
    const running = handle.runAcceptance(['node', '-e', 'setInterval(() => {}, 1000)']);
    assert.equal(adapter.calls.some(call => call.op === 'spawnChild'), true);
    adapter.emitSignal('SIGINT');
    const result = await running;
    assert.equal(result.code, 130);
    assert.equal(result.signal, 'SIGINT');
    assert.equal(existsSync(workdir), false);
    assert.equal(adapter.pgRunning, false);
    assert.equal(adapter.signals.size, 0);
    assert.equal(adapter.calls.some(call => call.op === 'kill' && call.signal === 'SIGTERM'), true);
  });
});

test('initdb failure is redacted, fails closed and removes the partial workdir', async () => {
  const root = await temporaryRoot();
  const workdir = join(root, `run-${RUN_LOCAL}`);
  let seenSecret = '';
  const adapter = makeAdapter({
    run: async ({ file, args }) => {
      if (basename(file) === 'initdb') {
        const passwordFile = args.find(argument => argument.startsWith('--pwfile=')).slice('--pwfile='.length);
        seenSecret = (await readFile(passwordFile, 'utf8')).trim();
        return { code: 1, signal: null, stdout: '', stderr: `initdb rejected password ${seenSecret}` };
      }
      return localRun({ file, args });
    },
  });
  try {
    await assert.rejects(
      createTaskPostgres({
        adapter,
        logger: () => {},
        root,
        label: 'local',
        runId: RUN_LOCAL,
        port: 55432,
        runtime: 'local',
        startTimeoutMs: 500,
        pollMs: 50,
      }),
      error => {
        assert.match(error.message, /initdb failed/);
        assert.equal(error.message.includes(seenSecret), false);
        assert.match(error.message, /\*\*\*/);
        return true;
      },
    );
    assert.notEqual(seenSecret, '');
    assert.equal(existsSync(workdir), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an existing workdir is never deleted or reused', async () => {
  const root = await temporaryRoot();
  const workdir = join(root, `run-${RUN_LOCAL}`);
  const marker = join(workdir, 'owner.txt');
  await mkdir(workdir);
  await writeFile(marker, 'not ours');
  const adapter = makeAdapter({});
  try {
    await assert.rejects(
      createTaskPostgres({
        adapter,
        logger: () => {},
        root,
        label: 'local',
        runId: RUN_LOCAL,
        port: 55432,
        runtime: 'local',
      }),
      /Refusing to reuse existing task workdir/,
    );
    assert.equal(existsSync(marker), true);
    assert.equal(adapter.calls.some(call => call.op === 'run' && basename(call.file) === 'initdb'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('docker fallback is explicit, labelled, password-free in argv and only removes its own container', async () => {
  const root = await temporaryRoot();
  const adapter = makeAdapter({ executables: { docker: '/usr/bin/docker' }, runId: RUN_DOCKER });
  const workdir = join(root, `run-${RUN_DOCKER}`);
  try {
    const handle = await createTaskPostgres({
      adapter,
      logger: () => {},
      root,
      label: 'docker',
      runId: RUN_DOCKER,
      port: 55433,
      runtime: 'auto',
      startTimeoutMs: 500,
      pollMs: 50,
    });
    assert.equal(handle.describe().runtime, 'docker');
    const password = await readSecret(workdir);
    const run = adapter.calls.find(call => call.op === 'run' && basename(call.file) === 'docker' && call.args[0] === 'run');
    assert.ok(run);
    assert.ok(run.args.includes('laundry.run=t01_docker_abcdef'));
    assert.ok(run.args.includes('laundry.task=p01'));
    assert.ok(run.args.includes('127.0.0.1:55433:5432'));
    assert.equal(run.args.includes(password), false);
    const envFile = run.args[run.args.indexOf('--env-file') + 1];
    assert.equal(envFile.startsWith(workdir + '/'), true);
    assert.equal(existsSync(envFile), false);
    assert.equal(logsIncludePassword(adapter, password), false);

    const result = await handle.runAcceptance(['node', '-e', 'process.exit(0)']);
    assert.equal(result.code, 0);
    const remove = adapter.calls.find(call => call.op === 'run' && basename(call.file) === 'docker' && call.args[0] === 'rm');
    assert.ok(remove);
    assert.equal(remove.args.includes('laundry-pg-t01-docker-abcdef'), true);
    assert.equal(adapter.containerExists, false);
    assert.equal(existsSync(workdir), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function logsIncludePassword(adapter, password) {
  return adapter.calls.some(call => {
    if (call.op !== 'run') return false;
    return JSON.stringify(call.args).includes(password);
  });
}

test('an existing container name is refused before any local workdir is created', async () => {
  const root = await temporaryRoot();
  const adapter = makeAdapter({ executables: { docker: '/usr/bin/docker' }, runId: RUN_DOCKER, containerExists: true });
  const workdir = join(root, `run-${RUN_DOCKER}`);
  try {
    await assert.rejects(
      createTaskPostgres({
        adapter,
        logger: () => {},
        root,
        label: 'docker',
        runId: RUN_DOCKER,
        port: 55433,
        runtime: 'docker',
      }),
      /Refusing to reuse or remove existing container/,
    );
    assert.equal(existsSync(workdir), false);
    assert.equal(adapter.calls.some(call => call.op === 'run' && call.args[0] === 'run'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stop refuses a container whose labels belong to another run and leaves it and the workdir intact', async () => {
  const root = await temporaryRoot();
  const adapter = makeAdapter({ executables: { docker: '/usr/bin/docker' }, runId: RUN_DOCKER });
  const workdir = join(root, `run-${RUN_DOCKER}`);
  try {
    const handle = await createTaskPostgres({
      adapter,
      logger: () => {},
      root,
      label: 'docker',
      runId: RUN_DOCKER,
      port: 55433,
      runtime: 'docker',
      startTimeoutMs: 500,
      pollMs: 50,
    });
    adapter.foreign = true;
    await assert.rejects(handle.stop(), /Refusing to use container/);
    assert.equal(adapter.calls.some(call => call.op === 'run' && call.args[0] === 'rm'), false);
    assert.equal(existsSync(workdir), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an explicit local runtime never falls back to docker and does not create a workdir', async () => {
  const root = await temporaryRoot();
  const adapter = makeAdapter({ executables: { docker: '/usr/bin/docker' } });
  const workdir = join(root, `run-${RUN_LOCAL}`);
  try {
    await assert.rejects(
      createTaskPostgres({
        adapter,
        logger: () => {},
        root,
        label: 'local',
        runId: RUN_LOCAL,
        port: 55432,
        runtime: 'local',
      }),
      /local PostgreSQL binaries missing/,
    );
    assert.equal(existsSync(workdir), false);
    assert.equal(adapter.calls.some(call => call.op === 'run' && call.args[0] === 'version'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI exec returns the child exit code and cleans its workdir', async () => {
  const root = await temporaryRoot();
  const adapter = makeAdapter({ childResult: { code: 9, signal: null } });
  const workdir = join(root, `run-${RUN_LOCAL}`);
  const stdout = { text: '', write(chunk) { this.text += chunk; } };
  const stderr = { text: '', write(chunk) { this.text += chunk; } };
  try {
    const code = await main([
      'exec',
      '--root', root,
      '--label', 'cli',
      '--run-id', RUN_LOCAL,
      '--port', '55432',
      '--runtime', 'local',
      '--',
      'node', '-e', 'process.exit(9)',
    ], { adapter, stdout, stderr });
    assert.equal(code, 9);
    assert.equal(existsSync(workdir), false);
    assert.match(stdout.text, /acceptance command exited 9/);
    assert.equal(stderr.text.includes('ab'.repeat(24)), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI interruption during provisioning waits for bounded setup then removes its owned cluster', async () => {
  const root = await temporaryRoot();
  const adapter = makeAdapter({ run: async input => {
    if (basename(input.file) === 'initdb') input.adapter.emitSignal('SIGTERM');
    return localRun(input);
  } });
  try {
    const code = await main(['exec', '--runtime', 'local', '--root', root, '--run-id', RUN_LOCAL, '--', 'node', '-e', 'process.exit(0)'], {
      adapter, stdout: { write() {} }, stderr: { write() {} }, logger() {},
    });
    assert.equal(code, 143);
    assert.equal(adapter.pgRunning, false);
    assert.equal(existsSync(join(root, `run-${RUN_LOCAL}`)), false);
    assert.equal(adapter.calls.some(call => call.op === 'spawnChild'), false);
    assert.equal(adapter.signals.size, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CLI rejects an unknown option with a failure exit', async () => {
  const adapter = makeAdapter({});
  const stdout = { text: '', write(chunk) { this.text += chunk; } };
  const stderr = { text: '', write(chunk) { this.text += chunk; } };
  const code = await main(['create', '--bogus', 'value'], { adapter, stdout, stderr });
  assert.equal(code, 1);
  assert.match(stderr.text, /Unknown option --bogus/);
  assert.equal(adapter.calls.length, 0);
});

test('invalid ports and unsafe docker image references are rejected before provisioning', async () => {
  const root = await temporaryRoot();
  const adapter = makeAdapter({});
  try {
    await assert.rejects(
      createTaskPostgres({ adapter, logger: () => {}, root, runId: RUN_LOCAL, port: 70000, runtime: 'local' }),
      /Port must be an integer/,
    );
    await assert.rejects(
      createTaskPostgres({
        adapter,
        logger: () => {},
        root,
        runId: RUN_LOCAL,
        port: 55432,
        runtime: 'local',
        dockerImage: 'registry.example.com/postgres:17',
      }),
      /Docker image must be/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
