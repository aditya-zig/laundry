# Live verification — persisted pickup-to-return flow + app bundles

Date: 2026-10-11 (UTC). Verifier: independent subagent, free/local tooling only.
No paid models or APIs used. No commits or pushes. No modules/apps source modified.

## 1. PostgreSQL

```
docker compose up -d postgres
docker exec <postgres-container> pg_isready -U wandary -d wandary
# -> /var/run/postgresql:5432 - accepting connections (port 5448 -> 5432)
```

## 2. API build + start

```
pnpm --filter @wandary/api build   # tsc -p tsconfig.build.json, clean
```

Note: `node apps/api/dist/apps/api/src/main.js` does NOT run (dist is
CommonJS while `apps/api/package.json` sets `"type": "module"`), and
`tsx apps/api/src/main.ts` from the repo root fails on parameter
decorators (picks up the root tsconfig without `experimentalDecorators`),
while `pnpm --filter` start fails to find `modules/schema/migrations`
(bundles cwd is `apps/api`). Working command from the repo root:

```
DATABASE_URL='postgres://wandary:wandary_dev_only@localhost:5448/wandary' \
PORT=4100 DEMO_MODE=true \
nohup ./node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json apps/api/src/main.ts \
  > /tmp/opencode/wandary-api-verify.log 2>&1 &
```

Readiness: `curl http://localhost:4100/v1/services` -> 200.

## 3. Persisted full flow (HTTP only, real PostgreSQL, no mocks)

Script: `/tmp/opencode/verify-flow.mjs` (plain `fetch`, `randomUUID`
Idempotency-Key headers, `expectedVersion` chaining throughout).

Request sequence:

1. `POST /v1/auth/demo` roles customer, rider, operator (tokens redacted).
2. `GET /v1/addresses` (customer) -> `66666666-...` demo address.
3. `POST /v1/quotes` service `11111111-...`, garment `22222222-...`,
   qty 2, pickupWindow `2026-12-20T03:30:00.000Z`/+1h `Asia/Kolkata`,
   `requestedReturnBy 2026-12-26T12:30:00.000Z`
   -> quote `4e410080-3673-4684-afb2-f9f55da61b60`, totalMinor 17696.
4. `POST /v1/checkouts` `{ quoteId }`
   -> order `5a7db16e-99a1-461f-9258-6e744fe7967b`,
      payment `79a078eb-07d9-4c13-abd3-01dda4b9281f`.
5. `POST /v1/demo/payments/:id/capture`
   -> status `PICKUP_PENDING`, version 3, `pickupOtp` revealed to customer.
6. Duplicate `POST /v1/demo/payments/:id/capture` -> same order id, no
   duplicate order. OK.
7. Distinct second customer via `POST /v1/auth/otp/request` +
   `POST /v1/auth/otp/verify` (`+91-90000-00111`), then
   `GET /v1/orders/:id` -> 404 `NOT_FOUND`. OK.
   (First attempt used a second `demo` login and got 200 because all demo
   customer logins share one demo id; OTP signup gives a distinct id.)
8. Rider `POST /v1/partner/jobs/:pickupId/accept`
   (job `c84f3746-93b4-4631-9451-7f4ea10dee38`), then handover
   `{ method OTP, otp <pickupOtp>, bagIds ["bag-1"], expectedVersion }`
   -> job `COMPLETED`. Order stays `PICKUP_PENDING` (pickup never
   delivers). OK.
9. Operator `POST /v1/ops/orders/:id/intake`
   `{ measuredLines: [{ orderLineId, quantity: 2 }], bagIds: ["bag-1"] }`
   -> `AT_FACILITY` v4. OK.
10. Operator care chain `IN_CARE` (v5) -> `QUALITY_CHECK` (v6) ->
    `READY_FOR_RETURN` (v7), each with chained `expectedVersion`. OK.
11. Rider `POST /v1/partner/jobs/:returnId/accept`
    (job `db82fc3b-438c-4c54-a5c7-f562dc760877`), then handover with
    customer-revealed `returnOtp` -> job `COMPLETED`.
12. `GET /v1/orders/:id` -> status `DELIVERED`, version 8. ASSERT PASSED.

Flow statuses: PICKUP_PENDING -> AT_FACILITY -> IN_CARE -> QUALITY_CHECK
-> READY_FOR_RETURN -> DELIVERED.

Note: one leftover partial order `a21ff7c5-...` (status PICKUP_PENDING)
remains from the aborted first script run (second-customer assertion);
local dev DB only, harmless.

## 4. App bundles (static, ports 4181-4183)

```
nohup python3 -m http.server 4181 --directory apps/customer/dist &
nohup python3 -m http.server 4182 --directory apps/partner/dist &
nohup python3 -m http.server 4183 --directory apps/ops/dist &
```

| App      | URL                   | HTTP | Bytes | Bundle reference |
|----------|-----------------------|------|-------|------------------|
| customer | http://localhost:4181/ | 200  | 1190  | `/_expo/static/js/web/entry-31be1815409f6f8b3451e683d8fa37fd.js` |
| partner  | http://localhost:4182/ | 200  | 1189  | `/_expo/static/js/web/entry-5d06c2eef5becdd4649f62524fcd9785.js` |
| ops      | http://localhost:4183/ | 200  | 403   | `/assets/index-DmD-93Zq.js` + `/assets/index-DTk9JQHB.css` |

Each served body is byte-identical to its `dist/index.html`
(`diff` clean). Only root HTML fetched; JS/CSS assets not executed.

## 5. Cleanup

Stopped only verifier-owned processes: API (`tsx --tsconfig
apps/api/tsconfig.json apps/api/src/main.ts`) and the three
`http.server 418x` instances. PostgreSQL container left running (shared
dev dependency, was already the prescribed startup step).

## Coordinator follow-up (2026-10-11, post-verification fixes)

- Fixed `modules/shared/src/db.ts` migration lookup: walks up from both cwd
  and module dir, so `pnpm --filter @wandary/api start` works from the
  `apps/api` cwd on a clean clone. No workstation absolute paths remain.
- Fixed `apps/api/src/main.ts` asset resolution the same way; removed the
  hardcoded workstation path. Verified `GET /assets/services/wash-and-fold.png`
  returns 200 image/png and the `.svg` original 200 image/svg+xml.
- Pinned `apps/api` start/dev to `tsx --tsconfig tsconfig.json` so decorator
  metadata resolves regardless of launch cwd. Verified `start` boots and
  listens from `apps/api` cwd (exit 143 was the planned timeout kill).
- Fixed conversation `shape()` dropping the return-deadline flag: ambiguous
  `return ...` phrases persist `returnNeedsClarification` on the draft, and
  both `reply` and `missingFields` report `return deadline (exact date and
  time)`. Wash-and-iron test now seeds an address first so the combined-service
  quote path is actually exercised.
- Browser execution: Real Browser extension not connected in this environment,
  and computer-use driving of the user's live Zen session (30+ tabs) could not
  reliably open localhost tabs (address-bar hijack, no localhost tab created).
  In-browser JS execution is therefore NOT claimed. What is verified: Metro
  production exports for customer (652 modules) and partner (649 modules) plus
  the Vite ops build succeed, all three serve HTTP 200 with the expected bundle
  references, bundles contain the Basket/Checkout/Tracking/Jobs/Handover/
  Intake/Dispatch/Refund screens, and app unit suites pass (8+6+6).
