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

## Independent computer-use session — 13 October 2026

Native Zen accessibility interaction (element clicks and jump actions), grim
screenshots, and headless Chrome renders. The real-browser MCP extension was
not connected, so nothing here claims a full real-browser flow. No source
edits, no WhatsApp sends, no session tokens or OTP values recorded. One stray
coordinate click landed on a WhatsApp tab; nothing was opened or sent there.
Apps were mid-rename from Wandary to Laundry during the session. Aliases below
were live when checked.

Customer order `2ef2faf0` (synthetic, demo backend only):

- Pass: demo sign-in, service area `Serving demo-area-bengaluru 09:00-18:00
  Asia/Kolkata`, catalog cards with images and from-prices plus `No reviews
  yet` (Wash and Press INR 79, Dry Cleaning INR 199, Wash and Fold INR 59).
- Pass: service detail (48h turnaround, garment rows, quantity entries, Add to
  basket gives `1 item(s) added to basket.` and Review basket). Expo Router
  service/basket/checkout/detail navigation works on the deployed build.
- Pass: basket (line item, Remove, totals, pickup/return UTC entries, Get
  quote and checkout).
- Pass: checkout shows `DEMO: payment runs through a labeled simulator, never
  a live charge.`, saved address `Home (demo): 14 Demo Lane, Bengaluru
  560001`, quote `Total INR 88.48 (fixed)` with garment 79.00, pickup fee 0,
  demo tax 12% 9.48, return window 2026-10-14T10:00 to 16:00Z.
- Pass: order created with hosted DEMO checkout (`demo.local`) and Track
  order. Tracking shows the stage timeline and `Simulate payment capture
  (DEMO)`, then `Status: PICKUP_PENDING`, `Payment received`, Refresh order,
  and owner-only `Show handover codes (DEMO only)`.

Ops (`https://wandary.vercel.app`):

- Pass: restricted console with demo-only sign-in, order queue listing
  `2ef2faf0` as PICKUP_PENDING INR 88.48 CAPTURED, order detail with intake
  controls (sealed bag IDs, required reason, Record intake), care combo
  (IN_CARE, QUALITY_CHECK, READY_FOR_RETURN) with Advance care, and history
  timestamps. Dispatch board shows per-leg Assign and dispatch with the
  provisioned demo rider `dddddddd-dddd-4ddd-8ddd-dddddddddddd`.
- Blocked: assigning the pickup leg through the UI. The rider-ID text entry
  does not accept computer-use input (set, typed, and focused-then-typed
  values never commit; background typing is a known broken path), so legs
  stay BOOKED. No error is shown.

Partner (`https://laundry-partner.vercel.app`):

- Pass: DEMO MODE banner, `[DEMO] Sign in as Rider`, assigned task list, job
  detail with next action, Maps link, manual bag count, sealed bag IDs, OTP
  handover that asks the rider for the customer code and states codes are
  never displayed to riders, Verify and Complete Handover, and the exception
  flow. Detail was verified read-only on other synthetic orders; nothing
  belonging to another order was changed.
- Blocked: handover completion for `2ef2faf0`, since its pickup leg could not
  be assigned (above). Return-leg assignment, ops intake/care advance, and
  review submission were not executed for the same dependency reason.

Bugs and notes for the main fixes:

1. Basket line reads `1 x garment (22222222)`. An opaque id is shown instead
   of the garment name.
2. Schedule edits through assistive input did not apply. The order kept the
   default pickup window (2026-10-12) while the return window was
   server-computed (2026-10-14). Needs a real keyboard-user check to rule out
   tooling.
3. Partner support note still shows `+91-800-WANDARY` after the Laundry
   rename. Include it in the rename sweep.
4. Another agent is renaming Vercel projects concurrently. The three aliases
   above resolved during this session but may shift.

Mobile layout: 390px renders of customer home and ops sign-in show no visible
overflow. Visual check only, not a full audit.

Flow verdicts: customer browse to capture to tracking passes. Ops
queue/detail/dispatch UI passes except leg assignment, which is blocked by
input tooling. Partner sign-in, list, and detail pass except handover
completion, which is blocked by the same dependency. Not production ready.

Evidence in `evidence/deployed-ui/` (no secrets in filenames): `03`,
`04-customer-services`, `05-customer-home-signed-out`,
`06-customer-order-detail`, `07-ops-signin`, `08-partner-home`,
`09-partner-signin`, `10-ops-signin-desktop`,
`11-customer-home-mobile-390`, `12-ops-signin-mobile-390`, plus the earlier
`01` and `02` captures.
