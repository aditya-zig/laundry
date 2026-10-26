# Day 1 execution checkpoint — 26 October 2026

Scope: founder-directed [3-day production / 5- and 10-day parity plan](3-5-10-day-recovery-plan.md). This checkpoint records actual work, not production approval. Live ordering remains subject to #28.

## Source of truth and branch cleanup

`main` was created from the integrated `eb536d90e44867a15538c51e27e03cb42f7e9d57` history and made GitHub's default. No history reset or rewritten commit. Previously integration work advanced on `cloud/batch-20261025-01` while the default still pointed elsewhere; there was no enforced main-integration convention. Main now represents integrated source, not every unverified experiment.

PR #1 and #2 now target `main`. Existing stacked PR #3/#4 remain unchanged because their parent branches contain unique work. A source push runs checks; it is not permission to activate ordering or production providers.

Seven remote branches, and their six matching local branches where present, were removed after checking ancestry against main, PR heads/bases and checked-out worktrees. Each has an annotated snapshot tag with the same name and commit so historical GitHub source links remain resolvable. Branch deletion used an expected-SHA lease to reject concurrent advancement; no commit history was force-pushed.

- `build/laundry`: `e3c509a9d9d6d7d4f88d4a39afac94cab6179e3e`.
- `cloud/P00-source-consolidation`: `f0efdc027e5f1a36f95449296ea16e0b31afd384`.
- `cloud/batch-20261025-01`: `eb536d90e44867a15538c51e27e03cb42f7e9d57`.
- `cloud/batch-customer-followup-20261025`: `b077c83e5da8ee4abf43b37f4f600ab652b7eb6e` (remote only).
- `cloud/r01-laundrymate-reference`: `765486c428f467df9cb7e4fe2cff5d26e2a251cf`.
- `docs/production-cloud-plan-20261021`: `f477671348b5cdd09844ee1b8495caa6b12e11e9`.
- `wip/main-checkout-20261021`: `39eaa8d0d380f780886c06d44f91fb0760b3ae0c`.

Preserved deliberately:

- `design/laundry-storefronts-20261014`, `chore/cloud-agent-workflow`, `feat/backend-mvp`, `fix/backend-handoff-20261021`: open PR #1–#4 and/or checked-out worktrees; inspect unique changes rather than delete.
- `fix/customer-ui-handoff-20261021`, `build/wandary`: unique changes; the latter also has a local tip different from its remote. No spelling-based deletion.
- `cloud/c01-contract-freeze`: primary checkout has uncommitted files and local unique history; its remote also remains. Do not switch or reset that dirty checkout.
- `work/production-direct-20261022`, `work/production-clean-build-fix-20261022`, `work/production-readiness-20261022`: active worktrees and/or unique commits. No worktree deletion.
- The unrelated `no-mistakes` remote is outside this cleanup.

Continue integrated work in the existing main worktree (`laundry-production-app`); the original `Landary` directory intentionally remains untouched on its dirty work-in-progress branch. Merge only reviewed unique work into main, with verification. Do not equate a later timestamp with a safe integration.

## First reproducible CI repair

At the integrated baseline, running `pnpm --filter @laundry/ops exec vitest run test/branding.test.ts` exited 1: three assertions expected old demo display names. Commit `79a29e5` intentionally changed app display labels to `Laundry Customer`, `Laundry Rider` and `Laundry Operations` without changing the slugs/deep-link schemes.

The repair changes only those stale assertions in `apps/ops/test/branding.test.ts`. It retains demo heading/sign-in assertions and the separate `apps/ops/src/App.test.tsx` fail-closed production entry tests. No product authentication behaviour, test skip or API/contract has changed.

Verification completed successfully against the source tree committed as `c32eede` (the commands started before that commit was created, with no intervening application/test changes): complete operations suite **34/34**, `pnpm check` exit **0**, contracts **103/103**. This is first-repair evidence, not final release-SHA acceptance. Additional checks passed: `pnpm test:tooling` **107/107**, `pnpm test:voice` **23/23** (local mocked/unit coverage, not live speech), and `pnpm check:convex` exit **0** (compatibility only, not canonical backend selection). `git diff --check` and local Markdown-link resolution passed after documentation cleanup. `pnpm --recursive --workspace-concurrency=1 build` exited **0** for all workspaces, including customer/rider web exports and ops production bundle. `pnpm contracts:check` exited **0**: OpenAPI matches the executable registry and **7/7** generator tests passed. Native Android builds are not included in web exports; generated dist artifacts remain uncommitted. `pnpm release:security` exited **0**: the exact installed `node-forge` RSA backport digest and seven regression cases passed. The raw dependency audit still reports one HIGH version-based advisory, `GHSA-86w9-cpqp-85rv` / `CVE-2026-85393`; this is not a claim of zero advisories or a completed application-security review. Current PostgreSQL-backed evidence and the reproduced regression are recorded below; no historical test count is claimed as current evidence.

Documentation cleanup now marks `ISSUES.md`'s initial state table as historical and updates `IMPLEMENTATION.md` to the main integration convention instead of leaving contradictory branch instructions. Removed the tracked zero-byte `Text File.txt`; its only reference is the historical initial-project description. Did not delete legacy customer API/cart files wholesale: `apps/customer/test/api.regression-1.test.ts` still imports the legacy API and must be deliberately migrated before that code can safely disappear.

## Browser and gstack in Pi

The existing Codex gstack installation was reused, not recloned or upgraded. Fifty-seven per-skill links under the user's Pi skills directory were validated through Pi's own skill loader with zero warnings. User-local Pi `AGENTS.md` maps skill/tool conventions and explicitly discloses missing upstream Pi support/hooks. `/reload` refreshes skill discovery. This is local compatibility, not certified hook enforcement.

The documented gstack Linux browse fallback opened the real local ops app with `VITE_DEMO_MODE=false` and no API base. Verified title `Laundry Operations`, heading `Operations console is not configured`, explicit request for `VITE_API_V2_URL`, and no browser console errors. Inspected screenshot stored privately outside git; owned tab closed and preview stopped. This proves the configuration boundary, not a signed-in operational journey or native acceptance.

No personal cookies, telemetry/artifact sync, paid models or provider calls were enabled. No gstack upgrade or repo-wide shared skill installation was made. Teammate setup is awaiting the founder's answer.

## PostgreSQL regression diagnosis

Docker Desktop's daemon is unavailable after an OOM termination and system PostgreSQL binaries are absent. Provisioned task-only PostgreSQL **18.6** using signed CachyOS `18.6-4.1` packages outside the repository. Both package signatures and SHA-256 digests passed before execution. Setup recovered from stale-index HTTP 404 and an ASCII-armored OS keyring (`invalid packet (ctb=2d)` / `Can't check signature: No public key`) by fetching a fresh isolated index and converting the existing public keyring to temporary binary form. No signature checks were bypassed, system packages installed or production databases changed. Each test task removes its database when finished.

The whole-workspace baseline failed: **339/340 API tests passed**, with `apps/api/test/jobs-v2.test.ts:449` reporting `expected +0 to be 1` in `keeps a booking committed when a notification consumer fails`. Earlier stages passed: contracts **103/103**, fixtures **231/231**, design tokens **2/2**, Cloudflare **11/11**. A focused real-PostgreSQL reproduction failed in **1.36 s**.

A temporary probe proved that PostgreSQL scheduled the real booking event at `2026-10-26T02:55:57.447Z` while the injected worker clock stayed at `2026-10-26T02:00:00.000Z`: dispatch claimed **zero** events, so no notification handler ran. Moving to the truncated JavaScript due time still failed because PostgreSQL retains microseconds. The repair advances the test worker one millisecond past the database's due time, without modifying the outbox or production scheduling. It also asserts an actual handler failure, retry, empty failure inbox, successful recovery and unchanged booking. Temporary instrumentation was removed. The complete dispatcher suite then passed **11/11** against a fresh isolated database (**2.13 s**). The full rerun against source committed as `7ff0077b2afa60f88d192a6b569ae54441d7fd1e` passed **1,037/1,037** workspace tests: API **340**, contracts **103**, fixtures **231**, SDK **148**, app foundation **32**, customer **100**, rider **36**, ops **34**, design tokens **2**, Cloudflare **11**. `pnpm check` subsequently exited **0**, including API/worker type checks. No application/test files changed between test launch and that commit. This is current local PostgreSQL 18.6/synthetic-provider evidence, not provider-live, CI PostgreSQL 17, native-device, physical-facility or final browser-recording acceptance.

Commands: `node tools/cloud/postgres.mjs exec --runtime local --bin-dir <verified PostgreSQL bin directory> --label d1-repaired-workspace -- pnpm test`, then `pnpm check`. The wrapper removed its isolated database after the test command; no production data was accessed. The next documentation-only commit records these completed results.

## Known blockers / next work
- Android `adb devices -l` found no connected physical device; native build/device evidence remains open under #27.
- Approved customer identity/staff MFA, commercial catalog/rates, capacity, operating policies, actual roles and physical rehearsal require founder/facility inputs. No generated plan can substitute for them.
- After the first repair, run current PostgreSQL/build/security/browser/restore evidence at a pinned revision, inspect the real ops journey, and use the next reproduced failure as the implementation target. Do not close #26/#27/#28 from this checkpoint.
