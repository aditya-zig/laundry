# Quality check → return readiness: coordinator integration

Base: `887695fab281cd773700c18dcd701bcd6c96d8a5`. This is source integration, not a whole-product production release.

## Fixed boundary

A passed quality check now uses the command transaction to reconcile the booking obligation against the authoritative, accepted order total, open the return leg for the promised return window, and publish `order.ready-for-return.v2`. Order state/timeline, obligation, return leg, audit, outbox and command result commit together. Concurrent identical requests replay the same result; a failed peer operation rolls everything back. Failed quality checks do not dispatch returns.

The repricer holds the obligation lock shared with attempt creation and settlement. An unresolved payment attempt blocks repricing. Received money is not erased: if the final total is below money already received, the command requires explicit refund resolution and does not dispatch. No refund or provider capture is simulated. Real handover still requires authoritative settlement and custody evidence; opening a return leg is not delivery completion. Cross-module errors retain their actionable wire envelopes.

## Session repair

The app foundation retains the original command key and immutable payload across 429, 408, retryable and provider-unknown responses. A late authorized response after logout or a changed identity/scope is rejected rather than returned to the new screen. Tests cover identical replay and logout races.

## Actual verification

- Disposable Docker PostgreSQL: `orders-v2`, `billing-v2`, `logistics-v2`: **58 passed** (`/tmp/laundry-return-fixed.log`). This includes six new return-readiness scenarios: heavier/lighter accepted intake, concurrent replay, peer rollback, failed QC, pending payment and overpayment. Test prices, identities and providers are synthetic fixtures, not approved launch configuration.
- API `typecheck`: passed. The API has a `typecheck` script, not a `check` script; an earlier combined command failed on that incorrect script name after its PostgreSQL tests passed. That exit was not treated as passing verification.
- App-foundation tests: **25 passed**, with typecheck/build passed after the late-response regression was added.

## Not completed by this change

No live provider or physical fulfillment acceptance, product cloud deployment, Android/device acceptance, approved launch catalog/capacity/terms, or release-security waiver. The screen agents' candidates require separate review/browser verification. Ordering/readiness remain disabled until the relevant gates pass. The Node Fetch bridge is not an actual deployed product API.
