# Resume code review

Scope: pending git diff plus untracked `convex/` implementation. Read only. No files changed, no deploy, no browser run, no secrets access. Checked `convex/schema.ts`, `convex/engine.ts`, `convex/http.ts`, `convex/lib/ids.ts`, `convex/lib/validate.ts`, `convex/lib/hash.ts`, `convex/lib/errors.ts`, `convex/lib/conversation.ts`, docs in `docs/implementation/convex-engine-review.md`, `convex-engine-handoff.md`, `convex-http-handoff.md`, specs in `docs/specs/contracts.md`, `tools/verify-convex.mjs`, `.github/workflows/ci.yml`, and the tracked diff stat.

Verified with `npx tsc --noEmit -p convex/tsconfig.json`. It exits 0. That differs from the engine review note that reported 7 pre-existing errors. Either the errors were fixed since or the config changed.

## High

**Cancel accepts any authenticated role.** `convex/engine.ts:1025-1038` checks `if (!order || (me.role === "customer" && order.customerId !== me.id))`. A rider, facility, or operator token passes the check for any order id. The route also bumps version twice in one mutation (`CANCEL_REQUESTED` then `CANCELLED` at `convex/engine.ts:1047-1066`). I read this as wrong because contracts put cancel under ordering with version control, and data ownership says facility sees only its orders.

**Adjustment decision accepts any authenticated role.** `convex/engine.ts:1112-1124` has the same shape. Only the customer branch checks ownership. A rider token can accept or decline a price adjustment on someone else's order. Intake gates care on this decision, so this one matters.

**Draft confirm skips quote version check.** `convex/engine.ts:1926` calls `buildCheckout(ctx, me, quoteId, undefined)`. Direct checkout at `convex/engine.ts:958-964` passes through `expectedVersion` and `buildCheckout` rejects stale versions at `convex/engine.ts:400-404`. The draft path binds `draftId`, `revision`, and `quoteId` but never binds quote version. A stale quote can confirm through drafts after it would fail through `/v1/checkouts`.

## Medium

**Capacity holds are never released.** `convex/engine.ts:343` inserts `released: false`. The only filter is expiry plus `released` at `convex/engine.ts:336`. Cancel at `convex/engine.ts:1047-1066`, reschedule at `convex/engine.ts:1097-1108`, and quote expiry paths never patch `released: true`. The review doc already calls out orphan risk if quote insert fails. I also see no release on cancel or reschedule, and reschedule keeps both the old and new quote holds active. Bucket total is hardcoded to 2 at `convex/engine.ts:331` and the bucket key is an hour truncation at `convex/engine.ts:162-166`, so unrelated windows in the same UTC hour share one bucket.

**Reschedule does not check the new quote.** `convex/engine.ts:1095-1101` loads the new quote and copies its windows. It never checks quote expiry, hold expiry, or customer match beyond `q.customerId !== me.id`. It also does not check that the new quote address or totals match the order. The old hold stays active.

**Support and billing reads are wider than the ownership checks around them.** `convex/engine.ts:1253-1279` lets any role with a valid token read or append to any support incident id except the customer ownership branch. `convex/engine.ts:1284-1301` and `convex/engine.ts:1304-1317` do the same for payment detail and receipts. Only the customer branch checks ownership. A rider with a guessed incident or payment id gets data. Contracts say rider sees only current assignment and minimum handover data.

**Ops support patch allows facility.** `convex/engine.ts:1700-1702` allows `operator`, `admin`, and `facility`. `scopesFor` at `convex/engine.ts:73-80` gives `support:manage` only to operator and admin. Facility gets `orders:read` and `orders:write`. The route and the scope helper disagree.

**Facility order detail is unscoped.** `convex/engine.ts:1005-1022` checks customer ownership and rider assignment, then has an empty branch at `convex/engine.ts:1016-1020` for everyone else. Facility, operator, and admin can read any order. Contracts say facility sees only its orders. This may be intentional for demo, but the code does not enforce it.

**Idempotency covers six routes, the rest retry unsafe.** The `idem` helper at `convex/engine.ts:609-616` is used for reviews (`865`), quotes (`955`), checkouts (`961`), demo capture (`1220`), handover (`1425`), and draft confirm (`1908`). Cancel, reschedule, intake, care progression, ops dispatch and cancel, and support writes have no key scoping. A retried cancel after partial commit returns `INVALID_INPUT` instead of the original view because the status already moved.

**Webhook inbox table is unused.** `convex/schema.ts:273-275` defines `webhookInbox` with a `by_event` index. Nothing in `convex/engine.ts` reads or writes it. `convex/http.ts:176-186` rejects webhook and media lanes with 501 before dispatch. That matches the honest rejection claim, but there is no permanent provider event guard in code. Contracts require unique indexes for provider event ids independent of response cache TTL.

## Low

**Health reports `liveReady: false` always.** `convex/http.ts:97-113` hardcodes `liveReady: false`. The HTTP handoff doc says it is true only when demo is off and both provider sets are present. The verifier at `tools/verify-convex.mjs:129-131` only logs the value for prod. Either the doc or the code is stale. I did not check a live deployment.

**Provider status codes disagree.** `convex/lib/errors.ts:76-77` maps `PROVIDER_UNAVAILABLE` to 502. The engine throws it with explicit 501 everywhere through `requireProviderInDemo` at `convex/engine.ts:61-67`, and the HTTP transport rejects webhooks with 501 at `convex/http.ts:180-186`. The default mapping never fires for this code. Clients keying on 502 from the contract mapping will see 501 instead.

**Handover stores the OTP in clear.** `convex/engine.ts:1468-1473` writes `proofRef: parsed.otp` for OTP handovers. The order view correctly hides OTPs and `toJobView` does not expose them, but the `handoverActions` row keeps the code. This is demo custody data and it persists beyond the handover.

**Service review lookup is a substring match.** `convex/engine.ts:719-726` runs `canonicalJson(order.lines).includes(serviceId)` per review plus one order read per review. A UUID substring can match inside another field, and the loop is N plus one reads. Fine for demo volume, wrong if this list grows.

**Capacity PUT lets key and window drift.** `convex/engine.ts:1668-1697` takes a free form `bucketKey` plus `windowStart` and `windowEnd`, forces timezone to UTC at `convex/engine.ts:1676`, and patches only `capacityTotal` on existing keys. A caller can store a key that does not match the window, and later quote holds derived from `bucketKeyFor` at `convex/engine.ts:162-166` will never hit that row.

## CI and deploy notes

`pnpm check:convex` passes locally now, so the deploy step `pnpm exec convex deploy --typecheck enable` at `.github/workflows/ci.yml:66` should not trip on the old 7 error note. The deploy job triggers on push to `refs/heads/build/wandary` at `.github/workflows/ci.yml:49`, which matches the current `build/wandary` branch. Concurrency group is `laundry-production-backend` at `.github/workflows/ci.yml:51`. The repo and most docs use the name Wandary. That string mismatch only matters for grouping deploys. The job needs `secrets.CONVEX_DEPLOY_KEY` and has no environment guard or demo flag check in the workflow itself.

## What I did not verify

No live production claims. I did not run `tools/verify-convex.mjs` against demo or prod URLs, did not deploy, and did not open a browser. Findings above come from reading code and docs only.
