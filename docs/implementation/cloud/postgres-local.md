# Task-local PostgreSQL for P01

Status: coordinator-reviewed and exercised on 22 October 2026. This document covers `tools/cloud/postgres.mjs`. Docker-backed local verification passed. Fresh cloud-runner and native acceptance remain unproved.

## Purpose

`tools/cloud/postgres.mjs` creates one disposable PostgreSQL instance per run for API and integration checks. It supports a local PostgreSQL installation through `initdb` and `pg_ctl`, with a Docker container fallback. The CLI keeps state in a task workdir so `create`, `start`, `stop` and `status` can run in separate processes.

Each run gets a unique workdir under the task root, a database named `laundry_verify_<run>`, a generated role, a random password and a free loopback port. The tool does not read `.env`, does not use root manifests, and does not print the password or the full URL.

## Commands

Local prerequisite: `initdb`, `pg_ctl` and `psql` on `PATH`, or a directory passed with `--bin-dir`. The invoking user must not be root. The cluster listens on `127.0.0.1` only, uses scram password auth on TCP and disables Unix sockets.

```sh
node tools/cloud/postgres.mjs create \
  --label p01_local \
  --root /tmp/opencode/laundry-pg \
  --json
```

The output includes `runId`, `workdir`, `database` and a redacted `url`. Start and stop a kept context:

```sh
node tools/cloud/postgres.mjs status --workdir /tmp/opencode/laundry-pg/run-p01_local-...
node tools/cloud/postgres.mjs stop --workdir /tmp/opencode/laundry-pg/run-p01_local-...
```

`stop --keep` stops PostgreSQL but keeps the workdir and data directory. A later `start --workdir ...` reuses that stopped context. A plain `stop` removes the cluster and the workdir.

Run one command with task-local `DATABASE_URL` and `DATABASE_URL_UNPOOLED` for its lifetime. `pnpm db:task` is an alias for the lifecycle CLI, and `pnpm test:isolated` provisions a task database for the workspace suite.

```sh
node tools/cloud/postgres.mjs exec \
  --label p01_api \
  --root /tmp/opencode/laundry-pg \
  -- pnpm --filter @laundry/api test
```

`exec` starts a fresh instance, supplies both application and migration URLs, removes inherited connection and service settings, then stops and removes the instance. It never lets a hosted `DATABASE_URL_UNPOOLED` reach the acceptance child. The child exit code is the CLI exit code. A failed child still triggers cleanup. SIGINT and SIGTERM forward `SIGTERM` to the child process group on Unix, clean up, and exit with 130 or 143. `--keep` leaves the instance running for debugging and deliberately skips cleanup.

Docker fallback:

```sh
node tools/cloud/postgres.mjs create \
  --label p01_docker \
  --runtime docker \
  --docker-image postgres:17-alpine \
  --root /tmp/opencode/laundry-pg \
  --json
```

With `--runtime auto`, the tool uses local PostgreSQL when `initdb`, `pg_ctl` and `psql` are all found. Otherwise it checks the Docker daemon. An explicit `--runtime local` never falls back to Docker. An explicit `--runtime docker` fails if the daemon is unavailable.

## Verification commands for the coordinator

The test file injects a process adapter at the public API boundary. It does not start PostgreSQL or Docker.

```sh
node --test tools/cloud/postgres.test.mjs
```

Run a real local instance and confirm the exit codes. Do not pipe these commands through another program that could hide the exit status.

```sh
node tools/cloud/postgres.mjs exec \
  --label p01_probe \
  --root /tmp/opencode/laundry-pg \
  -- node -e "const u = new URL(process.env.DATABASE_URL); console.log(u.hostname, u.port, u.pathname)"
```

Expected output: `127.0.0.1 <port> /laundry_verify_p01_probe_...`.

```sh
node tools/cloud/postgres.mjs exec \
  --label p01_fail \
  --root /tmp/opencode/laundry-pg \
  -- node -e "process.exit(7)"
```

Expected CLI exit: 7. The task workdir must be absent afterwards.

```sh
node tools/cloud/postgres.mjs exec \
  --label p01_signal \
  --root /tmp/opencode/laundry-pg \
  -- node -e "setInterval(() => {}, 1000)"
```

Press Ctrl-C. Expected CLI exit: 130. The task workdir must be absent and no PostgreSQL process for that workdir must remain.

Check for leaked task directories:

```sh
find /tmp/opencode/laundry-pg -maxdepth 1 -type d -name 'run-*'
```

The command should print nothing after clean runs. Inspect listeners with `ss -ltn` if you need to confirm a port was released.

Run the repository suites against a task database:

```sh
node tools/cloud/postgres.mjs exec \
  --label p01_repo \
  --root /tmp/opencode/laundry-pg \
  -- pnpm test
```

```sh
node tools/cloud/postgres.mjs exec \
  --label p01_contracts \
  --root /tmp/opencode/laundry-pg \
  -- pnpm contracts:check
```

`apps/api/test/pilot.test.ts` binds `127.0.0.1:4112`. `apps/api/test/v2-command-executor.test.ts` only requires a `laundry_verify_` database. Parallel API test runs on one host still collide on port 4112, so serialize those runs even though each has its own database.

## Safety properties

The tool creates only these resources: one workdir named `run-<runId>` under the task root, one local data directory and log file inside it, or one labelled Docker container, plus one database and role inside that instance. It never deletes a pre-existing workdir and never adopts a container without matching `laundry.run=<runId>` and `laundry.task=p01` labels. A mismatched label or container ID makes `stop` fail and leaves the resource alone.

Local configuration is written before start: loopback listen address, the allocated port, and `unix_socket_directories = ''`. The initdb password file is deleted after `initdb`. The Docker env file is mode 0600 and deleted after `docker run`. `secret.json` remains inside the 0700 workdir because later CLI invocations need it to build `DATABASE_URL`; it is never printed. The generated role name is also omitted from CLI output. Anyone who can read the workdir or query the Docker daemon can see the task credentials, so treat both as local trust boundaries.

All child processes use argument arrays with `shell: false`. Database names, roles, ports, container names and image tags are validated before use. No SQL or shell text is built from unvalidated input.

## Limitations

The root exposes `db:task` and `test:isolated`; `test:tooling` includes the lifecycle suite. CI integration and a fresh non-Docker cloud runner remain pending.

A port is chosen by binding and closing a loopback socket, then handed to PostgreSQL or Docker. Another process can take it in that gap. PostgreSQL then fails to start and the run cleans up, so the failure is closed, but the run must be retried.

A leftover Docker container whose name matches the requested run id makes `create` fail before it touches anything. Verify the `laundry.run` and `laundry.task` labels and remove that container yourself, or pick a new run id. A leftover workdir behaves the same way.

Local clusters use `initdb --locale=C --encoding=UTF8`. Operating system locale differences are not tested. Local PostgreSQL cannot run as root. NFS and unusual filesystem permissions are not covered.

Docker uses `postgres:17-alpine` by default and accepts any `postgres:<tag>` reference without a registry or digest. The tag is not digest-pinned and Docker may pull it from the network. The container data directory is a tmpfs, so stopping without removal loses data. Keep mode keeps the container but not its data.

The tool manages one runtime per workdir. It does not create multiple databases or roles for one cluster.

## Verification status

The worker could not execute its shell commands. Coordinator verification subsequently passed all 15 process-adapter tests and exercised the actual Docker runtime. The full workspace suite passed 584 tests on PostgreSQL 17 and the container/workdir were removed. A real child returning 7 propagated exit 7 with cleanup. Sending SIGINT to a real run returned 130, stopped both the acceptance process and its descendant, and removed the task container/workdir. A process-adapter regression also verifies interruption during provisioning, before any acceptance child exists. The CLI waits for bounded setup and removes the owned cluster instead of abandoning it. These are local Docker receipts, not fresh cloud or local-binary acceptance. No PostgreSQL local binaries were available on the coordinator host.
