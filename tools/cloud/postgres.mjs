#!/usr/bin/env node
import { execFile as execFileCallback, spawn as spawnCallback } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, appendFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, delimiter, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TASK_LABEL = 'laundry.task';
const TASK_VALUE = 'p01';
const RUN_LABEL = 'laundry.run';
const STATE_VERSION = 1;
const RUN_ID_RE = /^[a-z0-9][a-z0-9_]{5,47}$/;
const DATABASE_RE = /^laundry_verify_[a-z0-9_]{1,48}$/;
const USER_RE = /^laundry_[a-f0-9]{12,32}$/;
const CONTAINER_RE = /^laundry-pg-[a-z0-9][a-z0-9-]{0,47}$/;
const IMAGE_RE = /^postgres:[0-9][0-9A-Za-z._-]{0,63}$/;
const BINARY_NAMES = ['initdb', 'pg_ctl', 'psql'];
const RUNTIMES = ['auto', 'local', 'docker'];
const SIGNAL_CODES = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 };

function defaultLogger(line) {
  process.stderr.write(`[task-postgres] ${line}\n`);
}

function pathExists(file) {
  return lstat(file).then(() => true, error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
}

function assertPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer between 1 and 65535.');
  return port;
}

function assertRunId(value) {
  if (typeof value !== 'string' || !RUN_ID_RE.test(value)) throw new Error('Run id must match ^[a-z0-9][a-z0-9_]{5,47}$.');
  if (`laundry_verify_${value}`.length > 63) throw new Error('Run id is too long for a PostgreSQL database name.');
  return value;
}

function assertDatabase(value) {
  if (typeof value !== 'string' || !DATABASE_RE.test(value)) throw new Error('Refusing an invalid task database name.');
  return value;
}

function assertDatabaseUser(value) {
  if (typeof value !== 'string' || !USER_RE.test(value)) throw new Error('Refusing an invalid task database user.');
  return value;
}

function assertContainer(value) {
  if (typeof value !== 'string' || !CONTAINER_RE.test(value)) throw new Error('Refusing an invalid task container name.');
  return value;
}

function assertImage(value) {
  if (typeof value !== 'string' || !IMAGE_RE.test(value)) {
    throw new Error('Docker image must be a postgres:<tag> reference without a registry or digest.');
  }
  return value;
}

function normalizeLabel(value) {
  const label = String(value ?? 'task').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  if (!/^[a-z0-9][a-z0-9_]{0,23}$/.test(label)) throw new Error('Label must contain at least one letter or digit.');
  return label;
}

function defaultRunId(label, adapter) {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return assertRunId(`${label.slice(0, 20)}_${stamp}_${adapter.randomHex(4)}`);
}

function resolveRoot(value) {
  const root = resolve(value ?? process.env.LAUNDRY_PG_ROOT ?? join(tmpdir(), 'laundry-task-postgres'));
  if (root === sep || root.length < 5) throw new Error('Refusing an unsafe task root.');
  return root;
}

function assertInside(root, target, label) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (resolvedTarget === resolvedRoot || !resolvedTarget.startsWith(resolvedRoot + sep)) {
    throw new Error(`Refusing a ${label} outside the task root.`);
  }
  return resolvedTarget;
}

function signalNumber(signal) {
  return SIGNAL_CODES[signal] ?? 0;
}

function redactText(text, secrets) {
  let output = String(text ?? '');
  for (const secret of secrets) {
    if (secret) output = output.split(secret).join('***');
  }
  return output.replace(/postgres(?:ql)?:\/\/[^\s'"]+/g, 'postgres://***:***@redacted');
}

function short(text, limit = 600) {
  const value = String(text ?? '').trim();
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

async function writeJson(file, value) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

async function removeWorkdir(root, workdir) {
  const resolvedRoot = resolve(root);
  const resolvedWorkdir = resolve(workdir);
  if (resolvedWorkdir === resolvedRoot || !resolvedWorkdir.startsWith(resolvedRoot + sep)) {
    throw new Error('Refusing to remove a directory outside the task root.');
  }
  if (!basename(resolvedWorkdir).startsWith('run-')) throw new Error('Refusing to remove a directory not named run-<id>.');
  const stats = await lstat(resolvedWorkdir).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stats) return;
  if (stats.isSymbolicLink()) throw new Error('Refusing to remove a symlinked task workdir.');
  if (!stats.isDirectory()) throw new Error('Refusing to remove a non-directory task workdir.');
  await rm(resolvedWorkdir, { recursive: true, force: true, maxRetries: 3 });
}

export function createNodeProcessAdapter() {
  return {
    async findExecutable(name) {
      if (name.includes('/')) {
        try {
          await access(name, fsConstants.X_OK);
          return resolve(name);
        } catch {
          return null;
        }
      }
      for (const directory of String(process.env.PATH ?? '').split(delimiter)) {
        if (!directory) continue;
        const candidate = join(directory, name);
        try {
          await access(candidate, fsConstants.X_OK);
          return candidate;
        } catch {
          // Keep searching PATH.
        }
      }
      return null;
    },
    async exists(file) {
      try {
        await access(file, fsConstants.F_OK);
        return true;
      } catch {
        return false;
      }
    },
    run(file, args, options = {}) {
      return new Promise(done => {
        execFileCallback(
          file,
          args,
          {
            env: options.env ?? process.env,
            timeout: options.timeoutMs ?? 30_000,
            encoding: 'utf8',
            maxBuffer: 2 * 1024 * 1024,
            shell: false,
            windowsHide: true,
          },
          (error, stdout, stderr) => {
            const stderrText = typeof stderr === 'string' ? stderr : '';
            if (!error) {
              done({ code: 0, signal: null, stdout: stdout ?? '', stderr: stderrText });
              return;
            }
            const code = typeof error.code === 'number' ? error.code : (error.killed ? 124 : 127);
            done({ code, signal: error.signal ?? null, stdout: stdout ?? '', stderr: stderrText || error.message });
          },
        );
      });
    },
    spawnChild(file, args, options = {}) {
      let child;
      try {
        child = spawnCallback(file, args, {
          env: options.env ?? process.env,
          stdio: options.stdio ?? 'inherit',
          shell: false,
          detached: process.platform !== 'win32',
          windowsHide: true,
        });
      } catch (error) {
        return {
          child: { kill() {} },
          completed: Promise.resolve({ code: 127, signal: null, error: error.message }),
        };
      }
      const completed = new Promise(done => {
        child.once('error', error => done({ code: 127, signal: null, error: error.message }));
        child.once('close', (code, signal) => done({
          code: typeof code === 'number' ? code : null,
          signal: signal ?? null,
        }));
      });
      return {
        child: {
          kill(signal) {
            if (process.platform === 'win32') return child.kill(signal);
            if (!child.pid) return false;
            try { process.kill(-child.pid, signal); return true; }
            catch (error) { if (error.code !== 'ESRCH') throw error; return false; }
          },
        },
        completed,
      };
    },
    makePort() {
      return new Promise((done, fail) => {
        const server = createServer();
        server.unref();
        server.once('error', fail);
        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          const port = typeof address === 'object' && address ? address.port : 0;
          server.close(error => (error ? fail(error) : done(port)));
        });
      });
    },
    sleep(milliseconds) {
      return new Promise(done => setTimeout(done, milliseconds));
    },
    randomHex(bytes) {
      return randomBytes(bytes).toString('hex');
    },
    onSignal(signal, handler) {
      process.once(signal, handler);
    },
    offSignal(signal, handler) {
      process.off(signal, handler);
    },
  };
}

async function detectLocalBinaries(adapter, binDirectory) {
  const found = {};
  const missing = [];
  for (const name of BINARY_NAMES) {
    const candidate = binDirectory ? join(resolve(binDirectory), name) : await adapter.findExecutable(name);
    if (candidate && await adapter.exists(candidate)) found[name] = candidate;
    else missing.push(name);
  }
  return missing.length ? { missing } : { binaries: found };
}

async function detectDocker(adapter) {
  const docker = await adapter.findExecutable('docker');
  if (!docker) return { available: false, reason: 'docker was not found on PATH' };
  const version = await adapter.run(docker, ['version', '--format', '{{.Server.Version}}'], {
    timeoutMs: 20_000,
    env: { ...process.env },
  });
  if (version.code !== 0) {
    return { available: false, reason: `docker daemon check exited ${version.code}: ${short(version.stderr, 200)}` };
  }
  return { available: true, docker, version: version.stdout.trim() };
}

async function detectRuntime({ adapter, runtime, binDirectory }) {
  const wanted = runtime ?? 'auto';
  if (!RUNTIMES.includes(wanted)) throw new Error(`Runtime must be one of ${RUNTIMES.join(', ')}.`);
  let localReason = '';
  if (wanted === 'local' || wanted === 'auto') {
    const local = await detectLocalBinaries(adapter, binDirectory);
    if (local.binaries) return { kind: 'local', binaries: local.binaries };
    localReason = `local PostgreSQL binaries missing: ${local.missing.join(', ')}`;
    if (wanted === 'local') {
      throw new Error(`${localReason}. Install postgresql-client and postgresql, or pass --bin-dir pointing at initdb, pg_ctl and psql.`);
    }
  }
  if (wanted === 'docker' || wanted === 'auto') {
    const docker = await detectDocker(adapter);
    if (docker.available) return { kind: 'docker', docker: docker.docker, dockerVersion: docker.version };
    if (wanted === 'docker') throw new Error(`Docker runtime requested but unavailable: ${docker.reason}.`);
    throw new Error(`No PostgreSQL runtime available. ${localReason}; ${docker.reason}.`);
  }
  throw new Error('No PostgreSQL runtime available.');
}

export class TaskPostgres {
  #adapter;
  #logger;
  #state;
  #secret;
  #options;
  #stopped = false;
  #removed = false;

  constructor({ adapter, logger, state, secret, options = {} }) {
    this.#adapter = adapter;
    this.#logger = logger ?? defaultLogger;
    this.#state = state;
    this.#secret = secret;
    this.#options = {
      startTimeoutMs: options.startTimeoutMs ?? 30_000,
      pollMs: options.pollMs ?? 250,
      killGraceMs: options.killGraceMs ?? 5_000,
    };
  }

  static async create(options = {}) {
    const adapter = options.adapter ?? createNodeProcessAdapter();
    const logger = options.logger ?? defaultLogger;
    const root = resolveRoot(options.root);
    const label = normalizeLabel(options.label);
    const runId = options.runId ? assertRunId(options.runId) : defaultRunId(label, adapter);
    const port = options.port == null || Number(options.port) === 0
      ? await adapter.makePort()
      : assertPort(options.port);
    const dockerImage = assertImage(options.dockerImage ?? 'postgres:17-alpine');
    const runtime = await detectRuntime({
      adapter,
      runtime: options.runtime,
      binDirectory: options.binDir,
    });
    const database = assertDatabase(`laundry_verify_${runId}`);
    const databaseUser = assertDatabaseUser(`laundry_${adapter.randomHex(6)}`);
    const container = assertContainer(`laundry-pg-${runId.replaceAll('_', '-')}`);

    await mkdir(root, { recursive: true, mode: 0o700 });
    const workdir = join(root, `run-${runId}`);
    if (await pathExists(workdir)) {
      throw new Error(`Refusing to reuse existing task workdir ${workdir}. Use a new run id or remove it yourself.`);
    }

    if (runtime.kind === 'docker') {
      const docker = runtime.docker;
      const inspect = await adapter.run(docker, ['inspect', '--type', 'container', container], {
        timeoutMs: 15_000,
        env: { ...process.env },
      });
      if (inspect.code === 0) {
        throw new Error(`Refusing to reuse or remove existing container ${container}. Choose a new run id.`);
      }
      if (!/no such (object|container)/i.test(inspect.stderr)) {
        throw new Error(`Could not prove container ${container} is absent (exit ${inspect.code}): ${short(inspect.stderr)}`);
      }
    }

    await mkdir(workdir, { mode: 0o700 });
    let instance = null;
    try {
      const password = adapter.randomHex(24);
      if (!/^[a-f0-9]{32,128}$/.test(password)) throw new Error('Process adapter returned an invalid secret.');
      const secret = { password };
      const now = new Date().toISOString();
      const state = {
        version: STATE_VERSION,
        runId,
        label,
        runtime: runtime.kind,
        status: 'preparing',
        root,
        workdir,
        port,
        database,
        user: databaseUser,
        dataDir: runtime.kind === 'local' ? join(workdir, 'data') : null,
        logFile: runtime.kind === 'local' ? join(workdir, 'postgres.log') : null,
        container: runtime.kind === 'docker' ? container : null,
        containerId: null,
        containerCreated: false,
        docker: runtime.kind === 'docker' ? runtime.docker : null,
        dockerVersion: runtime.kind === 'docker' ? runtime.dockerVersion : null,
        dockerImage: runtime.kind === 'docker' ? dockerImage : null,
        binaries: runtime.kind === 'local' ? runtime.binaries : null,
        initialized: false,
        databasePrepared: false,
        createdAt: now,
        updatedAt: now,
      };

      await writeFile(join(workdir, 'secret.json'), `${JSON.stringify(secret)}\n`, { mode: 0o600 });
      await writeJson(join(workdir, 'state.json'), state);

      instance = new TaskPostgres({
        adapter,
        logger,
        state,
        secret,
        options: {
          startTimeoutMs: options.startTimeoutMs,
          pollMs: options.pollMs,
          killGraceMs: options.killGraceMs,
        },
      });
      await instance.start();
      return instance;
    } catch (error) {
      if (instance) {
        try {
          await instance.stop({ keep: false });
        } catch (cleanupError) {
          logger(`cleanup after failed start also failed: ${instance.#redact(cleanupError.message)}`);
        }
      } else {
        try {
          await removeWorkdir(root, workdir);
        } catch (cleanupError) {
          logger(`cleanup after failed provisioning also failed: ${short(cleanupError.message)}`);
        }
      }
      throw error;
    }
  }

  static async open(options = {}) {
    const adapter = options.adapter ?? createNodeProcessAdapter();
    const logger = options.logger ?? defaultLogger;
    if (!options.workdir) throw new Error('An explicit --workdir is required.');
    const workdir = resolve(options.workdir);
    let state;
    try {
      state = JSON.parse(await readFile(join(workdir, 'state.json'), 'utf8'));
    } catch {
      throw new Error(`No readable task state in ${workdir}.`);
    }
    if (state.version !== STATE_VERSION) throw new Error('Unsupported task state version.');
    const runId = assertRunId(state.runId);
    const root = resolve(state.root);
    const expected = join(root, `run-${runId}`);
    if (resolve(state.workdir) !== expected || workdir !== expected) {
      throw new Error('Task state does not describe this workdir.');
    }
    assertPort(state.port);
    assertDatabase(state.database);
    assertDatabaseUser(state.user);
    if (!['local', 'docker'].includes(state.runtime)) throw new Error('Task state has an invalid runtime.');
    if (!['preparing', 'running', 'stopped'].includes(state.status)) throw new Error('Task state has an invalid status.');
    if (state.runtime === 'local') {
      assertInside(workdir, state.dataDir, 'data directory');
      assertInside(workdir, state.logFile, 'log file');
      if (!state.binaries) throw new Error('Task state is missing local PostgreSQL binary paths.');
    } else {
      assertContainer(state.container);
      assertImage(state.dockerImage);
    }
    let secret;
    try {
      secret = JSON.parse(await readFile(join(workdir, 'secret.json'), 'utf8'));
    } catch {
      throw new Error(`No readable task secret in ${workdir}.`);
    }
    if (typeof secret.password !== 'string' || !/^[a-f0-9]{32,128}$/.test(secret.password)) {
      throw new Error('Task secret is invalid.');
    }
    return new TaskPostgres({
      adapter,
      logger,
      state,
      secret,
      options: {
        startTimeoutMs: options.startTimeoutMs,
        pollMs: options.pollMs,
        killGraceMs: options.killGraceMs,
      },
    });
  }

  get runId() {
    return this.#state.runId;
  }

  get workdir() {
    return this.#state.workdir;
  }

  get port() {
    return this.#state.port;
  }

  get databaseUrl() {
    const user = encodeURIComponent(this.#state.user);
    const password = encodeURIComponent(this.#secret.password);
    return `postgres://${user}:${password}@127.0.0.1:${this.#state.port}/${this.#state.database}`;
  }

  get redactedUrl() {
    return `postgres://***:***@127.0.0.1:${this.#state.port}/${this.#state.database}`;
  }

  describe() {
    return {
      runId: this.#state.runId,
      label: this.#state.label,
      runtime: this.#state.runtime,
      status: this.#state.status,
      workdir: this.#state.workdir,
      root: this.#state.root,
      port: this.#state.port,
      database: this.#state.database,
      url: this.redactedUrl,
      container: this.#state.container,
      createdAt: this.#state.createdAt,
      updatedAt: this.#state.updatedAt,
    };
  }

  async status() {
    const running = await this.#runtimeRunning();
    return { ...this.describe(), running };
  }

  async start() {
    if (this.#removed) throw new Error('This task context was removed.');
    if (this.#state.status === 'running') {
      const running = await this.#runtimeRunning();
      if (running) {
        throw new Error('The task database is already running. Refusing to reuse a live resource; stop it first.');
      }
    }
    await this.#startRuntime();
    this.#stopped = false;
    this.#state.status = 'running';
    await this.#persistState();
    this.#logger(`task PostgreSQL is running on 127.0.0.1:${this.#state.port} using ${this.#state.runtime}`);
    return this.describe();
  }

  async stop({ keep = false } = {}) {
    if (this.#removed) return this.describe();
    if (this.#state.runtime === 'local') await this.#stopLocal();
    else await this.#stopDocker({ keep });
    this.#stopped = true;
    this.#state.status = 'stopped';
    await this.#persistState();
    if (keep) {
      this.#logger(`task PostgreSQL stopped; kept workdir ${this.#state.workdir}`);
      return this.describe();
    }
    await removeWorkdir(this.#state.root, this.#state.workdir);
    this.#removed = true;
    this.#logger(`removed task workdir ${this.#state.workdir}`);
    return this.describe();
  }

  async runAcceptance(argv, options = {}) {
    if (!Array.isArray(argv) || !argv.length || typeof argv[0] !== 'string' || !argv[0]) {
      throw new Error('An acceptance command is required after --.');
    }
    if (this.#stopped) throw new Error('This task context is stopped.');
    if (this.#state.status !== 'running') await this.start();

    const child = (() => {
      try {
        return this.#adapter.spawnChild(argv[0], argv.slice(1), {
          env: this.#commandEnv(options.env),
          stdio: options.stdio ?? 'inherit',
        });
      } catch (error) {
        return { child: { kill() {} }, completed: Promise.reject(error) };
      }
    })();
    let signalled = null;
    let settled = false;
    const signals = ['SIGINT', 'SIGTERM'];
    const handler = signal => {
      if (signalled) return;
      signalled = signal;
      try {
        child.child.kill('SIGTERM');
      } catch {
        // The child may already be gone.
      }
      this.#adapter.sleep(this.#options.killGraceMs).then(() => {
        if (settled) return;
        try {
          child.child.kill('SIGKILL');
        } catch {
          // The child may already be gone.
        }
      }).catch(() => {});
    };
    const handlers = new Map(signals.map(signal => [signal, () => handler(signal)]));
    for (const [signal, callback] of handlers) this.#adapter.onSignal(signal, callback);
    let outcome;
    let childError = null;
    try {
      outcome = await child.completed;
    } catch (error) {
      childError = error;
    } finally {
      settled = true;
      for (const [signal, callback] of handlers) this.#adapter.offSignal(signal, callback);
    }
    if (childError) {
      try {
        await this.stop({ keep: false });
      } catch (error) {
        this.#logger(`cleanup failed after spawn error: ${this.#redact(error.message)}`);
      }
      throw childError;
    }

    const childCode = typeof outcome.code === 'number' ? outcome.code : null;
    let code = signalled
      ? 128 + signalNumber(signalled)
      : (childCode ?? (outcome.signal ? 128 + signalNumber(outcome.signal) : 1));
    let cleanupError = null;
    try {
      await this.stop({ keep: signalled ? false : Boolean(options.keep) });
    } catch (error) {
      cleanupError = error;
      this.#logger(`cleanup failed after acceptance command: ${this.#redact(error.message)}`);
      if (code === 0) code = 1;
    }
    return { code, signal: signalled ?? outcome.signal ?? null, cleanupError };
  }

  async #persistState() {
    this.#state.updatedAt = new Date().toISOString();
    await writeJson(join(this.#state.workdir, 'state.json'), this.#state);
  }

  #redact(text) {
    return redactText(text, [this.#secret.password, this.databaseUrl]);
  }

  #toolEnv(extra = {}) {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    delete env.DATABASE_URL_UNPOOLED;
    delete env.DIRECT_URL;
    delete env.PGSERVICE;
    delete env.PGSERVICEFILE;
    delete env.PGDATABASE;
    delete env.PGHOST;
    delete env.PGPORT;
    delete env.PGUSER;
    delete env.PGPASSWORD;
    return { ...env, ...extra };
  }

  #commandEnv(extra = {}) {
    const env = this.#toolEnv(extra);
    for (const name of ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSERVICE', 'PGSERVICEFILE', 'DIRECT_URL']) delete env[name];
    env.DATABASE_URL = this.databaseUrl;
    env.DATABASE_URL_UNPOOLED = this.databaseUrl;
    env.PGCONNECT_TIMEOUT ??= '10';
    return env;
  }

  #commandError(action, result) {
    const detail = short(this.#redact(result.stderr || result.stdout));
    return new Error(`${action} failed with exit ${result.code}${detail ? `: ${detail}` : ''}`);
  }

  async #waitFor(label, check) {
    const timeout = this.#options.startTimeoutMs;
    const poll = this.#options.pollMs;
    const attempts = Math.max(1, Math.ceil(timeout / poll));
    let last = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      last = await check();
      if (last.ok) return;
      if (attempt < attempts - 1) await this.#adapter.sleep(poll);
    }
    const detail = short(this.#redact(last?.detail ?? ''));
    throw new Error(`${label} did not become ready within ${timeout}ms${detail ? `: ${detail}` : ''}`);
  }

  async #startRuntime() {
    if (this.#state.runtime === 'local') {
      if (!this.#state.initialized) await this.#initLocal();
      await this.#startLocal();
      await this.#ensureLocalDatabase();
      this.#state.initialized = true;
      await this.#persistState();
      return;
    }
    if (!this.#state.containerCreated) await this.#dockerCreate();
    else await this.#dockerStartExisting();
    await this.#waitDockerDatabase();
    this.#state.initialized = true;
    await this.#persistState();
  }

  async #initLocal() {
    const { initdb } = this.#state.binaries;
    const { dataDir, user, port } = this.#state;
    const passwordFile = join(this.#state.workdir, 'initdb-password');
    await writeFile(passwordFile, `${this.#secret.password}\n`, { mode: 0o600 });
    try {
      const result = await this.#adapter.run(initdb, [
        '-D', dataDir,
        '-U', user,
        `--pwfile=${passwordFile}`,
        '--auth-local=trust',
        '--auth-host=scram-sha-256',
        '--encoding=UTF8',
        '--locale=C',
      ], {
        env: this.#toolEnv(),
        timeoutMs: Math.max(this.#options.startTimeoutMs, 60_000),
      });
      if (result.code !== 0) throw this.#commandError('initdb', result);
    } finally {
      await rm(passwordFile, { force: true }).catch(() => {});
    }
    if (!await pathExists(dataDir)) throw new Error('initdb did not create a data directory.');
    await appendFile(join(dataDir, 'postgresql.conf'), [
      '',
      '# Laundry task-only cluster: loopback TCP, no shared Unix socket.',
      "listen_addresses = '127.0.0.1'",
      `port = ${assertPort(port)}`,
      "unix_socket_directories = ''",
      '',
    ].join('\n'), { encoding: 'utf8', mode: 0o600 });
    this.#state.initialized = true;
    await this.#persistState();
  }

  async #startLocal() {
    if (!await pathExists(this.#state.dataDir)) throw new Error('The task data directory is missing; create a new task context.');
    const seconds = Math.max(5, Math.ceil(this.#options.startTimeoutMs / 1000));
    const result = await this.#adapter.run(this.#state.binaries.pg_ctl, [
      '-D', this.#state.dataDir,
      '-l', this.#state.logFile,
      '-w',
      '-t', String(seconds),
      'start',
    ], {
      env: this.#toolEnv(),
      timeoutMs: this.#options.startTimeoutMs + 15_000,
    });
    if (result.code !== 0) throw this.#commandError('pg_ctl start', result);
  }

  async #localPsql(database, command, extra = []) {
    return this.#adapter.run(this.#state.binaries.psql, [
      '-h', '127.0.0.1',
      '-p', String(this.#state.port),
      '-U', this.#state.user,
      '-d', database,
      '--no-psqlrc',
      '--set', 'ON_ERROR_STOP=1',
      ...extra,
      '--command', command,
    ], {
      env: this.#toolEnv({ PGPASSWORD: this.#secret.password, PGCONNECT_TIMEOUT: '5' }),
      timeoutMs: 15_000,
    });
  }

  async #ensureLocalDatabase() {
    await this.#waitFor('local PostgreSQL', async () => {
      const result = await this.#localPsql('postgres', 'SELECT 1', ['--tuples-only']);
      return { ok: result.code === 0 && result.stdout.trim() === '1', detail: result.stderr || result.stdout };
    });
    if (!this.#state.databasePrepared) {
      const created = await this.#localPsql('postgres', `CREATE DATABASE "${assertDatabase(this.#state.database)}"`);
      if (created.code !== 0) throw this.#commandError('CREATE DATABASE', created);
      this.#state.databasePrepared = true;
      await this.#persistState();
    }
    const verified = await this.#localPsql(this.#state.database, 'SELECT 1', ['--tuples-only']);
    if (verified.code !== 0 || verified.stdout.trim() !== '1') throw this.#commandError('database verification', verified);
  }

  async #stopLocal() {
    const status = await this.#adapter.run(this.#state.binaries.pg_ctl, ['-D', this.#state.dataDir, 'status'], {
      env: this.#toolEnv(),
      timeoutMs: 15_000,
    });
    if (status.code === 3 || !await pathExists(this.#state.dataDir)) return;
    if (status.code !== 0) throw this.#commandError('pg_ctl status before cleanup', status);
    const stopped = await this.#adapter.run(this.#state.binaries.pg_ctl, [
      '-D', this.#state.dataDir,
      '-m', 'fast',
      '-w',
      '-t', '20',
      'stop',
    ], {
      env: this.#toolEnv(),
      timeoutMs: 25_000,
    });
    if (stopped.code !== 0) throw this.#commandError('pg_ctl stop', stopped);
    const after = await this.#adapter.run(this.#state.binaries.pg_ctl, ['-D', this.#state.dataDir, 'status'], {
      env: this.#toolEnv(),
      timeoutMs: 15_000,
    });
    if (after.code !== 3) throw new Error('Refusing to remove a local cluster without proof that it stopped.');
  }

  async #inspectDocker() {
    const result = await this.#adapter.run(this.#state.docker, [
      'inspect',
      '--type', 'container',
      '--format', '{{.Id}}|{{.State.Running}}|{{index .Config.Labels "laundry.run"}}|{{index .Config.Labels "laundry.task"}}',
      this.#state.container,
    ], {
      env: this.#toolEnv(),
      timeoutMs: 15_000,
    });
    if (result.code !== 0) {
      if (/no such (object|container)/i.test(result.stderr)) return null;
      throw new Error(`Could not inspect task container ${this.#state.container} (exit ${result.code}): ${short(this.#redact(result.stderr))}`);
    }
    const [id, running, run, task] = result.stdout.trim().split('|');
    return { id, running: running === 'true', run, task };
  }

  #assertOwnedContainer(info) {
    if (info.run !== this.#state.runId || info.task !== TASK_VALUE) {
      throw new Error(`Refusing to use container ${this.#state.container}: ownership labels do not match this run.`);
    }
    if (this.#state.containerId && !(info.id.startsWith(this.#state.containerId) || this.#state.containerId.startsWith(info.id))) {
      throw new Error(`Refusing to use container ${this.#state.container}: container id does not match this run.`);
    }
  }

  async #dockerCreate() {
    const { docker, dockerImage, container, runId, port, user, database } = this.#state;
    const envFile = join(this.#state.workdir, 'docker-env.txt');
    await writeFile(envFile, [
      `POSTGRES_PASSWORD=${this.#secret.password}`,
      `POSTGRES_USER=${user}`,
      `POSTGRES_DB=${database}`,
      '',
    ].join('\n'), { mode: 0o600 });
    try {
      const result = await this.#adapter.run(docker, [
        'run',
        '--detach',
        '--name', container,
        '--label', `${TASK_LABEL}=${TASK_VALUE}`,
        '--label', `${RUN_LABEL}=${runId}`,
        '--publish', `127.0.0.1:${port}:5432`,
        '--env-file', envFile,
        '--tmpfs', '/var/lib/postgresql/data',
        '--env', 'PGDATA=/var/lib/postgresql/data',
        dockerImage,
      ], {
        env: this.#toolEnv(),
        timeoutMs: 120_000,
      });
      if (result.code !== 0) {
        const owned = await this.#inspectDocker().catch(() => null);
        if (owned && owned.run === runId && owned.task === TASK_VALUE) {
          this.#state.containerCreated = true;
          await this.#persistState();
        }
        throw this.#commandError('docker run', result);
      }
      this.#state.containerCreated = true;
      const id = result.stdout.trim().split(/\s+/)[0];
      this.#state.containerId = /^[a-f0-9]{12,64}$/.test(id) ? id : null;
      this.#state.initialized = true;
      await this.#persistState();
    } finally {
      await rm(envFile, { force: true }).catch(() => {});
    }
  }

  async #dockerStartExisting() {
    const info = await this.#inspectDocker();
    if (!info) throw new Error('The task container no longer exists; create a new task context.');
    this.#assertOwnedContainer(info);
    if (info.running) return;
    const result = await this.#adapter.run(this.#state.docker, ['start', this.#state.container], {
      env: this.#toolEnv(),
      timeoutMs: 60_000,
    });
    if (result.code !== 0) throw this.#commandError('docker start', result);
  }

  async #waitDockerDatabase() {
    await this.#waitFor('container PostgreSQL', async () => {
      const result = await this.#adapter.run(this.#state.docker, [
        'exec', this.#state.container,
        'psql',
        '--username', this.#state.user,
        '--dbname', this.#state.database,
        '--no-psqlrc',
        '--tuples-only',
        '--set', 'ON_ERROR_STOP=1',
        '--command', 'SELECT 1',
      ], {
        env: this.#toolEnv(),
        timeoutMs: 15_000,
      });
      return { ok: result.code === 0 && result.stdout.trim() === '1', detail: result.stderr || result.stdout };
    });
  }

  async #stopDocker({ keep }) {
    if (!this.#state.containerCreated) return;
    const info = await this.#inspectDocker();
    if (!info) return;
    this.#assertOwnedContainer(info);
    const args = keep
      ? ['stop', '--time', '10', this.#state.container]
      : ['rm', '--force', this.#state.container];
    const result = await this.#adapter.run(this.#state.docker, args, {
      env: this.#toolEnv(),
      timeoutMs: 60_000,
    });
    if (result.code !== 0) throw this.#commandError(`docker ${args[0]}`, result);
  }

  async #runtimeRunning() {
    if (this.#state.runtime === 'local') {
      if (!await pathExists(this.#state.dataDir)) return false;
      const result = await this.#adapter.run(this.#state.binaries.pg_ctl, ['-D', this.#state.dataDir, 'status'], {
        env: this.#toolEnv(),
        timeoutMs: 15_000,
      });
      return result.code === 0;
    }
    if (!this.#state.containerCreated) return false;
    const info = await this.#inspectDocker();
    if (!info) return false;
    this.#assertOwnedContainer(info);
    return info.running;
  }
}

export async function createTaskPostgres(options = {}) {
  return TaskPostgres.create(options);
}

export async function openTaskPostgres(options = {}) {
  return TaskPostgres.open(options);
}

function optionalInteger(value, name, minimum, maximum) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(String(value))) throw new Error(`${name} must be an integer.`);
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

export function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') return { command: 'help' };
  const known = ['create', 'start', 'stop', 'status', 'exec'];
  if (!known.includes(command)) throw new Error(`Unknown command ${command}. Use create, start, stop, status or exec.`);
  const options = {};
  const commandArguments = [];
  const values = {
    label: 'label',
    runtime: 'runtime',
    port: 'port',
    root: 'root',
    'run-id': 'runId',
    'bin-dir': 'binDir',
    'docker-image': 'dockerImage',
    'start-timeout': 'startTimeout',
    workdir: 'workdir',
  };
  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index];
    if (argument === '--') {
      commandArguments.push(...rest.slice(index + 1));
      break;
    }
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (argument === '--keep') {
      options.keep = true;
      continue;
    }
    if (argument.startsWith('--')) {
      const key = argument.slice(2);
      const name = values[key];
      if (!name) throw new Error(`Unknown option --${key}.`);
      const value = rest[++index];
      if (value === undefined || value.startsWith('--')) throw new Error(`Option --${key} needs a value.`);
      options[name] = value;
      continue;
    }
    throw new Error(`Unexpected argument ${argument}.`);
  }
  if (['start', 'stop', 'status'].includes(command) && !options.workdir) {
    throw new Error(`${command} requires --workdir <path>.`);
  }
  if (command === 'exec' && !commandArguments.length) {
    throw new Error('exec requires an acceptance command after --.');
  }
  if (options.runtime && !RUNTIMES.includes(options.runtime)) throw new Error('--runtime must be auto, local or docker.');
  options.port = optionalInteger(options.port, '--port', 0, 65535);
  options.startTimeout = optionalInteger(options.startTimeout, '--start-timeout', 100, 600_000);
  return { command, options, commandArguments };
}

function usage() {
  return [
    'Task-only PostgreSQL lifecycle for one run. It never reads .env and never prints credentials.',
    '',
    '  node tools/cloud/postgres.mjs create [--label L] [--runtime auto|local|docker] [--port N]',
    '      [--root DIR] [--run-id ID] [--bin-dir DIR] [--docker-image postgres:17-alpine]',
    '      [--start-timeout MS] [--json]',
    '  node tools/cloud/postgres.mjs exec [create options] [--keep] -- <command> [args...]',
    '  node tools/cloud/postgres.mjs start --workdir DIR [--json]',
    '  node tools/cloud/postgres.mjs stop --workdir DIR [--keep] [--json]',
    '  node tools/cloud/postgres.mjs status --workdir DIR [--json]',
    '',
  ].join('\n');
}

function printDescription(stream, handle, options) {
  const description = handle.describe();
  if (options.json) {
    stream.write(`${JSON.stringify(description, null, 2)}\n`);
    return;
  }
  stream.write(`run: ${description.runId}\n`);
  stream.write(`runtime: ${description.runtime}\n`);
  stream.write(`workdir: ${description.workdir}\n`);
  stream.write(`url: ${description.url}\n`);
  stream.write(`status: ${description.status}\n`);
}

export async function main(argv = process.argv.slice(2), overrides = {}) {
  const stdout = overrides.stdout ?? process.stdout;
  const stderr = overrides.stderr ?? process.stderr;
  const adapter = overrides.adapter ?? createNodeProcessAdapter();
  const logger = overrides.logger ?? (line => stderr.write(`[task-postgres] ${line}\n`));
  let parsed;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    stderr.write(`postgres lifecycle: ${error.message}\n`);
    return 1;
  }
  if (parsed.command === 'help') {
    stdout.write(usage());
    return 0;
  }
  const { options, commandArguments } = parsed;
  let pendingSignal = null;
  const handlers = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, () => { pendingSignal ??= signal; }]));
  for (const [signal, callback] of handlers) adapter.onSignal(signal, callback);
  const cancelProvisioning = async handle => {
    if (!pendingSignal) return null;
    await handle.stop({ keep: false });
    return 128 + signalNumber(pendingSignal);
  };
  try {
    if (parsed.command === 'create') {
      const handle = await TaskPostgres.create({
        adapter,
        logger,
        label: options.label,
        runtime: options.runtime,
        port: options.port,
        root: options.root,
        runId: options.runId,
        binDir: options.binDir,
        dockerImage: options.dockerImage,
        startTimeoutMs: options.startTimeout,
      });
      const interrupted = await cancelProvisioning(handle);
      if (interrupted !== null) return interrupted;
      printDescription(stdout, handle, options);
      return 0;
    }
    if (parsed.command === 'exec') {
      const handle = await TaskPostgres.create({
        adapter,
        logger,
        label: options.label,
        runtime: options.runtime,
        port: options.port,
        root: options.root,
        runId: options.runId,
        binDir: options.binDir,
        dockerImage: options.dockerImage,
        startTimeoutMs: options.startTimeout,
      });
      const interrupted = await cancelProvisioning(handle);
      if (interrupted !== null) return interrupted;
      printDescription(stdout, handle, options);
      try {
        const result = await handle.runAcceptance(commandArguments, { keep: Boolean(options.keep) });
        stdout.write(`acceptance command exited ${result.code}${result.signal ? ` (${result.signal})` : ''}\n`);
        if (result.cleanupError) stderr.write(`postgres lifecycle: cleanup failed: ${result.cleanupError.message}\n`);
        return result.code;
      } catch (error) {
        try {
          await handle.stop({ keep: false });
        } catch (cleanupError) {
          stderr.write(`postgres lifecycle: cleanup failed: ${cleanupError.message}\n`);
        }
        throw error;
      }
    }
    const handle = await TaskPostgres.open({
      adapter,
      logger,
      workdir: options.workdir,
      startTimeoutMs: options.startTimeout,
    });
    if (parsed.command === 'start') {
      await handle.start();
      printDescription(stdout, handle, options);
      return 0;
    }
    if (parsed.command === 'stop') {
      await handle.stop({ keep: Boolean(options.keep) });
      printDescription(stdout, handle, options);
      return 0;
    }
    const status = await handle.status();
    if (options.json) stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    else {
      printDescription(stdout, handle, options);
      stdout.write(`running: ${status.running}\n`);
    }
    return 0;
  } catch (error) {
    stderr.write(`postgres lifecycle: ${redactText(error.message, [])}\n`);
    return pendingSignal ? 128 + signalNumber(pendingSignal) : 1;
  } finally {
    for (const [signal, callback] of handlers) adapter.offSignal(signal, callback);
  }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then(code => {
    process.exitCode = code;
  }).catch(error => {
    process.stderr.write(`postgres lifecycle: ${error.message}\n`);
    process.exitCode = 1;
  });
}
