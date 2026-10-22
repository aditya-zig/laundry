# Clean-workspace check ordering

Verified on 22 October 2026 with Node 24.20.0 and pnpm 10.33.2.
This is a build-workflow correction, not a production-readiness certificate.

## Reproduction and cause

A new isolated branch based on `145e05211e7f46c7fecf373a55c517457fe903bf` installed successfully using `pnpm install --frozen-lockfile --prefer-offline`.
Running the unchanged public `pnpm check` then exited 2.
The worker project could not resolve `@laundry/contracts`; the command executor also reported secondary implicit-any errors.
Building only `@laundry/contracts` before rerunning the unchanged check changed the result to exit 0.
The trigger is running the documented check after a fresh installation; previously generated contract declarations mask the missing prerequisite.

## Correction

The public `check` command now builds contract declarations before the root and recursive checks.
Shared contracts, API client, fixtures and design tokens explicitly expose their TypeScript checks, including test projects.
Build does not call check, so the prerequisite does not introduce a script cycle.
No typecheck or clean-tree evidence protection was disabled.

Five behavioral regressions exercise the actual public shell sequence using temporary compiler/package-manager stand-ins.
They verify prerequisite ordering, prerequisite failure, package-check failure, consumer-typecheck failure and inclusion of shared-package test projects.
All five failed before the correction and passed afterward.
These tests verify orchestration; actual compilation was checked separately.

## Executed verification

- Frozen-lockfile installation: exit 0.
- `pnpm check`: exit 0 after the correction, including API and worker consumers.
- `pnpm test:tooling`: 32 passed, zero skipped.
- `pnpm contracts:check`: exit 0.
- `EXPO_PUBLIC_API_URL=http://localhost:4100/v1 VITE_API_URL=http://localhost:4100/v1 pnpm build`: exit 0.
- `node tools/cloud/postgres.mjs exec --runtime docker --label direct-suite -- pnpm test`: exit 0, 584 tests passed against a new disposable PostgreSQL instance; the instance was removed afterward.

Clean committed-revision browser acceptance is a separate check and must retain its own evidence manifest.
Passing existing fixtures and legacy smoke tests does not prove production v2 handlers, native behavior, real providers, approved commercial settings or a physical fulfillment pilot.

## Public-site observation

Chrome inspection of the existing customer demo on 22 October still showed demo sign-in and a basket with dates fixed to 12 October.
The current source already uses a relative future schedule and labeled India-time fields.
Therefore the public demo is older than the implementation candidate; that observation is not evidence that the current source needs the same fix again.
Do not publish the candidate as production-ready merely to replace the old demo.
