# B04 unified booking, intake, adjustments, care and cancellation

Baseline: `08ec897`. C01 is still `BLOCKED_CONTRACT`. This is implemented
against the candidate with the type-only contract additions recorded in
`docs/implementation/contracts/ORDERS-BOUNDARY.md`. No approved tariff, payment
obligation, logistics assignment or production ordering is claimed.

## What is implemented

Canonical migration `013_orders.sql` adds `orders_v2_quotes`,
`orders_v2_orders`, `orders_v2_timeline` and `orders_v2_adjustments`. It seeds
nothing and references no v1 table, so production ordering does not read the
legacy demo rows. Status, resume status and timeline actor values are
constrained to the contract enums, both hold references are foreign keys into
`availability_holds`, and the list indexes match the `(updated_at, id)` cursor
the routes actually use.

`modules/orders/src/v2.ts` serves the fourteen published orders operations:

Customer routes:

- `POST /v2/orders/quotes` resolves the owned address, maps its postal code to
  an active service area, checks the pickup window against the published slot
  list, prices every line from the effective rate card, and takes one capacity
  hold inside the same transaction as the quote row. The promised return window
  is the one B03 publishes for that pickup slot, so a quote cannot promise an
  unbookable pair. A requested return time the slot cannot meet is
  `DEADLINE_UNAVAILABLE`; a slot without remaining capacity is `NO_CAPACITY`.
- `POST /v2/orders` books from a quote. The quote is locked, its version and
  expiry are checked, the hold becomes a reservation for the new order id, and
  the order is created `CONFIRMED`. The facility is resolved from the reserved
  capacity bucket, so the order belongs to a real facility rather than NULL. A
  retry with the same idempotency key returns the stored order instead of
  creating a second one.
- `GET /v2/orders`, `GET /v2/orders/{id}` and `GET /v2/orders/{id}/timeline`
  read owned orders only. A customer reading another customer's order gets
  `NOT_FOUND`. Facility staff read only orders at their own facility.
- `POST /v2/orders/{id}/cancel` completes immediately before pickup when every
  reconciliation fact it can observe is true, and releases the reservation. If
  a live logistics assignment or an open payment obligation exists, it records
  `CANCEL_REQUESTED` and leaves the order for a human.
- `POST /v2/orders/{id}/reschedule` replaces the basket with a newer quote,
  releases the superseded reservation and reserves the replacement window in one
  transaction. Both quote statuses and every prior timeline entry are preserved.
- `POST /v2/orders/{id}/adjustments/decision` accepts or declines the current
  proposed adjustment with an adjustment version and an order version.

Operations routes:

- `GET /v2/ops/orders/queue` is cursor paginated. A `FACILITY` caller sees only
  their facility; `OPERATOR`, `SUPPORT` and `ADMIN` see the whole queue.
- `POST /v2/ops/orders/{id}/intake` records measured lines and sealed containers.
  A higher measured total creates a `PROPOSED` adjustment and moves the order to
  `AWAITING_ADJUSTMENT`. A lower measured total simply lowers the order total,
  with no extra charge and no adjustment. A PIECE line requires
  `measuredPieceQuantity`; a counted garment total that includes accessories is
  refused rather than billed.
- `POST /v2/ops/orders/{id}/care` starts care or a quality check.
- `POST /v2/ops/orders/{id}/quality-check` passes the order to
  `READY_FOR_RETURN` or sends a failure back to `IN_CARE` as a rework. Both
  targets receive the accepted-intake evidence the guard requires.
- `POST /v2/ops/orders/{id}/hold` holds an order with a reason and records the
  state to resume.
- `POST /v2/ops/orders/{id}/exceptions/resolve` resumes, escalates or requests
  cancellation. Requesting cancellation on an order that already asked for one
  returns `REQUIRES_APPROVAL` instead of an illegal transition.

Every state change calls `guardOrderCommand` from the contracts package. The
module does not carry its own copy of the order state machine, so an illegal
transition or a stale version fails the same way in every handler. Prices are
snapshotted on the quote (`lines`, `rate_cards`, `breakdown`) and carried to the
order; a later rate-card revision cannot reprice an existing quote or order.

Money is integer minor units end to end. Totals are added with a safe-integer
check, so an oversized basket fails before it can lose precision, and a stored
bigint that cannot be represented safely fails at projection rather than
silently rounding.

`markPickupPending(token, orderId)` is the B06 hook. It requires a signed-in
`FACILITY`, `OPERATOR` or `ADMIN` actor and writes a timeline entry plus an
audit row. `markPickupPendingBy(actor, orderId)` is the service-to-service form
for a caller that already authenticated. There is no published route.

`confirmCancellationBy(actor, orderId, reason)` is the only path out of
`CANCEL_REQUESTED`. It releases the hold, re-checks every fact B04 can observe,
and refuses with `REQUIRES_APPROVAL` naming the missing facts. It has no
published route; completing a post-pickup cancellation is a B05 and B06
integration task.

`expireAdjustments()` is an idempotent sweep for the worker. A `PROPOSED`
adjustment past its expiry is closed with a version bump, then the order moves
to `ON_HOLD` through `guardOrderCommand` with `AT_FACILITY` recorded as the
resume state. Each expiry writes one audit row under the system identity. The
order row is locked before the adjustment so a decision and the sweep cannot
abort each other with a deadlock. Repeating the sweep is a no-op.

`permittedActions` is derived on the server from the current status and
adjustment state. Only actions this module can execute are advertised:
`ACCEPT_ADJUSTMENT`, `DECLINE_ADJUSTMENT` and `REQUEST_CANCEL`, and never a
request the guard would refuse.

Only a `PROPOSED` or `ACCEPTED` adjustment is passed to the guard as a live care
constraint. A declined or expired proposal is history: the order keeps the
quoted total and can proceed, which the guard itself cannot express.

## Deliberate limits (blockers, not waivers)

- **Booking creates no payment obligation.** `B04-01` asks for one order, one
  obligation and one reservation. B04 creates the order and the reservation and
  stops there. Obligation rows, receipts and settlement belong to B05, and a
  fabricated obligation here would be a false financial record. The duplicate
  retry proof therefore covers the order and the reservation, not the
  obligation.
- **No pickup or delivery route exists.** `MARK_PICKUP_PENDING`,
  `START_RETURN` and `COMPLETE_RETURN` are in the guard, but only B06 owns the
  legs and custody proof. `B04-05` therefore proves that a picked-up order
  cannot be mutated by customer commands in the wrong state, not that a pickup
  can deliver an order.
- **`AGREED_RETURN` is refused** with `REQUIRES_APPROVAL`. An agreed unpaid
  return needs a recorded obligation from B05.
- **Cancellation after pickup stops at `CANCEL_REQUESTED`.** `CONFIRM_CANCEL`
  requires logistics, care, custody and financial evidence B05 and B06 own.
  `confirmCancellationBy` refuses while any of those facts is missing.
- **No re-measure command.** `RECORD_INTAKE` only accepts `PICKUP_PENDING`, so a
  second measurement after intake is not representable today.
- **`Quote.catalogVersion` is a single integer** while a basket may span several
  rate cards. The real per-line `rateCardId` and `rateCardVersion` are stored
  and projected; the single field carries the highest version. This is a lossy
  projection recorded in `ORDERS-BOUNDARY.md`.
- **`Quote` has no area id field.** The quote row stores it internally. A client
  cannot read which area priced the basket.
- **One capacity hold per quote.** A quote that is never booked holds its slot
  until the five-minute hold expires, then B03's sweep returns it. This is the
  intended cost of promising a slot at quote time, not a leak.

## Scenario status

- `B04-01`: partially covered. An identical booking retry returns the same
  order; the database holds one order and one reserved hold. The obligation is
  B05 and is not created.
- `B04-02`: covered. A stale quote version is `VERSION_CONFLICT`, a hold past
  its expiry and a quote past its expiry are `QUOTE_EXPIRED`, and a stale order
  version is rejected by the guard.
- `B04-03`: covered. A higher measured total moves the order to
  `AWAITING_ADJUSTMENT`, care is refused while a proposal is unanswered, and
  acceptance returns the order to `AT_FACILITY` with the accepted total.
- `B04-04`: covered on the B04 side. A decline enters `ON_HOLD` with the old
  total unchanged, care resumes after staff resume the order, an unanswered
  adjustment expires into the same hold with an audit row, and a lower measured
  weight lowers the bill without inventing a charge. The agreed unpaid return
  itself waits for B05.
- `B04-05`: partially covered. Before pickup, cancellation releases the
  reservation and completes when B04 can verify the reconciliation facts.
  After pickup, cancellation is only recorded. Delivery and pickup custody
  remain B06.

## Verification

- `apps/api/test/orders-v2.test.ts`: 19 tests on isolated PostgreSQL 17:
  quote snapshot and hold, idempotent booking with one order and one reservation,
  expired and stale quote rejection, replay after capacity is taken, measured
  adjustment with care blocked, lower-weight repricing, decline into a hold with
  care resuming after resume, adjustment expiry with exactly one audit row,
  cancellation and replay with one capacity release, reschedule between windows,
  quality check pass and rework, cross-customer and cross-facility denial, a
  changed payload under a reused key, flat tax once per shared card, reschedule
  refusal after intake, an invalid cursor, cancellation held at
  `CANCEL_REQUESTED` while an unverified obligation exists, and the customer and
  ops routes through the real SDK with error envelopes.
- `pnpm contracts:generate`: 80 paths, 84 operations.
- `pnpm contracts:check` passes.

Full workspace verification runs after the parallel backend units are
integrated, because their files are still in flight in the same tree. Cloud
receipts go into `evidence.json` after this commit is pushed. These results do
not claim a payment obligation, an assigned delivery leg, approved business
configuration, native acceptance or production readiness. Production ordering
remains disabled.
