# B05 due-at-return billing, manual receipts, gateway reconciliation and refunds

Baseline: `10e445b` on `work/production-direct-20261022`, with C01 still the
candidate contract set. No live gateway, merchant account, approved tariff or
production payment is claimed. Every external provider call in this unit goes
through an injected port whose only implementation is an in-repo fake.

## What is implemented

`modules/schema/proposals/B05.sql` adds `billing_obligations`,
`billing_payment_attempts`, `billing_receipts`, `billing_refunds`,
`billing_provider_events` and `billing_reconciliation_entries`. Proposals are
not part of the canonical migration sequence, so the acceptance suite reads and
applies this file after `initializeDb()`. Receipts have a before-update and
before-delete trigger that refuses every mutation. One live obligation per order
is a partial unique index that ignores `VOID`, one gateway capture per provider
reference is a partial unique index, and provider events are unique on
`(provider, event_id)` with no TTL.

`modules/billing/src/v2.ts` serves the twelve published operations through four
controllers in `apps/api/src/features/billing-v2/billing-v2.module.ts`.

Customer routes:

- `GET /v2/orders/{orderId}/billing/obligations`, `.../attempts`, `.../receipts`
  and `.../refunds` read one owned order. The caller must be a `CUSTOMER` and
  the order must belong to them; another customer's order is `NOT_FOUND`, not
  an empty page.
- `GET /v2/billing/obligations` lists only the caller's obligations.
  `GET /v2/billing/obligations/{obligationId}` returns the `BillingSummary` with
  its receipts and refunds. `GET /v2/billing/obligations/{obligationId}/receipts`
  and `GET /v2/billing/refunds` are the remaining owned reads.
- Every read is cursor paginated with `(timestamp, id)` and projects through the
  contract schemas, so a malformed stored row fails at projection instead of
  leaking a different shape.

Operations routes, gated to `OPERATOR` or `ADMIN`:

- `POST /v2/ops/billing/obligations/{obligationId}/confirm-manual` locks the
  obligation, checks `expectedVersion`, derives the new status through
  `deriveObligationStatus`, writes a receipt with `confirmedBy` and
  `confirmedVia` of `MANUAL_CASH` or `MANUAL_UPI`, and records an audit row. The
  receipt is never labelled `GATEWAY_CAPTURE`.
- `POST /v2/ops/billing/refunds` records refund intent as `REQUESTED` inside the
  command transaction. It reads the receipt and obligation under `FOR UPDATE`,
  requires a `GATEWAY_CAPTURE`, and calls `assertRefundAllowed` with captured,
  succeeded, pending and requested amounts. `submitRefund(refundId)` is the
  internal step that calls `PaymentProviderPort` outside the transaction with a
  stable reference `refund:<id>`. A provider exception leaves the row
  `OUTCOME_UNKNOWN` with the same reference for a later reconciliation.
- `POST /v2/ops/billing/reconciliation` recomputes one UTC calendar month. It
  deletes and replaces that period's entries, counts captures from receipts,
  manual money from non-gateway receipts, refunds from succeeded rows, and
  compares successful provider events with the receipt ledger. Replayed events
  collapse to one entry per provider reference, and an applied event wins over
  its replay.

Provider route:

- `POST /v2/webhooks/payments/{provider}` verifies an HMAC-SHA256 over the
  untouched request bytes and fails `UNAUTHENTICATED` before the first database
  write when the signature is absent, wrong or the provider has no secret.
  `initializeDb` never seeds a secret, so the adapter is inert until the
  coordinator configures one per provider. The event log is the replay defence;
  the command-result cache plays no part, and the suite proves a resend still
  deduplicates after `v2_command_results` is emptied.

`createObligationForOrder(client, { orderId, dueAt, paymentModel, clock })` is
exported for the booking coordinator. It reads the order total and currency
itself, defaults the due time to `return_window.end`, and is idempotent per
order. A caller cannot invent an amount.

Status changes call the published guards: `deriveObligationStatus`,
`assertPaymentAttemptTransition`, `assertRefundTransition`,
`assertRefundAllowed` and `guardOrderCommand`. This module carries no local copy
of any state machine. All amounts are integer INR minor units stored as bigint.

## Deliberate limits (blockers, not waivers)

- **No live payment provider.** Only `FakePaymentProvider` and
  `verifyProviderSignature` exist. There is no Razorpay client, no merchant
  credential, no network call and no sandbox transaction. The webhook secret is
  configuration, not a shipped value.
- **No published payment-attempt command.** `recordAttempt` and
  `resolveAttempt` are internal hooks. The coordinator calls `recordAttempt`
  when it starts a gateway payment, and only a signed provider event can reach
  `SUCCEEDED`.
- **Obligation creation is not wired into booking.** B04 creates the order and
  stops at the financial boundary. `createObligationForOrder` is exported so the
  coordinator can call it inside the booking transaction. Until then, a booked
  order has no obligation unless a caller invokes the hook.
- **The module is not mounted in `apps/api/src/app.module.ts`.** Composition is
  coordinator-owned, so the twelve routes are proven through a standalone Nest
  app with `rawBody: true` in the acceptance suite. Mounting them requires the
  coordinator to pass a configured `BillingService` factory.
- **Refunds cover gateway captures only.** A manual cash or UPI receipt cannot
  be reversed through the provider port. Cash refunds need an operator workflow
  this unit does not own.
- **No refund retry worker.** `submitRefund` is callable but nothing schedules
  it after `OUTCOME_UNKNOWN` or `FAILED`. Retrying is a manual or worker action.
- **Reconciliation entries cover captures and manual receipts.** Succeeded
  refunds appear in `refundedMinor` but not as `REFUND` entry lines, and no
  chargeback feed exists. The `REFUND` and `CHARGEBACK` kinds are accepted by the
  contract but not produced.
- **Raw-body fallback is weaker.** If the host app is created without
  `rawBody: true`, the controller re-serializes the parsed body before signing.
  That still needs the shared secret but no longer authenticates exact bytes.
- **Concurrency is serialized, not stress-tested.** Refund reservation and
  manual confirmation lock the receipt and obligation, but the suite exercises
  sequential retries rather than simultaneous transactions.

## Scenario status

- `B05-01`: covered for the published replay cases. A repeated event id returns
  `duplicate: true`, a new event id for the same capture reference records no
  second receipt and is marked `duplicate_reference`, a conflicting payload
  under a reused event id is `INVALID_INPUT`, and the ledger holds one receipt
  after the command cache is emptied. Simultaneous delivery of the same event is
  not exercised; the unique index is the concurrency control.
- `B05-02`: covered against the fake provider. An attempt resolved `EXPIRED`
  still accepts a later signed capture, the attempt becomes `SUCCEEDED`, the
  obligation settles and reconciliation matches the event. An event for an
  unknown payment is recorded unmatched with the amount in `differenceMinor` and
  creates no receipt. A late capture from a real provider is unproven.
- `B05-03`: covered. Manual cash and UPI confirmations require a staff actor,
  record `confirmedBy`, are audited, and never appear as gateway captures. A
  stale obligation version is `VERSION_CONFLICT` and does not settle twice.
- `B05-04`: partially covered. A refund retry reuses `refund:<id>`, an
  over-refund and a second reservation of the same funds are `INVALID_INPUT`, a
  replay with the same idempotency key returns the same refund, and a manual or
  unknown receipt is refused. Concurrent refund requests and a provider failure
  path are not tested end to end.
- `B05-05`: covered at the money layer. An unpaid return reports
  `settled: false` with the remaining amount, so `COMPLETE_RETURN` fails with
  `PAYMENT_PENDING`. A zero-due obligation only settles after `voidZeroDue` with
  an audited resolution, creates no receipt, and then supplies the resolution the
  order guard requires. A non-zero obligation cannot be voided this way. The
  order-side return still belongs to B06.

## Verification

- `pnpm --filter @laundry/api typecheck`: exit 0.
- `node tools/cloud/postgres.mjs exec -- pnpm --filter @laundry/api test
  billing-v2`: exit 0 on disposable PostgreSQL 17. The build succeeded, then
  Vitest ran `apps/api/test/billing-v2.test.ts`: 14 tests passed in 1.89s across
  obligation creation, ownership scoping, manual confirmation, duplicate and
  conflicting webhooks, late and orphan captures, refund bounds and retries,
  the return gate, and all twelve routes through the real SDK with contract
  envelopes and error shapes.
- The suite applies `modules/schema/proposals/B05.sql` itself, so it proves the
  proposed DDL, including the append-only receipt trigger, not just the service.

## Contract mismatches observed

- `billing.manual.confirm` advertises only `VERSION_CONFLICT` and `FORBIDDEN`,
  but the handler can return `NOT_FOUND` for a missing obligation and
  `INVALID_INPUT` for an overpayment or a void obligation. `UNAUTHENTICATED` is
  also possible.
- `billing.refund.create` does not advertise `NOT_FOUND`, which it returns for
  an unknown receipt or a receipt from another order.
- The summary for `billing.obligation.read` says it returns the obligation with
  its attempts and receipts. `BillingSummary` has no attempts field, so attempts
  are readable only through the order attempts route.
- `ReconciliationRequest.period` is `YYYY-MM` while `Reconciliation` reports
  instants. This handler interprets the period as a UTC calendar month.
- `RefundRequest.expectedVersion` is read as the obligation version. Refunds do
  not bump that version, so two refunds may share one expected version.

Production billing remains disabled.
