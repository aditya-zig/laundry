# F01 — coordinator integration checkpoint

## Provenance and status

The isolated F01 worker on source `b077c83e5da8ee4abf43b37f4f600ab652b7eb6e` timed out (exit 124). Its patch was recovered and reviewed, not accepted as finished work. The coordinator has continued integration in `/tmp/laundry-cloud-batch-20261025-01`; this checkpoint describes a **candidate**, not a deployed release or frozen contract.

## Connected product paths

- The actual Expo `(tabs)/index` reads public v2 services and rates. Synthetic rates remain visibly marked, and missing configuration, prices or services do not fall back to v1/demo data.
- Service detail, kg/piece bag editing, owned addresses, published slot pairs, server quotes and explicit due-at-return booking use the shared SDK/foundation. No schedule, rate, capacity or custody event is fabricated by the client.
- Checkout uses public OTP verification and adopts the returned session. Private screens are bound to the current customer identity; role/identity changes erase their view state. Orders and detail/history use v2 owned reads. Account and Help no longer present legacy demo login/chat as production integrations.
- New address capture validates explicit address fields and coordinates. Device positioning is requested only by the user's button; unsupported/denied positioning is explicit and no coordinates are guessed. Native location integration/device acceptance is still unverified. Saving an address does not promise coverage.
- Unconfirmed bookings retain their original quote version/body and command key. Navigating away and back recovers the pending intent before another booking is allowed. Retryable transport/provider errors and 408/429/5xx are not treated as definitive rejection. Definitively rejected quote/version terms are retired rather than replayed indefinitely.
- Browser pending-intent and token defaults are **memory-only**; process restart/reload durability and verified native secure storage are not claimed.
- Rider and operations sign-out now inspect local-erasure and server-revocation results rather than announcing unconditional success.

## Actual focused verification

`pnpm --filter @laundry/app-foundation --filter @laundry/customer --filter @laundry/partner --filter @laundry/ops check` passed.

The same four package test commands initially passed **194 tests**: foundation 30, customer 94, rider 36, operations 34. After the real-rate-array regression, full `pnpm check` and disposable-PostgreSQL `pnpm test` passed: **1,016 Vitest tests plus 11 gateway tests**. The workspace count includes 337 API, 148 SDK, 103 contracts and 231 fixture tests. Evidence: `/tmp/laundry-booking-checkpoint-types.log` and `/tmp/laundry-booking-checkpoint-tests.log` (private local logs, not committed). These checks apply to the candidate, not a claim of clean-SHA release approval.

The first web export exposed a real Metro resolution error in `apps/customer/src/api-v2.ts` (`./foundation/session.js`). Its app-source import was corrected to extensionless resolution; a fresh export passed. Actual browser inspection then caught the home page treating the effective-rate **array** as one rate (`INR NaN undefined`). The UI now indexes validated array responses, and passes the required `serviceCode` query; a regression checks the actual array shape. These defects were not hidden by the earlier passing unit/typing checks.

An isolated loopback-only disposable-PostgreSQL fixture composes the real compiled HTTP/services with explicitly **synthetic OTP delivery, rates and capacity**. It deliberately replaces the first committed booking reply with a 503/unknown envelope to test reconciliation. A TCP-close-only injection proved unsuitable for asserting an unknown screen because the browser transparently retried and recovered the original booking; that failed assertion was a test-injection issue, not a passed unknown-state check. That fixture is not a provider integration, production endpoint or approved launch setup. The initial actual-browser journey passed: public browsing, phone verification, new address, published slot, quote, post-commit 503/unknown, navigation out/back, same-key/body retry and exactly one order/obligation/pickup/event in PostgreSQL. A repeatable command is now `pnpm verify:customer-v2` (requires Docker and installed Playwright Chromium); it rebuilds the compiled services/packages and web app and creates/cleans its own disposable database. It also checks owned order/history navigation. A subsequent catalog styling change exposed an Expo `Link asChild` array-style crash (`Failed to set an indexed property [0] on 'CSSStyleDeclaration': Indexed property setter is not supported.`); the card now uses the existing router with `Pressable`, and the final repeatable command passed (exit 0), including owned order/history navigation and zero page runtime errors. Desktop and mobile pictures were opened and inspected. The command writes its source revision/dirty status alongside its ignored result and pictures; a clean-commit rerun is required before attaching release evidence. No browser failure is waived.

## Remaining release gates

- Current-SHA release/browser evidence, including migration of legacy demo-oriented browser assertions to the actual v2 UI; the prior `5a572d8` CI browser failures remain failures, not waived passes.
- Verified native token/intent storage, device builds/location and actual customer/rider physical acceptance.
- Customer cancellation, rescheduling, adjustment decisions, payment detail, reviews and support conversation UI are not yet connected; the screens say so.
- Live SMS/payment/storage/custody-notification/logistics/voice/messaging acceptance and commercial authorization; none was exercised by the synthetic fixture.
- Operator-approved launch rates, service areas/capacity and care/refund terms.
- Unresolved `node-forge` high advisory; dependency security remains red.

A direct-origin ordering-policy regression also exposed that the readiness response/gateway did not themselves prevent new orders in an independently exposed API origin. A coordinator-owned service gate now defaults closed in production and is explicitly closed in the actual API composition. It blocks new quotes/bookings inside the transaction work while leaving owned reads and cached same-key booking recovery available. Its red run reproduced the unintended new quote. The corrected full orders suite passed **28 PostgreSQL-backed tests**, including refusal without new rows and preservation of cached booking recovery and owned reads. API typecheck passed.

Production ordering/readiness remain disabled. No product deployment or end-to-end production-readiness claim follows from this checkpoint.
