# Facility tools and recovery — unattended continuation

Source baseline: `fe80951` (Better Auth checkpoint). Implementation and verification in progress; this is **not** a launch approval or an issue-closing receipt.

## Facility interface

The existing v2 ops console previously displayed disabled placeholders for measured intake and quality checks. It now has forms that use `@laundry/api-client` for:

- Actual per-line weight in integer grams or billable piece counts, separately from accessory-inclusive counted items.
- Multiple individually labeled physical bags, condition and garment counts; an explicit physical-facts confirmation. Booking estimates never fill measurements.
- Passed inspection or rework with a required reason. A higher intake total still requires customer consent; staff cannot accept for the customer.
- Retained immutable request facts, expected version and idempotency key after an unknown outcome. Navigation/new commands are blocked until the original result is reconciled. Definitive denials remain visible.

No photos are fabricated or attached by these forms. Evidence-dependent exceptions still need the support/media workflow. Return dispatch, settlement, incident resolution and native-device acceptance remain separate unfinished gates.

The optional ops browser extension exercises customer booking/consent plus staff intake, care, failed QC/rework and passed QC against real compiled HTTP services and disposable PostgreSQL. Injected post-commit response loss must produce exactly one intake audit, one QC-pass audit and one reconciled return obligation/leg/event. Staff provisioning, SMS, rates, capacity and physical pickup are synthetic; this does not prove staff MFA or actual garment custody.

## Recovery tooling

`pnpm verify:restore` previously required Docker unconditionally; on this host it failed before testing anything because the Docker daemon was unavailable. The verifier now supports the existing disposable local or Docker TaskPostgres runtimes, with strict loopback/task-database matching for dump and restore. Passwords are not placed in command arguments or public receipts; inherited libpq service/host overrides are removed for local archive tools.

Default source remains the legacy three-app journey. Explicit `LAUNDRY_RESTORE_SOURCE=customer-v2` selects the actual customer/optional ops v2 journey and records that narrower scope, not delivered orders or captured payments. The restore must match every public table and sequence, preserve uniqueness, recover encrypted identity refresh results, and restore a Better Auth session whose subsequent framework logout invalidates its domain session. Google/Apple OAuth-token recovery, cloud recovery and physical fulfillment remain unproved.

For a provisioned local PostgreSQL toolchain, build the API/SDK, customer export pointing at loopback port 4499, and optionally the ops export at the same API before running:

```sh
# Paths must refer to the task-owned PostgreSQL installation, not a live DB.
export LAUNDRY_PG_RUNTIME=local
export LAUNDRY_PG_BIN_DIR=/path/to/task/postgres/bin
export LD_LIBRARY_PATH=/path/to/task/postgres/lib
export LAUNDRY_RESTORE_SOURCE=customer-v2
# Optional: requires the ops export configured for http://127.0.0.1:4499/v2.
export LAUNDRY_VERIFY_OPS_FACILITY=true
pnpm verify:restore
```

The customer export must use `EXPO_PUBLIC_AUTH_ENGINE=legacy` for this deliberately synthetic legacy-OTP fixture (not a production fallback); clear Metro cache when changing environment values. Live Google/Apple/SMS acceptance is a separate Better Auth gate. The ops export uses `VITE_DEMO_MODE=false` and explicit `VITE_API_V2_URL=http://127.0.0.1:4499/v2`. Production ordering is never enabled by this verifier.

The dump stays private under `.data/backups/`; the bounded `.verification/restore-rehearsal.json` receipt records actual runtime/version and exact source scope. Neither generated evidence nor archives are committed.

## Verification status

- Existing actual customer v2 journey: passed on local disposable PostgreSQL, including booking and customer-consent post-commit reply-loss retries.
- Archive target/credential-isolation unit tests: 3 passed.
- Full tooling tests and `pnpm check`: passed. The PostgreSQL workspace run `facility_workspace_20261026100517_7efdb6e6` passed 1,085 tests before the later browser-discovered repair below.
- Browser-discovered repair: ops treated a parsed HTTP 503 `PROVIDER_OUTCOME_UNKNOWN` envelope as a definitive rejection, although the shared foundation retained the command. Four new regression cases (503/500/408/429) reproduced `expected 'rejected' to be 'unknown'`. The controller now uses the shared `isMutationOutcomePending` policy instead of checking only the network-error class. Version conflicts still retire the old key. The first browser pass also exposed select labels whose embedded option text prevented exact label lookup; select controls now have separate associated labels.
- Focused ops regression passed 54 tests after the HTTP-error repair. The subsequent real browser pass exposed a mobile overflow: legacy global input widths stretched confirmation checkboxes. Scoped checkbox sizing repaired the overflow; desktop and 390px mobile screenshots were inspected.
- Local PostgreSQL 18.6 restore run `restore_source_20261026102339_4ce79747` → `restore_target_20261026102340_3c407f9d` passed: 91 public tables and all sequences matched, encrypted legacy refresh and Better Auth session/logout checks passed, with exactly one order/obligation/pickup/return. Actual customer/ops browser journeys passed with no page errors and identical intake/QC retry keys/bodies. Both recordings are listed in the private browser receipt. This was still a dirty-worktree run, not a clean-revision release receipt.
- Final workspace regression passed (`b805a2775`, exit 0): 1,090 Vitest tests (including 361 PostgreSQL API and 55 ops tests), 11 platform tests and 110 tooling tests. `pnpm check` also passed. An initial wrapper typo, `pnpm test:tools`, failed before tests started; the corrected `pnpm test:tooling` and full workspace run passed without masking exits.
- An additional stale-form guard prevents a background detail refresh from silently upgrading measurements to a newer order version; the screen also distinguishes original booking estimates from current order totals. Local dump files now use exclusive, random names with mode 0600 rather than inheriting an existing archive's permissions.
- A clean-committed browser/restore receipt is still pending; all generated recordings, dumps and private receipts stay ignored.

## Publication and remaining work

Work continues on `work/facility-recovery-20261026`; `main` remains the canonical base. No release, cloud deployment or ordering activation has been performed. The gstack ship workflow refuses shipping from the base branch; this is a development checkpoint, not a waived ship gate. Tooling upgrade/proactive-onboarding choices remain pending while the operator is away; their configuration and consent markers were not changed. Paid/external review and artifact sync remain unapproved/off.

Next unblocked product work is the actual return-dispatch/rider/payment-at-return interface over the existing v2 API. Human/provider gates still include approved rates/capacity/service promise, Laundry-owned Google/Apple/SMS configuration, real staff MFA/device checks, physical garment custody, cloud restore and a partner dry run. No issue is closed by this checkpoint.
