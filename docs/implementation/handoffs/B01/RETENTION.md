# Identity privacy maintenance and absolute session expiry

Baseline: `ef227ccc8979e254f0fb8feea34ff0bc9ade3f62`.
This coordinator integration is not full B01/B10 completion or production approval.

## Behavior

Canonical additive migration 008 makes expired challenge PII and encrypted
command payloads redactable without deleting their hash-only idempotency
identities. Maintenance erases phone/code/provider reference after challenge
expiry, erases command secrets after response expiry, revokes absolutely expired
families and removes obsolete rate buckets. It never changes prices, orders,
payments, business audit, account phone ownership or active addresses under an
invented business-retention policy. Hash-only security replay tombstones remain;
their eventual purge policy needs explicit review rather than making old keys new.

Every session family now has an original 30-day security deadline, in addition
to short access and seven-day refresh expiry. Rotation cannot extend that family
indefinitely. Near its deadline access/refresh expiries can coincide. Existing
families are backfilled from original creation time, not from migration time.

The bounded worker uses real PostgreSQL `FOR UPDATE SKIP LOCKED` batches with
query/lock timeouts; multiple replicas skip active verifications and converge on
restart. Its compiled entrypoint is
`apps/worker/dist/apps/worker/src/identity-maintenance.js` (or
`pnpm --filter @laundry/worker start:identity-maintenance --once`). It only logs
counts. It does not migrate/seed or contact an external provider. Migrate before
starting it. Production requires explicit non-demo verified-TLS DB configuration.
The historical notification dispatcher now refuses production and implicit demo
mode; it is not a safe production-v2 worker merely because it compiled.

Rate-limited verification keys no longer each create another encrypted command
row after quota exhaustion. OTP request replay tombstones survive redaction and
cannot trigger another send. Database transactions have bounded lock/statement
timeouts, and failed rollback discards the client.

## Review and verification

Direct Standards/Spec review checked additive migration compatibility, PII/log
minimization, bounded work, replay/non-resurrection, family deadlines and process
cleanup. No paid independent reviewer or local subagent was invoked. The first
near-deadline integration test failed on PostgreSQL's actual generated name for
the original refresh constraint (`identity_sessions_check1`). Migration 008 now
explicitly replaces that original constraint; the failed exit was retained.

Six PostgreSQL tests cover redaction/tombstones, encrypted response expiry,
concurrent locked batches/restart, absolute expiry after repeated rotations,
rate-limited-cache growth and invalid bounds. Local full check/build, 687
workspace tests, 77 tooling tests and all four compiled-API web scenarios pass.

Actual clean cloud run `40176952911` passed for preceding `ef227cc`, including
container/context validation, 44-table identity restore and browser recording.
Security run `40176952995` remained failed on node-forge. Agent evidence run
`40176952859` failed in the pilot job: it still omitted the newly required API
compiled build. This is a real fresh-checkout regression, not a provider problem.
The public `pnpm verify:pilot` command now builds contracts, SDK and API in order;
the workflow invokes that command. Two executable orchestration tests verify
ordering and failed-build exit preservation. The actual isolated pilot journey
and API-restart persistence pass locally on the working tree with dirty state
explicitly recorded. A new clean/cloud run must replace, not relabel, the failed
one.

The container verifier now also runs the actual compiled maintenance process and
asserts the historical worker refuses production. Clean-source verification of
these new checks must follow the commit. Provider/staff-MFA/shared-contract/app
consumers and operational approval gates remain incomplete.
