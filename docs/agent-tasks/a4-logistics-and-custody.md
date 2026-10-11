# A4: Logistics and custody

**Goal:** Build simulator/manual adapters and a capability-driven provider adapter seam. Implement both legs, custody, proof, cancellation and operator exceptions. Add actual vendor adapter only from contracted documentation, not guessed Delhivery routes.

**Read first:** [Product spec](../specs/product-spec.md), [shared contracts](../specs/contracts.md), [main plan](../superpowers/plans/2026-10-11-wandary.md).

**Depends on:** A0 contracts-v1. Fixtures permit independent development after the A0 gate; they do not prove cross-module integration.

**Write allowlist:** `modules/logistics/**`. A0 alone edits shared contracts, manifests, lockfile, generated SDK, canonical migrations and app/worker composition. For A0, its exact allowlist is the main plan's shared/root paths. Do not commit edits to another packet's paths. Use a separate worktree/branch.

**Create paths:**
- `modules/logistics/src/logistics.service.ts`
- `modules/logistics/src/provider.port.ts`
- `modules/logistics/src/manual.adapter.ts`
- `modules/logistics/src/simulator.adapter.ts`
- `modules/logistics/src/custody.service.ts`
- `modules/logistics/schema/proposal.sql`

**Interfaces:** Implement LogisticsPort; export LogisticsModule. Implement provider capabilities plus quote/book/cancel/status using stable external references. Consume order.confirmed.v1 and order.ready-for-return.v1; publish delivery.updated.v1.

## Implementation tasks

- [ ] Create `modules/logistics/test/logistics.test.ts` with individually named behavior tests for these assertions: duplicate dispatch creates one active leg attempt; timeout becomes BOOKING_UNKNOWN without blind rebook; return event cannot complete pickup; revoked rider cannot submit proof; provider status regression is ignored/reconciled; failed OTP cannot complete handover. Assertions must exercise observable state, API results and ledger/job counts rather than implementation details.
- [ ] Run `pnpm --filter @wandary/logistics test` and confirm the new cases fail for the intended missing behavior. A0 first creates these workspace scripts; do not interpret “script missing” as a useful regression result.
- [ ] Implement the interfaces and behavior above in the owned paths. Keep adapter, persistence and handler concerns separate. Every public command must honor actor authorization, idempotency and version rules from contracts.md.
- [ ] Add module-local schema proposals where applicable; send them to A0 for canonical migration integration. Request shared contract/dependency changes explicitly; never patch a private workaround into a consumer.
- [ ] Run `pnpm --filter @wandary/logistics test` until all behavior cases pass, then `pnpm check` and `pnpm test:contracts`. Mark checks that require unmerged dependencies as pending, not passed. Backend packet tests use real isolated Postgres, with only external providers mocked.
- [ ] Commit only owned paths with message `feat: implement a4 logistics and custody`. Return commit ID, changed files, commands/results, fixture vs live evidence and remaining dependencies to A0. Do not merge, deploy or publish on your own.

## Definition of done

Every assigned behavior and test above is implemented; no writes escape the allowlist; schemas match contracts-v1; fixtures contain no real personal data or secrets. Empty/loading/error/permission states are covered for UI packets. Provider-dependent work is explicitly labeled simulator/sandbox/live. Handoff is incomplete if it omits an untested dependency, unsupported provider capability or migration requirement.
