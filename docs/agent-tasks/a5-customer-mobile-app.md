# A5: Customer mobile app

**Goal:** Build every customer screen in product-spec.md with accessible loading/error/empty/offline states, service photography, visible price units and payment deep-link return. Persist cart locally without sensitive credentials. Add native tests to A9 handoff.

**Read first:** [Product spec](../specs/product-spec.md), [shared contracts](../specs/contracts.md), [main plan](../superpowers/plans/2026-10-11-laundry.md).

**Depends on:** A0 contracts-v1. Fixtures permit independent development after the A0 gate; they do not prove cross-module integration.

**Write allowlist:** `apps/customer/**`. A0 alone edits shared contracts, manifests, lockfile, generated SDK, canonical migrations and app/worker composition. For A0, its exact allowlist is the main plan's shared/root paths. Do not commit edits to another packet's paths. Use a separate worktree/branch.

**Create paths:**
- `apps/customer/app/index.tsx`
- `apps/customer/app/services/[id].tsx`
- `apps/customer/app/checkout.tsx`
- `apps/customer/app/orders/[id].tsx`
- `apps/customer/src/features/catalog/`
- `apps/customer/src/features/orders/`

**Interfaces:** Consume generated SDK routes for services, reviews, quotes, checkouts, orders, payments, addresses and support. Use shared design tokens. Never implement backend pricing or provider calls in the app.

## Implementation tasks

- [ ] Create `apps/customer/test/customer-journey.test.tsx` with individually named behavior tests for these assertions: image failure keeps service selectable; expired quote requires fresh terms; checkout kill/resume loads authoritative status; pending payment never says failed or confirmed; changed intake needs explicit approval; empty reviews show no rating; inaccessible area cannot check out. Assertions must exercise observable state, API results and ledger/job counts rather than implementation details.
- [ ] Run `pnpm --filter @laundry/customer test` and confirm the new cases fail for the intended missing behavior. A0 first creates these workspace scripts; do not interpret “script missing” as a useful regression result.
- [ ] Implement the interfaces and behavior above in the owned paths. Keep adapter, persistence and handler concerns separate. Every public command must honor actor authorization, idempotency and version rules from contracts.md.
- [ ] Add module-local schema proposals where applicable; send them to A0 for canonical migration integration. Request shared contract/dependency changes explicitly; never patch a private workaround into a consumer.
- [ ] Run `pnpm --filter @laundry/customer test` until all behavior cases pass, then `pnpm check` and `pnpm test:contracts`. Mark checks that require unmerged dependencies as pending, not passed. Backend packet tests use real isolated Postgres, with only external providers mocked.
- [ ] Commit only owned paths with message `feat: implement a5 customer mobile app`. Return commit ID, changed files, commands/results, fixture vs live evidence and remaining dependencies to A0. Do not merge, deploy or publish on your own.

## Definition of done

Every assigned behavior and test above is implemented; no writes escape the allowlist; schemas match contracts-v1; fixtures contain no real personal data or secrets. Empty/loading/error/permission states are covered for UI packets. Provider-dependent work is explicitly labeled simulator/sandbox/live. Handoff is incomplete if it omits an untested dependency, unsupported provider capability or migration requirement.
