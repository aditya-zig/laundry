# A6: Partner mobile app

**Goal:** Implement invite/login, task list/detail, navigation deep link, bag scan/count, handover proof, failure reporting and history. Cache only active job necessities in protected storage; purge on sign-out/revocation. Do not build provider payroll.

**Read first:** [Product spec](../specs/product-spec.md), [shared contracts](../specs/contracts.md), [main plan](../superpowers/plans/2026-10-11-wandary.md).

**Depends on:** A0 contracts-v1. Fixtures permit independent development after the A0 gate; they do not prove cross-module integration.

**Write allowlist:** `apps/partner/**`. A0 alone edits shared contracts, manifests, lockfile, generated SDK, canonical migrations and app/worker composition. For A0, its exact allowlist is the main plan's shared/root paths. Do not commit edits to another packet's paths. Use a separate worktree/branch.

**Create paths:**
- `apps/partner/app/index.tsx`
- `apps/partner/app/jobs/[id].tsx`
- `apps/partner/src/features/handover/`
- `apps/partner/src/features/offline/`

**Interfaces:** Consume partner jobs/accept/handover/exception endpoints and signed media API. Submit HandoverInput with stable actionId and expectedVersion; provider-managed jobs respect capability flags.

## Implementation tasks

- [ ] Create `apps/partner/test/partner-journey.test.tsx` with individually named behavior tests for these assertions: unassigned job is inaccessible; provider-managed task disables unsupported actions; offline evidence says pending; repeated sync uses same action ID; reassignment rejects stale completion; denied camera permission offers supported alternative. Assertions must exercise observable state, API results and ledger/job counts rather than implementation details.
- [ ] Run `pnpm --filter @wandary/partner test` and confirm the new cases fail for the intended missing behavior. A0 first creates these workspace scripts; do not interpret “script missing” as a useful regression result.
- [ ] Implement the interfaces and behavior above in the owned paths. Keep adapter, persistence and handler concerns separate. Every public command must honor actor authorization, idempotency and version rules from contracts.md.
- [ ] Add module-local schema proposals where applicable; send them to A0 for canonical migration integration. Request shared contract/dependency changes explicitly; never patch a private workaround into a consumer.
- [ ] Run `pnpm --filter @wandary/partner test` until all behavior cases pass, then `pnpm check` and `pnpm test:contracts`. Mark checks that require unmerged dependencies as pending, not passed. Backend packet tests use real isolated Postgres, with only external providers mocked.
- [ ] Commit only owned paths with message `feat: implement a6 partner mobile app`. Return commit ID, changed files, commands/results, fixture vs live evidence and remaining dependencies to A0. Do not merge, deploy or publish on your own.

## Definition of done

Every assigned behavior and test above is implemented; no writes escape the allowlist; schemas match contracts-v1; fixtures contain no real personal data or secrets. Empty/loading/error/permission states are covered for UI packets. Provider-dependent work is explicitly labeled simulator/sandbox/live. Handoff is incomplete if it omits an untested dependency, unsupported provider capability or migration requirement.
