# A3: Billing and reconciliation

**Goal:** Implement hosted Razorpay payment sessions, immutable capture ledger, independent refund state and reconciliation. Use sandbox credentials only when supplied. HTTP retries must reconcile unknown outcomes. Test fixtures are not proof of live integration.

**Read first:** [Product spec](../specs/product-spec.md), [shared contracts](../specs/contracts.md), [main plan](../superpowers/plans/2026-10-11-wandary.md).

**Depends on:** A0 contracts-v1. Fixtures permit independent development after the A0 gate; they do not prove cross-module integration.

**Write allowlist:** `modules/billing/**`. A0 alone edits shared contracts, manifests, lockfile, generated SDK, canonical migrations and app/worker composition. For A0, its exact allowlist is the main plan's shared/root paths. Do not commit edits to another packet's paths. Use a separate worktree/branch.

**Create paths:**
- `modules/billing/src/billing.service.ts`
- `modules/billing/src/razorpay.adapter.ts`
- `modules/billing/src/webhook.controller.ts`
- `modules/billing/src/reconcile.worker.ts`
- `modules/billing/schema/proposal.sql`

**Interfaces:** Implement BillingPort.createPayment/getPayment/requestRefund; export BillingModule. Publish payment.captured.v1/refund.updated.v1. PaymentRequest.amount comes from orders, never client amounts.

## Implementation tasks

- [ ] Create `modules/billing/test/billing.test.ts` with individually named behavior tests for these assertions: forged signature produces no ledger change; duplicate/out-of-order events capture once; unknown timeout does not start a second payment; total refunded cannot exceed capture; late capture remains recorded; duplicate refund request preserves obligation ID. Assertions must exercise observable state, API results and ledger/job counts rather than implementation details.
- [ ] Run `pnpm --filter @wandary/billing test` and confirm the new cases fail for the intended missing behavior. A0 first creates these workspace scripts; do not interpret “script missing” as a useful regression result.
- [ ] Implement the interfaces and behavior above in the owned paths. Keep adapter, persistence and handler concerns separate. Every public command must honor actor authorization, idempotency and version rules from contracts.md.
- [ ] Add module-local schema proposals where applicable; send them to A0 for canonical migration integration. Request shared contract/dependency changes explicitly; never patch a private workaround into a consumer.
- [ ] Run `pnpm --filter @wandary/billing test` until all behavior cases pass, then `pnpm check` and `pnpm test:contracts`. Mark checks that require unmerged dependencies as pending, not passed. Backend packet tests use real isolated Postgres, with only external providers mocked.
- [ ] Commit only owned paths with message `feat: implement a3 billing and reconciliation`. Return commit ID, changed files, commands/results, fixture vs live evidence and remaining dependencies to A0. Do not merge, deploy or publish on your own.

## Definition of done

Every assigned behavior and test above is implemented; no writes escape the allowlist; schemas match contracts-v1; fixtures contain no real personal data or secrets. Empty/loading/error/permission states are covered for UI packets. Provider-dependent work is explicitly labeled simulator/sandbox/live. Handoff is incomplete if it omits an untested dependency, unsupported provider capability or migration requirement.
