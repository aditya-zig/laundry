# Deployed UI verification — 12 October 2026

## Scope and result

Real browser interactions on the three public Vercel aliases, using only synthetic
fixtures against development Convex. This proves a **demo software journey**, not
physical laundry, live payments, messaging or merchant readiness. No WhatsApp sent.

Independent free Muse QA verified customer booking/capture in native Zen; its
partner/ops navigation was blocked by desktop input. See `zen-resume-verification.md`.
Coordinator Chrome DevTools QA completed the cross-app flow below after fixes.
Screenshots are in `evidence/chrome-resume/`, with no session tokens or OTP values.

## Verified journey

- Customer `https://laundry-customer-five.vercel.app`: demo sign-in, four service
  cards with units/images, Wash and Press detail, quantity selection, basket,
  explicit future pickup dates, saved demo address, server quote INR 88.48,
  checkout showing pending payment, explicit demo capture, PICKUP_PENDING.
- Ops `https://wandary.vercel.app`: operator sign-in, order queue and detail,
  explicit assignment of this order's pickup to the provisioned demo rider.
- Partner `https://laundry-partner.vercel.app`: rider sign-in, assigned list,
  job detail, sealed bag ID entry and customer-supplied demo OTP. Pickup completes
  the **leg**, not the order. No customer OTP is displayed by the rider app.
- Ops: matching synthetic intake → AT_FACILITY → IN_CARE → QUALITY_CHECK →
  READY_FOR_RETURN, then explicit assignment of this order's return leg.
- Customer: owner-only demo code control refreshes authoritative status; return
  code is withheld before READY_FOR_RETURN and available after it. Code values
  were transferred privately for QA, never included in committed screenshots.
- Partner: matching synthetic return bag and customer-supplied return code
  complete the return leg.
- Customer refresh: DELIVERED, Payment received; review becomes available.
  Synthetic review submission succeeds; a second submission is rejected with
  `INVALID_INPUT: One review per order`.

Synthetic order prefix: `87ef6590`. A single test bag was used throughout. No
unrelated orders were changed by coordinator UI QA. The regression scripts create
and mutate their own separate synthetic fixture orders.

## Runtime and layout

No uncaught navigation/runtime console errors during positive customer, partner
or ops workflows. The intentionally repeated review generated the expected HTTP
400 console resource message. Form id/name accessibility warnings remain; this is
not a complete accessibility audit. Customer tracking rendered at 390×844 with
`scrollWidth == innerWidth` (no horizontal overflow); broader device/keyboard and
assistive technology coverage is pending.

Dependency-only Metro rebuilds succeeded after removing the speculative partner
resolver block (it referenced undefined `singleCopyDeps`). Current public aliases
were redeployed; new customer code controls, new partner bag-ID field and new ops
assignment controls were observed in the deployed bundles, not merely local code.

## Bugs found and fixed

- Expo Router crash: pinned the SDK52-compatible router/native dependencies;
  service/basket/checkout/detail navigation now works on deployed pages.
- Unassigned jobs leaking into rider lists: server assignment boundaries tightened.
- Wrong-role order/support/payment accesses: fixed and verified by 23 network checks.
- Missing manual assignment UI/API: operator assigns a verified rider with version
  control and idempotent replay, rather than permitting rider self-assignment.
- Fresh pickup had no bag IDs: partner now records actual sealed-bag identifiers.
- Wrong OTP/permission rejections were queued as offline evidence: authoritative
  non-retryable API errors are now shown directly rather than enqueued.
- Arbitrary provider-proof string bypassed OTP: fails closed until a verified
  provider lane exists; premature returns and inactive handovers are rejected.

## Remaining limits

Production still reports `liveReady=false`. Actual customer/staff/facility auth,
payments/refunds, WhatsApp/audio/media transport, rider contracts and business
configuration are not ready. See `cloud-deployment.md` and `resume-code-review.md`.
The ops intake UI currently defaults measured quantities to the quoted counts;
full garment reconciliation and persisted bag inventory need further work. Return
tracking can skip RETURNING and still show it as Pending after DELIVERED; no fake
transit event was inserted to make the timeline appear complete. Offline queue
persistence/retry recovery and full accessibility/device coverage are not certified.

Fresh checks: workspace build and both typechecks pass, 41 contracts/client/app
tests pass, 23 voice tests pass, cloud API 57/57 and authorization 23/23 pass.
Local PostgreSQL tests remain blocked by absent Docker daemon sockets. After
publication, GitHub CI run 38221382306 passed all 23 API acceptance tests with a
real PostgreSQL service, plus the production Convex deployment job. All three
Git-built Vercel artifacts were confirmed READY at source commit `8da4409` and
smoke-checked again. See `release-verification-2026-10-12.md`.
