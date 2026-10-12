# Authorization hardening — engine fix + regression verifier

Date: 2026-10-12. Scope: `convex/engine.ts`, `tools/verify-convex-authorization.mjs`, this doc. No deploy, no commit, no browser, no secret reading. No other files touched.

## Coordinator follow-up: deployed and verified

The coordinator subsequently deployed the hardened engine to development and
production (demo remains disabled in production). The real dev authorization
regression passed **23/23**, with rejected commands leaving order versions,
message counts and order counts unchanged. Redacted output is in
`evidence/convex-api/authorization-2026-10-12.txt`.

The assignment limitation described below is also resolved: operator/admin
manual dispatch now requires a provisioned rider ID and current job version,
validates the rider's server identity, records the assigning actor, and replays
same-key retries without another version bump. The SDK and ops UI send those
fields explicitly. Riders cannot self-assign or discover unassigned jobs.

Additional custody regression reproduced an OTP bypass through an arbitrary
provider-proof string (HTTP 200). Provider proof now fails closed pending verified
transport, inactive handovers and premature returns are rejected, and handover
action records no longer copy the OTP into proofRef. The expanded network suite
passed **57/57**: `evidence/convex-api/report-2026-10-12T07-56-43-569Z.json`.

Historical delegate findings below describe the state before coordinator follow-up;
remaining capacity/reschedule/idempotency and live-provider limitations still apply.

## Pre-fix regression (real HTTP dev, synthetic fixtures only)

Command:

```
node tools/verify-convex-authorization.mjs --base https://hidden-trout-436.ap-southeast-2.convex.site/v1
```

Result before fix: FAIL (pass 10, fail 13). Failed checks, all against live dev (`demoMode true`):

- `rider-cancel`: rider POST cancel on a customer order returned HTTP 200, order version 3→5 (order cancelled by wrong role, jobs cancelled, refund obligation minted).
- `adjustment-operator` / `adjustment-rider`: both HTTP 409, not rejected. The 409 is the top-up `REQUIRES_APPROVAL` path, which means the decision already mutated the order to `AWAITING_TOPUP` and minted a `TOP_UP` payment.
- `rider-list`: rider GET /v1/orders HTTP 200 (global order dump).
- `rider-timeline`: rider GET order timeline HTTP 200.
- `support-create-rider` / `support-read-rider` / `support-message-rider`: all HTTP 200; rider message mutated the incident (messages 1→2).
- `payment-read-rider` / `receipt-read-rider`: both HTTP 200.
- `jobs-unassigned`: rider list contained unassigned BOOKED jobs with address/customerName.
- `job-detail-unassigned`: rider detail on unassigned job HTTP 200 with contact/address.
- `accept-unassigned`: rider self-accept HTTP 200, job left unassigned=false (assignment mutated).

Valid lanes confirmed intact pre-fix: customer list/detail, operator ops queue, customer support creation, customer payment read. Facility demo login is rejected 400 (`role must be customer, rider, or operator`), so there is no facility token path; that rejection is itself a recorded check.

## Engine fix (convex/engine.ts, un-deployed)

- Added `requireNotFacility` (403 fail-closed) called once after `/me`, before all business routes. Any facility credential is denied everywhere below auth.
- `GET /v1/orders`: customer own, operator/admin all, everyone else 403 (was: all non-customers got everything).
- `GET /v1/orders/:id` and `/timeline`: customer owner (404 otherwise), rider only with a server-side `assignedTo == rider.id` job on that order (404 otherwise), operator/admin allowed, all else 403.
- `POST /v1/orders/:id/cancel`: owning customer, operator, admin only. Rider/facility get 403.
- Adjustment decision: customer-owner only. Non-customer roles get 403, non-owner customers get 404.
- Support create/read/messages: owning customer, operator, admin only. Rider gets 403 (create/read/message), facility fail-closed.
- Payment and receipt reads: owning customer, operator, admin only. Rider gets 403.
- Rider jobs list/detail/accept: server `assignedTo == rider.id` only. Unassigned jobs are 404 everywhere (no contact/address leak, no self-assignment). Assignment stays with ops dispatch, which already accepts operator/admin only.
- Ops lanes (`GET /v1/ops/orders`, intake, care, capacity GET/PUT, support PATCH): operator/admin only. `facility` removed from every allow-list.

Preserved: customer/operator/admin valid lanes, demo auth/capture/handover-code/media-proof/seedDemo gating, handover and exception assignment checks, reschedule and draft-confirm customer-only rules, client guard untouched (no client files edited).

## Verification after fix (local only, no deploy)

```
pnpm check:convex
```

Result: exit 0, zero type errors. The full regression script was run pre-fix (red, above) but could not be re-run green because the fix is local-only: dev cloud still serves the old engine until main deploys. Do not interpret local typecheck as end-to-end proof.

## Ask to main

1. Deploy the engine to dev (`hidden-trout-436`) whenever ready.
2. Re-run `node tools/verify-convex-authorization.mjs --base https://hidden-trout-436.ap-southeast-2.convex.site/v1` and confirm PASS (expect `jobs-unassigned` to report no leak, `accept-unassigned` still unassigned, all rider wrong-role checks 403/404, counts stable).
3. Re-run the existing `node tools/verify-convex.mjs` custody flow only after an ops assignment path exists (see limitation).

## Limitations and unresolved findings (honest)

- Facility fail-closed is total: with no membership table, facility credentials cannot reach orders, ops, or support at all. Scoped facility access (assigned facilities/jobs) needs a membership design plus per-order checks; not attempted here.
- Rider assignment provisioning gap: `POST /v1/ops/deliveries/:id/dispatch` sets status but carries no assignee, and rider self-assign is now blocked. Fresh captures leave jobs unassigned and therefore rider-invisible, which is spec-correct ("unassigned inaccessible") but means the old demo custody flow (rider accept → handover → deliver) cannot complete until ops dispatch accepts an assignee or another assignment lane lands. The existing `verify-convex.mjs` custody checks will fail after deploy for this reason; that failure is expected, not a regression of this fix.
- `scopesFor("facility")` still returns order scopes; scopes are advisory only (enforcement is role-based plus the fail-closed guard). Left as-is to keep the diff narrow.
- Cancel performs two patches (CANCEL_REQUESTED then CANCELLED, +2 versions) and ops dispatch/cancel carry no `expectedVersion`/reason audit. Out of scope for this auth pass; flagged, not changed.
- Capacity holds can orphan if quote insert fails after hold insert. Out of scope; flagged, not changed.
- Timebox respected: no refund, capacity, or idempotency logic touched beyond the authz lines above.
