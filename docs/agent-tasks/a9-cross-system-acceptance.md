# A9: Cross-system acceptance

**Goal:** Verify complete success and recovery journeys, privacy boundaries, performance targets and deletion/reconciliation jobs. Record simulator vs sandbox vs physical-pilot evidence separately. A0 owns final composition and deployment configuration.

**Read first:** [Product spec](../specs/product-spec.md), [shared contracts](../specs/contracts.md), [main plan](../superpowers/plans/2026-10-11-wandary.md).

**Depends on:** A0 for test authoring; A1–A8 merged for complete execution. Fixtures permit independent development after the A0 gate; they do not prove cross-module integration.

**Write allowlist:** `integration/**`. A0 alone edits shared contracts, manifests, lockfile, generated SDK, canonical migrations and app/worker composition. For A0, its exact allowlist is the main plan's shared/root paths. Do not commit edits to another packet's paths. Use a separate worktree/branch.

**Create paths:**
- `integration/order-roundtrip.test.ts`
- `integration/provider-replay.test.ts`
- `integration/privacy.test.ts`
- `integration/voice-eval.test.ts`
- `integration/mobile/customer.yaml`
- `integration/mobile/partner.yaml`

**Interfaces:** Consume only public API/generated SDK and A0 test context. Use real Postgres and replace external vendor edges with replayable adapters. Coordinate native device runs; return fixes to owners rather than editing their paths.

## Implementation tasks

- [ ] Create `integration/order-roundtrip.test.ts` with individually named behavior tests for these assertions: app and WhatsApp share one order; capture/intake top-up/return/review complete; replayed events do not double-charge or dispatch; backup restore retains custody/payment history; real-device camera/payment return works; failing provider recovers without a false delivery. Assertions must exercise observable state, API results and ledger/job counts rather than implementation details.
- [ ] Run `pnpm test:integration && pnpm test:e2e` and confirm the new cases fail for the intended missing behavior. A0 first creates these workspace scripts; do not interpret “script missing” as a useful regression result.
- [ ] Implement the interfaces and behavior above in the owned paths. Keep adapter, persistence and handler concerns separate. Every public command must honor actor authorization, idempotency and version rules from contracts.md.
- [ ] Add module-local schema proposals where applicable; send them to A0 for canonical migration integration. Request shared contract/dependency changes explicitly; never patch a private workaround into a consumer.
- [ ] Run `pnpm test:integration && pnpm test:e2e` until all behavior cases pass, then `pnpm check` and `pnpm test:contracts`. Mark checks that require unmerged dependencies as pending, not passed. Backend packet tests use real isolated Postgres, with only external providers mocked.
- [ ] Commit only owned paths with message `feat: implement a9 cross-system acceptance`. Return commit ID, changed files, commands/results, fixture vs live evidence and remaining dependencies to A0. Do not merge, deploy or publish on your own.

## Definition of done

Every assigned behavior and test above is implemented; no writes escape the allowlist; schemas match contracts-v1; fixtures contain no real personal data or secrets. Empty/loading/error/permission states are covered for UI packets. Provider-dependent work is explicitly labeled simulator/sandbox/live. Handoff is incomplete if it omits an untested dependency, unsupported provider capability or migration requirement.
