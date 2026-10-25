# Orders contract boundary (pre-freeze candidate)

C01 remains `BLOCKED_CONTRACT`. This note records the contract deltas B04 needed
before the orders module was implemented against the candidate. It is not a
freeze and does not approve tariffs, payment collection or production ordering.

## Gaps closed

- `orderCancellationSchema` and `orderHoldSchema` existed without exported
  TypeScript types. The orders service signatures name `OrderCancellation` and
  `OrderHold`, so both type aliases were added in `commands.ts`. The schemas and
  the wire shape did not change.
- No route was added or removed. All fourteen published operations owned by B04
  have handlers: quote, book, list, detail, timeline, cancel, reschedule,
  adjustment decision, ops queue, intake, care, quality check, hold and
  exception resolution. The gaps below are behavioural limits inside those
  operations, not missing routes.
- Nothing else in the wire contract changed for B04.

## Recorded gaps

These are blockers, not waived findings.

- The published catalog routes can create, approve and activate a rate card, but
  none reads a card by id and none ties a card to a quote. `Quote.catalogVersion`
  is a single integer while one basket can span several rate cards. The
  implementation keeps the real per-line `rateCardId` and `rateCardVersion` and
  sets `catalogVersion` to the highest card version in the basket. That is a
  lossy projection and needs a contract decision.
- `Quote` carries no area id, so a client cannot tell which service area priced
  the basket. The quote row stores `area_id` internally.
- `Order.paymentModel` allows `PREPAID_V1`, but B04 accepts only
  `DUE_AT_RETURN`, which `bookingInputSchema` already enforces with a literal.
- No route marks an order picked up. `MARK_PICKUP_PENDING` exists in the guard
  and the module exposes `markPickupPending` as an internal hook, but only tests
  call it today. B06 must drive it from the pickup leg.
- `ExceptionResolution.action` includes `AGREED_RETURN`, which needs a recorded
  payment obligation owned by B05. B04 refuses that action with
  `REQUIRES_APPROVAL` rather than inventing an unpaid return.
- `OrderAction` advertises `CONFIRM_DELIVERY` and `APPROVE_RECEIPT`. B04 only
  advertises actions it can execute, `ACCEPT_ADJUSTMENT`, `DECLINE_ADJUSTMENT`
  and `REQUEST_CANCEL`. The other two belong to B06 and B05.
- Intake requires the order to be in `PICKUP_PENDING`, and the guard has no
  re-measure command, so a re-measure after intake cannot go through
  `RECORD_INTAKE`.
- Cancellation after pickup only records `CANCEL_REQUESTED`. `CONFIRM_CANCEL`
  needs logistics, care, custody and financial evidence that B05 and B06 own.
  B04 exposes `confirmCancellationBy(actor, orderId, reason)` as the single
  internal path out of that state. It re-checks what B04 can see, releases the
  hold, and refuses with `REQUIRES_APPROVAL` when a fact is still missing. It
  has no published route, so completing a post-pickup cancellation is a B05 and
  B06 integration task.
- The guard makes `adjustmentState` a care precondition. B04 feeds it the live
  constraint only: a `PROPOSED` or `ACCEPTED` row. A declined or expired
  proposal is history, so an order that resumes at the quoted total can start
  care and quality work. The guard itself is unchanged; the interpretation is
  recorded here because otherwise a refused proposal would block the order
  forever.
- `Quote.version` now increments whenever the quote leaves `OPEN`, and
  `Adjustment.version` increments on a decision or expiry. Both were write-once
  before, which made `expectedVersion` and `adjustmentVersion` checks meaningless.
- The facility on an order is resolved from the reserved capacity bucket at
  booking and reschedule. It is not a client field and not a contract addition.

## Verification

- `pnpm check` passes.
- `pnpm contracts:generate`: 80 paths, 84 operations.
- `apps/api/test/orders-v2.test.ts`: 19 tests passed on isolated PostgreSQL 17
  through `node tools/cloud/postgres.mjs exec`. The additions cover quality
  check pass and rework, cross-customer and cross-facility denial, a changed
  payload under a reused idempotency key, flat tax once per shared rate card,
  reschedule refusal after intake, an invalid cursor, and a cancellation held at
  `CANCEL_REQUESTED` while an unverified obligation exists.

The freeze SHA, digest and approval remain pending coordinator sign-off. A digest
recorded against a working tree is not a freeze receipt.
