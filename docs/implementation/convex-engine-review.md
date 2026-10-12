# Convex engine review — safe cloud deployment hardening

Date: 2026-10-12. Scope: `convex/engine.ts`, `convex/lib/**` only. No root/HTTP edits, no deploy.

## What was wrong in live mode

1. `POST /v1/checkouts` (`buildCheckout`) minted a `provider: "demo"` payment row and a demo payment URL even with `DEMO_MODE` unset. Same for the adjustment `ACCEPT` top-up path. A live checkout would have looked real.
2. `POST /v1/auth/otp/request` inserted an OTP challenge in live mode that no SMS provider ever sends, and `verify` could then mint a session. `lib/ids.ts` falls back to `Math.random` when Web Crypto is missing, which must never secure real sessions.
3. `POST /v1/ops/refunds` inserted `status: "SUCCEEDED"` unconditionally, faking a live refund.
4. `POST /v1/demo/conversations/messages` was not DEMO-gated despite being a simulated draft lane.
5. Catch-all returned `e.message` to the wire, leaking internals.
6. `toOrderView` returned `pickupOtp`/`returnOtp` and raw `adjustment` internals. The shared SDK `orderSchema` strips unknown keys, so OTP reveal via the order view never reached typed clients anyway, and adjustment extras (`measuredLines`, `bagIds`, `topupPaymentId`) did not match the schema exactly.
7. Handover idempotency hashed only `{ jobId, actionId }`. Same key plus different bags/method/proof/version would have replayed a stale `COMPLETED` view instead of 409.

## Changes made (engine.ts, lib/ids.ts)

- Added `requireProviderInDemo(lane)` throwing `PROVIDER_UNAVAILABLE` 501. Applied before any writes to: OTP request, OTP verify, `buildCheckout`, adjustment top-up creation, `POST /v1/ops/refunds`, `POST /v1/demo/conversations/messages`. Live callers now fail closed; nothing simulated commits in live mode. Explicit `/demo/*`, `/auth/demo`, capture, handover-code, media proof, and `seedDemo` keep the existing `requireDemo` 403.
- OTP request now always returns `{ challengeId, demoCode }` in DEMO_MODE only; the live branch that returned a bare unsent `{ challengeId }` is gone. Verify no longer has a live "no account" branch.
- `lib/ids.ts` header documents the `Math.random` blocker: demo-only sessions/OTPs until a real provider plus verified strong randomness lands. No new crypto code; gating is the fix.
- `toOrderView` narrowed to the exact SDK `orderSchema` shape: no OTP fields, adjustment projected to `{ id, status, deltaMinor, reason }`. Demo OTP reveal stays only on `GET /v1/orders/:id/handover-code` (DEMO-gated, customer-only).
- Handover idempotency payload is now `{ jobId, actionId, bagIds, method, expectedVersion, proofReference, otpPresent }`. Same key with different intent 409s; `handoverActions.by_action` remains the permanent second guard.
- Adjustment top-up: added pending-TOP_UP duplicate guard so a retried `ACCEPT` throws `REQUIRES_APPROVAL` without minting a second payment. The write-then-`REQUIRES_APPROVAL` shape is intentional and now documented at the throw site.
- Catch-all no longer echoes `e.message`. It logs privately via `console.error` with route plus `traceId` and returns generic `PROVIDER_OUTCOME_UNKNOWN / "Internal engine failure"`.
- Atomicity audit: every other route already prevalidates (auth, ownership, version, status, line checks) before its first insert/patch. The only intentional write-then-error paths are the OTP wrong-code attempt counter (must persist) and the top-up creation above (duplicate-guarded). Both are called out in the catch-block comment.

## Idempotency / versions / bags

- Scope stays `METHOD route-template` plus `actorId` plus canonical payload hash. Same actor/key/payload replays; same key with different payload or different actor 409s. Verified for quotes, checkouts, reviews, demo capture, handover, draft confirm.
- Bag handover: `bagIds` non-empty enforced by `parseHandover`; `COMPLETED` patch persists the submitted bags; only a RETURN-leg proof marks the order `DELIVERED`. PICKUP completion correctly leaves the order for facility intake (`AT_FACILITY` needs intake, not courier event).
- Versions: all state changes check `expectedVersion` and bump by 1 except cancel (two patches, `CANCEL_REQUESTED` then `CANCELLED`, +2 total) and rider accept / ops dispatch-cancel (no `expectedVersion` in the SDK contract; operator lanes carry no reason/audit row — see limits).

## Verification

- `npx tsc --noEmit -p convex/tsconfig.json`: 7 errors, all pre-existing in untouched regions (typed `insert`/`patch` never-shapes at lines ~311/348/725/973/1543). Zero new errors from this change; edited regions type clean. Generated Convex files read-only, no deploy.
- `pnpm --filter @wandary/contracts test`: 11 passed. `pnpm --filter @wandary/api-client test`: 8 passed. No contract/SDK files touched.

## Limits / blockers for production

- Auth, checkout/top-up payments, refunds, and demo conversation drafts are DEMO-only until real providers land (SMS, billing/hosted checkout, refund rail) plus verified strong randomness. Do not set `DEMO_MODE=true` in a live deployment to work around this.
- No real webhook, voice transcription, or media lanes in mutations; they return honest 501. Real dispatch belongs in actions/HTTP with provider credentials.
- Ops dispatch/cancel accept/reject without `expectedVersion` or reason audit; add both when the SDK contract grows them.
- Capacity holds can orphan if quote insert fails after hold insert; acceptable for demo, needs a hold-release sweep before pilot.
