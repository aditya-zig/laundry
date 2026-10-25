# B03 service areas, slot pairs and atomic capacity

Baseline: `e8268a7`. C01 is still `BLOCKED_CONTRACT`. This is implemented
against the candidate with the three contract additions listed below. No
approved operating hours, capacity plan or service area exists in the
repository, so a fresh database publishes no slot at all.

## What is implemented

Canonical migration `012_availability.sql` adds `availability_areas`,
`availability_area_postal_codes`, `availability_buckets` and
`availability_holds`. It seeds nothing.

`modules/availability` provides:

- `GET /v2/availability/areas/{postalCode}` returns the active area mapped to
  the PIN code, including its polygon, local opening hours and timezone.
- `GET /v2/availability/slots` generates pickup and return pairs from the
  area's local opening hours in its own timezone. Slot length, pickup lead time
  and booking horizon are explicit area columns; nothing is defaulted in code.
  - Pickup starts obey the lead time from the current server clock.
  - Return starts at the first open slot at or after pickup end plus the
    slowest `turnaroundHours` across the requested services. A mixed basket
    therefore honours the slowest care time.
  - A pair whose return misses `requestedReturnBy` is still published as
    `DEADLINE_UNAVAILABLE`, so the client has an explicit alternative instead
    of an empty list. A pair without a provisioned bucket is `NO_CAPACITY`.
  - A pair without any open return slot inside the horizon is omitted; the
    service refuses to promise a return it cannot place.
  - Closed days produce no pair. Hours with `end <= start` cross local
    midnight, and civil-time conversion resolves the zone offset twice so DST
    transitions do not shift a window.
  - Responses are capped at 400 pairs per request.
- `GET /v2/ops/availability/calendar` lists buckets for staff, optionally
  filtered by area and time range.
- `PUT /v2/ops/availability/capacity` versions an operator capacity change
  through the shared idempotent command executor, refuses a capacity below the
  reserved count, and audits before/after facts with the reason.
- `hold`, `reserve`, `release` and `expireHolds` are internal service methods
  for B04. A hold reserves one unit from the exact published window, expires
  after `holdMinutes` (15 by default, bounded 1-120) and is the only route to a
  reservation. Release and expiry both go through one conditional status
  update, so capacity returns exactly once, including after a worker restart.
  A reserved hold is unique per order.

## Contract additions and gaps

Three changes were made to the candidate:

- `availability.slots` now declares `NOT_FOUND`. An unknown, unpublished or
  inactive service or area is a missing resource, not malformed input, and the
  published error set had no way to say so.
- `OperationsCalendar` gained a TypeScript type export. The schema already
  existed; the type was missing.
- The operations calendar documented optional `areaId`, `from` and `to` query
  parameters in the generated OpenAPI, matching the handler.

Open gaps, recorded rather than waived:

- **No area, postal-code or bucket creation route exists.** The inventory only
  has the four routes above. Areas and buckets must be provisioned by the
  owner/deployment path until an ops contract exists. This is the same pattern
  as catalog services and staff rows.
- **Holds are internal.** There is no published hold HTTP route, so the
  customer-facing reservation flow belongs to B04. B04 must call `hold` before
  creating an order and `release` when the order is cancelled. Until then the
  capacity test proof is at the service boundary, not through a client SDK.
- **`operationsCalendar` is capped at 500 buckets.** Pagination is not in the
  contract.
- **No capacity-generation job.** Buckets for recurring windows are owner data.
  A future worker can materialise them from area hours, but writing that job
  now would invent an operating plan.

## Scenario status

- `B03-01`: covered by the concurrent hold test. Two simultaneous holds for a
  capacity-1 bucket resolve to one success and one `NO_CAPACITY`, and the
  bucket's reserved count is 1.
- `B03-02`: covered across a reconstructed service instance. Expiry sweeps once,
  a repeated sweep returns zero, and capacity returns once. Release after
  expiry is a no-op.
- `B03-03`: covered for IST lead time, closed Sunday, an overnight window that
  crosses local midnight, and validation that rejects an inverted search range
  through `slotQuerySchema`.
- `B03-04`: covered for mixed services (24 h and 48 h care time produce a 48 h
  return) and for a requested deadline that only the earliest pair meets; the
  later pairs stay visible as `DEADLINE_UNAVAILABLE`.

## Verification

- `apps/api/test/availability-v2.test.ts`: 9 tests on isolated PostgreSQL 17.
- Full `@laundry/api` suite: 202 tests passed.
- `pnpm contracts:generate`: 80 paths, 84 operations.
- `pnpm contracts:check` and `pnpm check` pass.

Cloud receipts are recorded in `evidence.json` after this commit is pushed.
These results do not claim approved operating hours, a real capacity plan,
native acceptance or production readiness. Production ordering remains
disabled.
