# A7: Operations console

**Goal:** Build the minimum staff control surface covering all required ops routes. Include refund/dispatch uncertainty, support escalation and audit details. UI cannot directly query the database or expose provider credentials.

**Read first:** [Product spec](../specs/product-spec.md), [shared contracts](../specs/contracts.md), [main plan](../superpowers/plans/2026-10-11-laundry.md).

**Depends on:** A0 contracts-v1. Fixtures permit independent development after the A0 gate; they do not prove cross-module integration.

**Write allowlist:** `apps/ops/**`. A0 alone edits shared contracts, manifests, lockfile, generated SDK, canonical migrations and app/worker composition. For A0, its exact allowlist is the main plan's shared/root paths. Do not commit edits to another packet's paths. Use a separate worktree/branch.

**Create paths:**
- `apps/ops/app/orders/page.tsx`
- `apps/ops/app/orders/[id]/page.tsx`
- `apps/ops/app/dispatch/page.tsx`
- `apps/ops/app/catalog/page.tsx`
- `apps/ops/app/support/page.tsx`

**Interfaces:** Consume generated ops endpoints for orders/intake/care/capacity, catalog/rate cards/moderation, logistics, refunds/reconciliation and conversation handoff. Backend is the authority for permissions.

## Implementation tasks

- [ ] Create `apps/ops/test/ops-journey.test.tsx` with individually named behavior tests for these assertions: facility cannot see other facility orders; care is disabled during unresolved price adjustment; overrides require reason; refund pending differs from refunded; intake discrepancy remains visible; draft catalog cannot be published without licensed images/rate data. Assertions must exercise observable state, API results and ledger/job counts rather than implementation details.
- [ ] Run `pnpm --filter @laundry/ops test` and confirm the new cases fail for the intended missing behavior. A0 first creates these workspace scripts; do not interpret “script missing” as a useful regression result.
- [ ] Implement the interfaces and behavior above in the owned paths. Keep adapter, persistence and handler concerns separate. Every public command must honor actor authorization, idempotency and version rules from contracts.md.
- [ ] Add module-local schema proposals where applicable; send them to A0 for canonical migration integration. Request shared contract/dependency changes explicitly; never patch a private workaround into a consumer.
- [ ] Run `pnpm --filter @laundry/ops test` until all behavior cases pass, then `pnpm check` and `pnpm test:contracts`. Mark checks that require unmerged dependencies as pending, not passed. Backend packet tests use real isolated Postgres, with only external providers mocked.
- [ ] Commit only owned paths with message `feat: implement a7 operations console`. Return commit ID, changed files, commands/results, fixture vs live evidence and remaining dependencies to A0. Do not merge, deploy or publish on your own.

## Definition of done

Every assigned behavior and test above is implemented; no writes escape the allowlist; schemas match contracts-v1; fixtures contain no real personal data or secrets. Empty/loading/error/permission states are covered for UI packets. Provider-dependent work is explicitly labeled simulator/sandbox/live. Handoff is incomplete if it omits an untested dependency, unsupported provider capability or migration requirement.
