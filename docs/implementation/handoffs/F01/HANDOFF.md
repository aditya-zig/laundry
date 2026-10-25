# F01 handoff — customer booking slice (RECOVERED/UNINTEGRATED candidate)

Status: IN_PROGRESS (initial handoff, updated incrementally)
Base/inherited baseline: 16eddf74e29945932a8042d2aae88c944ea6c9f1 (declared by dispatch; not git-verified in this working tree — `git` is not an approved command in this cloud environment)
Candidate source SHA (declared): 887695fab281cd773700c18dcd701bcd6c96d8a5
Candidate OpenAPI SHA256 (declared): 1e14e90db26d9715e187b70e361a4283713f4a37396367635c09c36945227626
Contract target: `laundry-wire-v2.0.0` candidate schemas in `packages/contracts/src/v2/**` — **candidate, not frozen** (no C01 freeze exists in this tree)

This is review/repair of RECOVERED, UNINTEGRATED source, not a C01-approved
feature dispatch, contract freeze, completed B01-B10 task, or production
readiness. Missing endpoints are recorded as blockers; no DTOs or business
approvals are invented.

## Scope actually owned here

- `apps/customer/app/index.tsx` (new product home)
- `apps/customer/app/services/**` (existing `services/[id].tsx` refurbished)
- `apps/customer/app/basket.tsx`
- `apps/customer/app/checkout.tsx`
- `apps/customer/src/features/booking/**` (owned behavior + tests)
- `docs/implementation/handoffs/F01/**` (this file, evidence.json)

Everything else (app layouts `app/_layout.tsx`, `app/(tabs)/**`, shared
session `src/foundation/session.ts`, app adapter `src/api-v2.ts` file itself,
contracts, SDK, manifests) stays untouched; F00 owns layouts and is INCOMPLETE
in this recovered snapshot (F00 handoff records "(pending)" commands), so the
F00 route-map freeze is an open integration dependency.

## Plan for this bounded slice

1. Product home (`app/index.tsx`): server catalog via `getV2Client().listServices()`
   (public route `catalog.services.list`), real kg/piece units, honest
   empty/error/serviceable states; browser-side zone check only where the API
   exposes it (public route `availability.area` requires a server-side postal
   code — see blockers).
2. Service detail (`app/services/**`): server-driven garment eligibility
   (`catalog.garments` / service detail), quantity selection, custody vs price
   separation for KG lines (declaredGarmentCount + estimatedWeightGrams).
3. Bag (`app/basket.tsx`): owned persistent-capable basket, reconciliation of
   changed/disabled catalog lines, estimate labelled as estimate only.
4. Schedule: server slot pairs only via `getV2Client().listSlots()`
   (`availability.slots`); no typed ISO schedule form, no fabricated capacity.
5. Checkout (`app/checkout.tsx`): public OTP sign-in result adopted through
   `src/foundation/session.ts` (`apiV2.verifyAndAdoptSession` — public identity
   endpoint needs no prior session), quote via `apiV2.quote`, booking via
   `apiV2.bookOrderDurable` — process-memory-only persistence; NO native/durable
   acceptance is claimed.
6. Legacy demo routes (`app/(tabs)/**`, v1 `src/api.ts` demo session) remain
   unchanged behind their existing explicit DEMO labeling and demo sign-in.

## Changed files (updated as work lands)

- (pending)

## Commands and results

- (pending — recorded with real argv and exit codes after they run; no results
  are claimed before execution in this working tree.)

## Remaining blockers / integration requests for coordinator

- (pending, will be finalized)

## Explicit non-claims

No browser, native, provider, physical or PostgreSQL-backed acceptance has been
performed yet; this file is updated as evidence is produced. No production
readiness, contract freeze, B01-B10 integration, or pushed-branch claim follows
from this candidate work.
