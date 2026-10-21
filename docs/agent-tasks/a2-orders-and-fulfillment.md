# A2: Orders and fulfillment

**Goal:** Implement capacity/quotes/order lifecycle, intake adjustments, care/QC, cancellation, rescheduling and support incidents. Define transition authorization and compensation for each failure. Never import a provider SDK.

**Read first:** [Product spec](../specs/product-spec.md), [shared contracts](../specs/contracts.md), [main plan](../superpowers/plans/2026-10-11-laundry.md).

**Depends on:** A0 contracts-v1. Fixtures permit independent development after the A0 gate; they do not prove cross-module integration.

**Write allowlist:** `modules/orders/**`. A0 alone edits shared contracts, manifests, lockfile, generated SDK, canonical migrations and app/worker composition. For A0, its exact allowlist is the main plan's shared/root paths. Do not commit edits to another packet's paths. Use a separate worktree/branch.

**Create paths:**
- `modules/orders/src/orders.service.ts`
- `modules/orders/src/quotes.service.ts`
- `modules/orders/src/fulfillment.service.ts`
- `modules/orders/src/support.service.ts`
- `modules/orders/schema/proposal.sql`

**Interfaces:** Implement every OrdersPort command. Export OrdersModule. Consume CatalogPort, BillingPort, LogisticsPort and payment/delivery events through injected interfaces. Persist transition and outbox together.

## Implementation tasks

- [ ] Create `modules/orders/test/order-lifecycle.test.ts` with individually named behavior tests for these assertions: last slot has exactly one winner; quote expiry blocks checkout; paid expired hold enters resolution; extra garment requires approved top-up before care; delivered pickup leg does not mark order delivered; canceled order late capture creates refund obligation; mixed services respect slowest return. Assertions must exercise observable state, API results and ledger/job counts rather than implementation details.
- [ ] Run `pnpm --filter @laundry/orders test` and confirm the new cases fail for the intended missing behavior. A0 first creates these workspace scripts; do not interpret “script missing” as a useful regression result.
- [ ] Implement the interfaces and behavior above in the owned paths. Keep adapter, persistence and handler concerns separate. Every public command must honor actor authorization, idempotency and version rules from contracts.md.
- [ ] Add module-local schema proposals where applicable; send them to A0 for canonical migration integration. Request shared contract/dependency changes explicitly; never patch a private workaround into a consumer.
- [ ] Run `pnpm --filter @laundry/orders test` until all behavior cases pass, then `pnpm check` and `pnpm test:contracts`. Mark checks that require unmerged dependencies as pending, not passed. Backend packet tests use real isolated Postgres, with only external providers mocked.
- [ ] Commit only owned paths with message `feat: implement a2 orders and fulfillment`. Return commit ID, changed files, commands/results, fixture vs live evidence and remaining dependencies to A0. Do not merge, deploy or publish on your own.

## Definition of done

Every assigned behavior and test above is implemented; no writes escape the allowlist; schemas match contracts-v1; fixtures contain no real personal data or secrets. Empty/loading/error/permission states are covered for UI packets. Provider-dependent work is explicitly labeled simulator/sandbox/live. Handoff is incomplete if it omits an untested dependency, unsupported provider capability or migration requirement.
