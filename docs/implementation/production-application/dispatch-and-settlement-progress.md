# Return dispatch and payment-at-return — development progress

## Verified prerequisite and new defect

The previous facility checkpoint is `8dbb4916461f821131548fa151e73f682dfa3c8b`: clean-revision actual customer/ops browser flows and disposable PostgreSQL 18.6 restore passed. GitHub #25 and #28 have the qualified evidence. This is not cloud/physical/production acceptance.

Before wiring dispatch, three new assertions in the PostgreSQL integration tests reproduced a defect (`bedc8c770`, exit 1): transactional booking and return-ready replies had `deliveryLegs: []` even after logistics persisted actual attempts. Root cause: `modules/orders/src/v2.ts` hardcoded the empty projection. The existing customer contract already permits leg summaries; no wire change is needed to correct that field.

The repair uses a coordinator-injected, batched logistics read port. Orders first authorizes/filter-selects the page IDs; logistics selects only the latest persisted attempt per order and leg. Custody codes, handover secrets and provider details are never selected. Booking/QC projections use the exact peer transaction after attempt creation, so the idempotent response includes committed leg facts. Other order mutation responses preserve these facts instead of resetting them to an empty list. No logistics fact changes the order state through this read.

Initial `pnpm check` and 69 PostgreSQL orders/logistics/billing tests passed (`baed90895`, exit 0). The expanded run `bc17495c2` passed typechecks and 73 PostgreSQL tests (orders 29, logistics 26, billing 18), including scope, batching, retry-history and no-secrets assertions. Later console/journal changes require fresh verification below.

## Interface blockers addressed without weakening customer permissions

- `DeliveryLegSummary` does not include a leg-attempt ID: the existing assignment command cannot be driven from this customer-oriented projection alone.
- Billing's existing obligation reads are customer-only. Staff must not impersonate a customer or paste hidden IDs from the database to record payment.
- A rider directory is not exposed to the operations client. Assignment must use an explicitly authorized rider identity, never an invented staff ID.

Added additive staff-only reads, generated OpenAPI/inventory, fixtures and SDK coverage:

- `GET /v2/ops/logistics/orders/{orderId}/legs` (`logistics.ops.legs`, `getDispatchLegs`): latest real pickup/return attempts with dispatch IDs/versions, without custody-code storage.
- `GET /v2/ops/billing/orders/{orderId}/obligations` (`billing.ops.obligations`, `listOpsOrderObligations`): existing obligation DTOs, operator/admin only. Customer billing reads remain owner-only; riders/facilities cannot use these staff routes.

## Console implementation — verification in progress

`apps/ops/src/features/DispatchSettlementPanel.tsx` adds operator/admin tools after QC: assign a provisioned rider to a real booked attempt, then record the exact remaining server obligation only during return custody. Manual UPI requires a transaction reference; cash/UPI both require explicit confirmation of actual receipt. Editing payment facts clears that confirmation. No gateway capture or provider reconciliation is implied. A rider directory is still missing, so an operator must obtain the rider ID from authorized staff provisioning.

All reads/mutations use `@laundry/api-client` through the session foundation. Forms do not invent amounts, attempts or riders. Incomplete pagination fails closed. Definitive failures show server errors and refresh facts; an uncertain reply retains the exact DTO and actor-bound command key, disables competing order navigation, and offers an explicit retry. Pinned retained keys cannot be replaced after storage loss, payload edits or identity drift. This does not prove durable browser/native storage: the current console uses memory ports, so operators must keep it open until uncertainty is reconciled. Production storage/process-death verification remains a gate. The ledger/reconciliation panel stays reachable on terminal orders as well, so a status change cannot hide a retained command; only new assignment/collection forms are state-gated.

The synthetic browser fixture is extended to exercise return assignment and manual-UPI recording through the exported ops UI, deliberately replacing the first committed replies with HTTP 503. Return custody is supplied by compiled business services with a synthetic rider/notifier, **not by a real device or physical transfer**. It asserts identical replay bodies/keys, one assignment, one accepted return handover, one manual receipt, zero gateway receipts, and delivery only after both custody and settlement. The first run (`b646e1a45`, exit 1) reached rider provisioning but reused the customer's synthetic phone and correctly hit the OTP cooldown. The fixture now provisions a distinct rider; no production limit was changed. The rerun (`bbeb3572f`, exit 1) reached payment collection but exposed a select whose nested option text polluted the accessible label (`locator.selectOption: Timeout 30000ms exceeded` for exact `Received by`). The control now has a unique, explicitly associated label. The corrected browser run `beb989623` passed against disposable PostgreSQL and actual exported apps, with no page errors and exact assignment/receipt retry bodies and keys. Desktop and 390px mobile payment screenshots were inspected; no horizontal overflow was detected. This was still a dirty-worktree run before the final terminal-ledger visibility assertion. A fresh browser/restore run now includes that assertion and explicitly verifies one delivered order, one accepted return handover, one manual receipt and zero gateway receipts through recovery.

## Closed-order guard and current checks

Four PostgreSQL cases (`bfac2cdd8`, exit 1) reproduced assignment/reassignment succeeding after an order became cancelled or delivered (`promise resolved "{ …(6) }" instead of rejecting`). Both transactions checked leg/assignment versions but omitted the locked order's terminal state. They now reject before rider changes, audit writes or code notification. A previously committed command can still replay its historical result without creating another assignment. Focused regression passed (`b4cab039f`, exit 0): all 78 PostgreSQL orders/logistics/billing cases, including the four terminal-order cases.

`ba6dc5193` passed workspace typechecks, 36 foundation tests (including missing/changed retained-key and actor-scope protection), 55 ops tests, 162 SDK tests and all seven generated-OpenAPI checks. The first retained-command test run failed TypeScript because a spread lost the discriminated DTO union; the fixture now clones the typed descriptor before changing its reason, without a cast or weaker type. The full PostgreSQL workspace run `b64623094` passed 1,108 Vitest tests (370 API, 162 SDK, 36 foundation, 55 ops and the remaining apps/contracts/fixtures), plus 11 platform tests and 110 tooling tests; typechecks and whitespace checks passed. This was a dirty-worktree run before the last accessibility/reconciliation UI refinements. Fresh clean-revision browser/recovery evidence remains required.

The final dirty-worktree rehearsal (`bdd2c6b1b`, exit 0) passed ops tests, typechecks and the extended browser flow, including the terminal-order ledger visibility assertion. PostgreSQL 18.6 backup/restore matched all 91 public tables and sequences, retained uniqueness and encrypted identity recovery, and preserved exactly one delivered order, one accepted return handover, one manual receipt and zero gateway receipts. The clean repetition `b8af645d2` also passed on `67758f1722ede84ab5dbbc7cd2a07b77e54bb511` (`dirty: false`), with the full 1,108-test workspace, 11 platform tests, 110 tooling tests, typechecks, actual browser recordings and the same 91-table/sequence restore facts. The private receipt explicitly records `productionReady: false`; no generated archive, video or receipt was committed.

Return proof plus resolved payment—not a UI success toast—is the delivery gate. No production-readiness claim until live/native/physical, restore, authorization and operational gates pass.

No live provider, credential use, paid API, customer messaging, ordering activation, cloud deployment or issue closure is authorized by this checkpoint.
