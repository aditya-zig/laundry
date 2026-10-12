# Zen resume verification — deployed demo UI (independent QA, 2026-10-12)

Owner: independent QA delegate (FREE muse-spark). Scope: only this file and `docs/implementation/evidence/zen-resume/`. No code edits, commits, deploys, provider config. No WhatsApp, no unrelated tabs, no commercial calls. Timebox ~15 min. Browser: native Zen via open-computer-use MCP. Coordinator uses separate Chrome; untouched.

## Method

Used `list_apps` + `get_app_state` + `click` + `perform_secondary_action(jump)` in Zen. Customer tab was open on `https://laundry-customer-five.vercel.app`. Links used jump action (plain click did not navigate off-screen links). Address-bar `set_value`/`type_text`/`ctrl+l` did not drive navigation in this Zen build, so partner/ops deployed UI could not be opened in Zen in timebox. HTTP GET used only as read-only fallback for availability, not as UI proof.

Screenshots: native MCP returned accessibility trees only, no image blobs in this session. Saved redacted a11y snapshots under `evidence/zen-resume/` instead. No tokens/phone/OTP recorded. Demo fixture address retained (allowed).

## Customer — PASSED (deployed, demo-explicit)

URL: `https://laundry-customer-five.vercel.app`

1. Home renders: brand Wandary, tagline with DEMO build label, Delivering to Bengaluru 560001, Serving demo-area-bengaluru 09:00-18:00 Asia/Kolkata. PASSED.
2. Demo session: Account page says Signed in with a demo session. Phone verification required before real checkout. Sign out present. No fresh sign-in needed (restored session). PASSED.
3. Browse services loads 4 cards: Wash and Press from INR 79, Dry Cleaning from INR 199, Wash and Fold from INR 59, Steam Press from INR 39. All say No reviews yet. Prices state per-garment unit. PASSED.
4. Service detail (Wash and Fold): title, description, from INR 59 per garment, Indicative turnaround 36h, Final quote confirms return window. Garment T-shirt INR 59.00, quantity 1, Add to basket, Review basket. PASSED.
5. Add to basket: 1 item(s) added to basket. PASSED.
6. Basket: 1 x garment, quantity 1, Total garments 1, pickup window inputs (prefilled 2026-10-12T09-10Z), return 2026-10-17T18Z, Get quote and checkout. Prefilled past-today slot still accepted by backend (no NO_CAPACITY). Date-field `set_value` did not edit in Zen; proceeded with defaults per instruction to use future dates only if exhausted. PASSED with note.
7. Checkout: DEMO payment runs through labeled simulator never live charge. Saved Home (demo) address present. New-address form present. Request quote. PASSED.
8. Quote: Total INR 66.08 fixed, 1 x garment @5900 INR 59.00, pickup fee INR 0.00, Tax demo 12% INR 7.08, Return window 2026-10-13T22Z to 2026-10-14T04Z, Pay DEMO simulator. PASSED.
9. Checkout created: message Checkout created. Complete payment in hosted DEMO checkout below; order confirms after capture. Order prefix 1b9af60f (full ID withheld from report body, in evidence redacted). Hosted DEMO checkout URL uses demo.local (labeled simulator, not live). Track order button. PASSED.
10. Order detail/tracking: Status AWAITING_PAYMENT, No payment yet, Total INR 66.08, pickup/return windows, Tracking Pending CONFIRMED through DELIVERED, Simulate payment capture (DEMO), review gated (Reviews open after delivery. Only delivered orders accept one review each), Cancel order when allowed. PASSED.
11. Explicit demo capture: clicked Simulate payment capture (DEMO) -> Capturing... -> Status PICKUP_PENDING, Payment received, Done CONFIRMED, Done PICKUP_PENDING, Pending rest, DEMO capture recorded. Authoritative order status shown above. PASSED. No live charge claimed.

Defects in customer lane: none blocking. Note: date inputs not editable via a11y `set_value` in Zen; backend accepted default slot so no workaround needed.

## Partner — BLOCKED in Zen, availability only

Target: `https://laundry-partner.vercel.app`
- Existing Zen tab titled Wandary Partner (demo) points to `http://localhost:8082` (dead local), content empty. Attempts to navigate via address-bar click + `set_value` + `ctrl+l`/`ctrl+a`/`type_text`+Return and via `ctrl+t` new tab did not change URL. Native navigation blocked; no login/list/detail touched, no unrelated orders touched.
- HTTP fallback: GET / returns 200, title Wandary Partner (demo), expo web bundle. Proves deploy up, not workflow. Report as blocked, not passed.

## Ops — BLOCKED in Zen, availability only

Target: `https://wandary.vercel.app`
- No ops tab in Zen; same address-bar automation block prevented opening. No login/list/detail attempted to avoid touching unrelated tabs.
- HTTP fallback: GET / returns 200, title Wandary Ops (demo), vite bundle. Proves deploy up, not workflow. Report as blocked, not passed.

## Findings for main lane

- Customer demo journey works end to end on deployed Vercel + demo backend with honest DEMO labels, fixed quote math, gated review, explicit simulator capture.
- Partner/ops need main-lane verification or a Zen build where address-bar navigation works via computer-use. Do not claim live service. No production enabling done.
- Evidence: `docs/implementation/evidence/zen-resume/` contains redacted a11y snapshots (customer-home-services, service-detail, basket, checkout-quote, order-awaiting, order-captured, availability-http). No screenshots available from MCP in this session.
