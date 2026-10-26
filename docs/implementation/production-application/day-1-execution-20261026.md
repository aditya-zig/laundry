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

Verification launched: complete operations tests, `pnpm check`, `pnpm test:contracts`; results pending at this checkpoint. PostgreSQL-backed whole-workspace verification is being prepared; no historical test count is claimed as current evidence.

## Browser and gstack in Pi

The existing Codex gstack installation was reused, not recloned or upgraded. Fifty-seven per-skill links under the user's Pi skills directory were validated through Pi's own skill loader with zero warnings. User-local Pi `AGENTS.md` maps skill/tool conventions and explicitly discloses missing upstream Pi support/hooks. `/reload` refreshes skill discovery. This is local compatibility, not certified hook enforcement.

The documented gstack Linux browse fallback opened the real local ops app with `VITE_DEMO_MODE=false` and no API base. Verified title `Laundry Operations`, heading `Operations console is not configured`, explicit request for `VITE_API_V2_URL`, and no browser console errors. Inspected screenshot stored privately outside git; owned tab closed and preview stopped. This proves the configuration boundary, not a signed-in operational journey or native acceptance.

No personal cookies, telemetry/artifact sync, paid models or provider calls were enabled. No gstack upgrade or repo-wide shared skill installation was made. Teammate setup is awaiting the founder's answer.

## Known blockers / next work

- Docker Desktop's local daemon is unavailable after an OOM termination. System PostgreSQL binaries are absent. Prepare a task-only PostgreSQL runtime without changing shared services or using production databases; record any environment failure honestly.
- Android `adb devices -l` found no connected physical device; native build/device evidence remains open under #27.
- Approved customer identity/staff MFA, commercial catalog/rates, capacity, operating policies, actual roles and physical rehearsal require founder/facility inputs. No generated plan can substitute for them.
- After the first repair, run current PostgreSQL/build/security/browser/restore evidence at a pinned revision, inspect the real ops journey, and use the next reproduced failure as the implementation target. Do not close #26/#27/#28 from this checkpoint.
