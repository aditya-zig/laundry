# Cross-role browser acceptance and discovered fixes

Implementation update, 22 October 2026.
Scope: the existing v1 customer, rider and operations applications with real HTTP handlers and PostgreSQL, but explicitly demo identity/payment adapters.
This is not acceptance of the target v2 due-at-return product, a live provider integration or an Android build.

## Actual browser journey

`e2e/fulfillment.spec.ts` drives all three applications rather than fabricating API responses.
The customer selects two garments, chooses an India-local schedule, obtains a server quote, creates checkout and uses the labeled payment simulator.
Operations assigns a provisioned rider for pickup.
The rider submits a wrong code, verifies rejection, then submits the customer's actual code and records sealed bag custody.
Pickup does not deliver the order or enable a review.
The facility records intake and progresses through care, quality check and readiness for return.
The customer sees the return code only after that readiness.
Operations assigns the return leg and the rider completes its handover.
The customer sees delivery, submits one review and receives an explicit rejection on a second submission.
Direct database assertions verify the final order/payment state, exactly two completed delivery legs with the same bag, one capture and one review.

## Product defects exposed and corrected

1. India-local input returned `+05:30` instants while the v1 quote client requires UTC.
   The strict local-calendar parser now serializes the same instant as UTC without changing the displayed India date or clock.
   Regressions cover the quote schema boundary, midnight crossing and invalid dates/times.
2. The customer handover-code button called a route missing from the PostgreSQL API.
   The implemented route uses the existing response schema, permits only the owning customer in explicit demo mode, rejects rider/staff/other-owner requests and withholds early return codes.
   It is disabled when demo mode is off; it is not live secure code delivery.
3. The operations dispatch controller ignored the assigned rider and expected version, leaving jobs unassigned even after reporting success.
   Dispatch now validates the body and idempotency key, locks the delivery, checks version/state and rider provisioning, and commits assignment, audit, outbox and the replay result atomically.
   Regressions cover actual assignment, matching list/detail views, exact replay without duplicate audit, stale versions, invalid rider roles and completed-leg rejection.

Test-authoring corrections for route spelling, pending-pickup state, multiple leg cards, persisted rider sign-in, scoped selectors and the existing duplicate-review status are not counted as product fixes.

## Verification

The full cross-role journey passed against a fresh disposable PostgreSQL instance on the working implementation.
The broader workspace suite passed 592 tests, including five new API regressions and three new customer schedule regressions.
TypeScript checks passed across the workspace.
Tooling passed 33 tests, including a regression requiring fulfillment evidence even when all three smoke journeys pass.

Final committed-revision browser acceptance runs through `pnpm verify:browser` and retains its tested SHA, trace and original videos under ignored `.verification/`.
A working-tree test pass is not a clean-revision release receipt.
The manifest explicitly distinguishes legacy/demo coverage from production-v2 and native acceptance.

## Not complete

Live authentication and provider dispatch, real v2 business handlers/app consumers, native behavior, commercial activation settings, backup/restore and physical fulfillment proof remain separate requirements.
The existing hosted customer site still serves an older demo.
No production deployment, PR or merge is implied by these results.
