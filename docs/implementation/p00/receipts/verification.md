# P00 verification receipt

Every command below was run in the repository root against the integrated tree. Exit codes are the observed process exit codes, not expectations.

## Environment

| Item | Value |
|---|---|
| Node | 24.20.0 |
| Package manager | pnpm 10.33.2 |
| Database | `postgres://laundry:laundry_dev_only@localhost:5450/laundry_verify_p00` on an isolated `postgres:17-alpine` container |
| Branch | `cloud/P00-source-consolidation` |
| Base SHA | `39eaa8d0d380f780886c06d44f91fb0760b3ae0c` |
| Integration commit | `e0841e09d64003fde29d29b88b7eeffb0df2c4dd` |

The database is a disposable verification instance created for this task. It is named `laundry_verify_p00` and is not a shared or production database.

## Source provenance

| Command | Exit code | Result |
|---|---|---|
| `git rev-parse origin/wip/main-checkout-20261021` | 0 | `39eaa8d0d380f780886c06d44f91fb0760b3ae0c` |
| `git rev-parse origin/fix/backend-handoff-20261021` | 0 | `99738543372ad73a955ed641112e9bf47ee4f94c` |
| `git rev-parse origin/fix/customer-ui-handoff-20261021` | 0 | `328c15a4ba5cd7bccdbd3c77e5d982aca189f83f` |
| `git merge-base 9973854 328c15a` | 0 | `e3c509a9d9d6d7d4f88d4a39afac94cab6179e3e` |
| `git diff --name-status 39eaa8d f477671` | 0 | Only `docs/implementation/production-application/` files, so the integration source tree equals the pinned main checkout |

Receipts: `source-commits.txt`, `backend-delta.txt`, `customer-delta.txt`, `main-protected-tree.txt`, `integration-delta.txt`, `contracts.sha256`.

## Source preservation

| Command | Exit code | Result |
|---|---|---|
| `git diff --exit-code 39eaa8d -- .agents/skills/design-taste-frontend docs/discovery` | 0 | No difference. The design skill and the founder discovery documents are unchanged. |
| `git diff --exit-code 39eaa8d -- modules/schema/migrations/001_backend.sql modules/schema/migrations/002_outbox_ledger.sql` | 0 | No difference. The applied migrations are unchanged. |
| `git diff --exit-code 39eaa8d -- convex` | 0 | No difference. The Convex tree is unchanged. |

## Namespace and route ownership

| Command | Exit code | Result |
|---|---|---|
| `git grep -n '@wandary\|Wandary' -- apps modules packages tools .github` | 1 | No match. The legacy namespace is gone from active source, configuration and tooling. |
| `git ls-files -- apps/customer/app/index.tsx apps/customer/app/orders.tsx apps/customer/app/account.tsx apps/customer/app/help.tsx` | 0 | Empty. Each customer URL has one implementation. |
| `for page in index orders account help; do test -f "apps/customer/app/(tabs)/$page.tsx"; done` | 0 | All four grouped routes exist. |
| `for file in pilot.test.ts pilot-guard.test.ts pilot-customer-client.test.ts whatsapp-media.regression-1.test.ts whatsapp-signature.regression-1.test.ts; do test -f "apps/api/test/$file"; done` | 0 | All five backend pilot test files exist. |
| `test -f apps/customer/src/cart-store.ts && test -f apps/customer/src/schedule-input.ts && test -f apps/customer/test/api.regression-1.test.ts` | 0 | The customer redesign support files exist. |
| `git diff --check` | 0 | No whitespace errors. |

## Build and checks

| Command | Exit code | Result |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | Lockfile matched the merged manifests. Added `@playwright/test` 1.64.1. Scope: 11 workspace projects. |
| `pnpm build` | 0 | 10 of 11 workspace projects built. `packages/contracts`, `packages/design-tokens`, `packages/test-fixtures`, `packages/api-client`, `apps/api`, `apps/worker` compiled with `tsc`. `apps/ops` and `apps/pilot-console` built with Vite. `apps/customer` and `apps/partner` exported for web with Expo. |
| `pnpm check` | 0 | Root `tsc --noEmit`, then the per-project `check` and `typecheck` scripts for all 10 projects. |

## Tests

Command: `DATABASE_URL="postgres://laundry:laundry_dev_only@localhost:5450/laundry_verify_p00" pnpm test`

Exit code: 0

| Suite | Result | Tests |
|---|---|---|
| `packages/contracts` | passed | 14 |
| `packages/design-tokens` | passed | 2 |
| `packages/test-fixtures` | passed | 2 |
| `packages/api-client` | passed | 16 |
| `apps/api` | passed against isolated PostgreSQL | 63 |
| `apps/customer` | passed | 10 |
| `apps/partner` | passed | 6 |
| `apps/ops` | passed | 11 |

Total: 124 tests passed, 0 failed, 0 skipped.

The `apps/api` suite matches the 63 acceptance tests recorded by the backend pilot. The count is now established against the consolidated tree rather than inherited from the historical report.

Command: `pnpm test:tooling`

Exit code: 0. 7 tests passed, 0 failed. The agent workflow and evidence tooling tests are green on the integrated tree.

## Deployment gate

| Check | Result |
|---|---|
| `.github/workflows/ci.yml` deploy job condition | `github.event_name == 'push' && github.ref == 'refs/heads/build/laundry'` |
| Task branch naming | `cloud/<task-id>-<short-name>`, which cannot match `refs/heads/build/laundry` |
| `.github/workflows/agent-verification.yml` | Runs checks, a Playwright journey and artifact uploads. Contains no deployment step. |

A push to the integration branch cannot deploy.

## Known failures carried forward

The defects in the consolidation document, BF-01 through BF-05, are unchanged by this task. They are recorded with their owning task and remain visible in the release gates.

Two findings surfaced during verification and were fixed inside P00 rather than carried:

- `apps/customer/app/(tabs)/index.tsx` still imported `@wandary/contracts` because the file was untracked when the namespace rewrite ran, so `git ls-files` did not list it. The import was corrected and `pnpm check` then passed.
- `packages/contracts/test/project-naming.test.ts` failed on the historical `docs/discovery/` and `docs/plans/laundry-app/` records, which are protected or pre-rename documents. The test now exempts those two prefixes with the reason recorded in the test file, rather than rewriting history.

## Publication

| Item | Value |
|---|---|
| Tested SHA | `e0841e09d64003fde29d29b88b7eeffb0df2c4dd` |
| Contract digest | `sha256:b6af0b88d2e163fa675e827a633d698e4d43a7824b03f84cc232239ebb30a285` |
| Contract digest command | `git ls-tree -r HEAD -- packages/contracts \| sha256sum` |
| Published branch | `cloud/P00-source-consolidation` |
| Pull request | none, as the execution protocol requires |

P00 is complete. The branch is safe to use as the base for P01, C01 and D01.
