# Event-driven customer order tracking — GitHub #40

## Implemented slice (2026-11-11)

The customer order-detail route uses the existing shared v2 SDK and owned-order, timeline and custody-receipt reads. No wire contract, server state machine, provider integration or live-ordering gate is changed.

- All 13 order states have readable, state-specific copy, including approval, hold, cancellation and resolution. No fixed six-stage progress bar or inferred completed stages.
- Pickup and return attempts are distinct. Booking-unknown, failed and cancellation-pending dispatch are not successful handovers; completing a leg does not mark the order paid or delivered.
- History preserves every server event in server sequence, including rework and repeated states. Dates/windows use the window's service timezone, not the viewer's device timezone.
- The independent custody read shows declared/count-at-intake/weight/sealed-container facts. Missing measurement is not zero. A custody read failure does not hide order, billing or support.
- The screen labels its last successful read and explicitly says updates are not live. Failed refresh preserves the last snapshot with a prominent stale warning and hides adjustment/review mutations until a successful reread. Conflicting order/timeline reads are rejected rather than presented as one fresh snapshot.
- Order total, obligation, custody and delivery remain distinct. No fabricated rider position, ETA, payment settlement, refund, reschedule or cancellation capability.
- Existing identity-bound private-screen remount and async cleanup prevent cross-account retention. Order-detail navigation is keyed by order ID.

## Verification plan and scope

Test-first checkpoint `8fbac0175cd5bbb7fce9ad7abe5188ca8150c829` failed as expected because `./order-tracking` did not exist (126 existing customer tests passed). Log: `.data/verification/tracking-20261111/red.log`.

Presenter regressions cover every current order/leg enum, exceptional outcomes, unknown future dispatch status, missing versus explicit-zero measurements, overnight/timezone windows, invalid dates/timezones, crossed reads and repeated/rework events. The existing four-role synthetic PostgreSQL browser journey now checks booking, accepted intake and delivery summaries plus custody failure/retry, stale order reads, crossed-read rejection and 390/1280 px overflow/screenshots. Existing booking, adjustment, payment, private-review and support lost-reply tests remain enabled.

Implementation checkpoint is not yet a passing receipt. Record clean tested revision, commands, exits and artifact paths in the follow-up checkpoint. The browser runner uses owned Playwright sessions and disposable local PostgreSQL; it does not use personal cookies. No commercial API calls.

## Explicit remaining limitations

No polling/push refresh, live GPS, native-device or physical-fulfillment proof, new customer cancellation/rescheduling commands, broader tracking media, live authentication/provider approval, founder-approved pricing/capacity or subscription policy. Those gates are unchanged. GitHub #40 remains open until its evidence/acceptance scope is reviewed; this is not launch readiness.
