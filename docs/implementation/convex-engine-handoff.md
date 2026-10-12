# Convex engine handoff

Scope: `convex/schema.ts`, `convex/engine.ts`, `convex/lib/**`,
`convex/README-engine.md`, this file. Nothing else was touched. No root
edits, no git actions, no cloud login, no deployment, no generated files.

## What was built

Real Convex functions, not a mock. `dispatch` is the only state lane and
is an `internalMutation` with frozen args `{ method, path, token, body,
idempotencyKey }` returning `{ status, body }`. There are no public query
or mutation exports, so HTTP auth cannot be bypassed. `seedDemo` is a
second `internalMutation`, demo-gated.

Covered routes, matching existing SDK and controller behavior: OTP
request and verify, demo auth, logout, me, addresses CRUD, WhatsApp
account linking, services list and detail, service-area check, reviews
(delivered-only, one per order), quotes (capacity plus deadline plus
expiry), checkouts (one per quote, version-checked), owned order list,
detail, timeline, cancel, reschedule, adjustment decisions, demo payment
capture, demo handover-code endpoint (customer owner only), support open,
get, and message, payment get, receipts, ops refunds and reconciliation,
partner job list, get, accept, handover (OTP, provider proof, audited
operator exception), exception, demo handover-proof ref, ops orders,
intake, care progression, capacity get and put, ops support patch, ops
deliveries list, dispatch, cancel, ops service upsert, rate-card mint,
review moderation, demo conversation messages, draft confirm, ops
conversation list and handoff.

## Wire behavior preserved

Order, payment, and delivery-leg states stay separate, with the same
status strings and transitions as the local modules. Order views carry
the same shape as the shared Zod contract, including timeline,
paymentStatus, adjustment, and deliveries. Handover OTPs stay
customer-visible only. Pickup completion never delivers an order. Intake
mismatches gate on adjustment or top-up before care. Late capture on a
cancelled order mints a refund obligation instead of confirming.

## How to bring it up

1. Main installs `convex@1.46.0` plus pinned `zod`, runs cloud login and
   codegen so `./_generated/server` exists. Do not hand-write that dir.
2. Set `DEMO_MODE=true` (exact match; anything else disables demo lanes),
   `ASSET_BASE_URL` to the Vercel origin, `APP_ORIGIN` for demo payment
   URLs, `DEMO_OTP_CODE` optionally.
3. Deploy, then run `seedDemo` once. It inserts synthetic demo users
   (`+91-90000-0000x`), the demo address, the four catalog services with
   `/assets/services/*.png` images and fixture prices, and rate card v1.
4. The HTTP lane maps each SDK call to `dispatch` with the bearer token
   as `token` and the `Idempotency-Key` header as `idempotencyKey`.

## Boundaries and extension needs

- Webhook lanes (`/v1/webhooks/*`), voice notes (`/v1/demo/conversations/voice-notes`),
  and media (`/v1/media/*`) return `501 PROVIDER_UNAVAILABLE`. The HTTP
  lane must verify HMAC or signatures before parsing, then call into the
  engine. Extending the frozen `dispatch` args for parsed provider events
  needs agreement first; do not change the args unilaterally.
- Refunds record local demo outcomes only. Real Razorpay dispatch belongs
  in actions with credentials main owns.
- Notification outbox rows are durable but unsent. Provider dispatch
  arrives later via actions; nothing here claims a message was delivered.
- Unimplemented state changers return honest 501, never fake success.
  Core customer, partner, ops, and conversation flows are all present, so
  the local and cloud demo stays connected without claiming a production
  merchant launch.

## Verification

Lib validators, canonical hashing, UUID shape, and the conversation
parser were executed locally and pass. Full route verification belongs
to the independent checker: run PostgreSQL-backed acceptance against the
deployed Convex backend and inspect the apps in a browser. No tests were
added here and no success is claimed beyond the scoped files.
