# B02 catalog, rate cards and pricing

Baseline: `2ca0398`. C01 is still `BLOCKED_CONTRACT`; this is implemented
against the corrected candidate recorded in
`docs/implementation/contracts/CATALOG-BOUNDARY.md`. No contract freeze, no
approved tariff and no production ordering is claimed.

## What is implemented

Canonical migration `011_catalog.sql` adds `catalog_services`,
`catalog_garments` and `catalog_rate_cards`. It seeds nothing. A database with
no operator provisioning has an empty catalog and cannot quote anything.

`modules/pricing` is a pure integer engine over a rate snapshot:

- KG lines apply `minimumBillableGrams` first, then the card's
  `weightIncrementGrams` with the card's explicit `NONE|CEIL|FLOOR` rounding,
  then convert grams to minor units with half-up rounding.
- PIECE lines multiply the per-piece amount by quantity.
- `BASE` applies once per line. `MINIMUM` adds only the shortfall to the line
  total. `TAX` and `FEE` are flat amounts applied once per basket.
- Presence of a KG line marks the basket provisional.
- Unapproved, inactive and not-yet-effective cards are refused, as are
  negative amounts, duplicate singleton components, a `PER_KG` card without an
  increment, and any `INCREMENT` component (the contract gives it no unit).
- Every arithmetic result is checked against the safe-integer range.

`modules/catalog` serves the four published public reads and the four operator
writes:

- `GET /v2/catalog/services` and `.../services/{id}` return published services
  with active garments whose eligibility includes the service code.
- `GET /v2/catalog/garments/eligibility` returns active garments only.
- `GET /v2/catalog/rates/effective` returns one summary per published service
  that has an approved, activated, already-effective card. The optional
  `serviceCode` filter narrows the list; an unpublished service with a filter
  is `NOT_FOUND`, and a published service without a card is omitted.
- `PATCH /v2/ops/catalog/services/{id}` and the three rate-card routes require
  an `OPERATOR` or `ADMIN` session. They run through the shared idempotent
  command executor, so replay returns the stored response, changed intent with
  the same key conflicts, and every accepted write records `v2_audit` facts
  and a reason.

Staff identity is injected as an authenticate callback rather than imported, so
catalog does not depend on the identity module's internals. `app.module.ts`
memoizes one identity instance for both feature modules.

A public service detail accepts an optional valid operator session to read an
unpublished service; an invalid or customer token falls back to the public
view, which returns `NOT_FOUND` for unpublished rows. This keeps drafts out of
the public surface while leaving operators a way to inspect what they are about
to activate. There is no ops list route, so this is the only staff read path.

Rate cards are immutable documents. `version` identifies the commercial
document revision and does not change on approval or activation. Approval and
activation only stamp timestamps, must happen in that order, and happen once;
a second call is `VERSION_CONFLICT` with `currentVersion`. Activating a card
with a future `effectiveFrom` is allowed and takes effect at that time. When
several cards cover the same service, the highest activated version whose
`effective_from` has passed wins. Older cards are superseded, never rewritten.

## Deliberate limits (blockers, not waivers)

- **No service or garment create route exists.** `ServiceUpdate` and the
  garment rows can only be provisioned by the owner/deployment path, as staff
  rows are today. An ops console needs contract routes for this; the current
  inventory has none.
- **`garments` inside `ServiceUpdate` is refused** with `INVALID_INPUT`.
  Garment eligibility is a separate entity with its own uniqueness, and no
  administration route exists to manage it. Silently accepting the field would
  have implied an edit that does not happen.
- **`INCREMENT` pricing is refused.** The published component has no unit,
  increment reference or rounding rule, so either interpretation would change
  approved prices.
- **Tax is a flat amount.** The contract has no rate or percentage field, so a
  percentage tax cannot be represented. Cards that need percentage tax wait for
  a contract revision.
- **`BOTH` services report one unit price.** `EffectiveRateSummary` carries a
  single price; the implementation reports the KG component when present and
  the piece component otherwise. A service that needs both prices needs a
  contract change.
- **Tiers, licensed asset metadata and approval workflow roles are absent**
  from the candidate. The product packet asks for licensed media attribution
  records; there is no field for them here.
- **Garment/service eligibility is not enforced by the pricing engine.** It
  takes a rate snapshot and quantities. B04 must reject a garment that is not
  eligible for the selected service before calling it.

## Scenario status

- `B02-01`: catalog reads and the pricing engine require an active service and
  an approved, activated, effective card. Quote-level enforcement belongs to
  B04 and is not claimed here.
- `B02-02`: covered by `apps/api/test/pricing.test.ts` for KG increments,
  minimums, CEIL/FLOOR/NONE rounding and PIECE totals with integer arithmetic.
- `B02-03`: mixed-unit baskets keep per-line units and per-line totals, and
  rate cards are immutable once written. Persisting the snapshot on a quote is
  B04.
- `B02-04`: catalog edits cannot rewrite an existing rate card, and unsupported
  component shapes fail clearly. Eligibility rejection is B04 as noted above.

## Verification

- `apps/api/test/pricing.test.ts`: 7 tests, pure arithmetic and refusal cases.
- `apps/api/test/catalog-v2.test.ts`: 6 tests on isolated PostgreSQL 17:
  published reads and garment filtering, effective-rate selection across
  versions and future dates, idempotent versioned updates with stale and
  changed-intent conflicts, lifecycle ordering, refusal of unpriceable cards,
  and the full path through the first-party SDK and HTTP envelopes.
- Full `@laundry/api` suite: 193 tests passed.
- `pnpm contracts:generate`: 80 paths, 84 operations.
- `pnpm contracts:check` and `pnpm check` pass.

Cloud run receipts are recorded in `evidence.json` after this commit is pushed.
These results do not claim a deployed backend, approved business configuration,
native acceptance or production readiness. Production ordering remains
disabled.
