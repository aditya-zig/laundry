# F04 — Handoff: bounded slice (operations workspace React mount)

Task: F04 operations workspace review/repair of RECOVERED UNINTEGRATED candidate source.
- Source: 887695fab281cd773700c18dcd701bcd6c96d8a5
- Inherited baseline: 16eddf74e29945932a8042d2aae88c944ea6c9f1
- Candidate OpenAPI SHA256: 1e14e90db26d9715e187b70e361a4283713f4a37396367635c09c36945227626
- Scope reminder: NOT C01-approved dispatch, NOT feature-complete F04, NOT production readiness.

## Status: IMPLEMENTED (bounded slice), verification green in the tested tree

Bounded goal delivered: `ProductOperationsApp` is exported (default + named) from
`apps/ops/src/pages/ProductOperationsApp.tsx` and implements:
- OTP + optional TOTP staff sign-in. Public identity endpoints (`POST /v2/identity/otp`,
  `POST /v2/identity/otp/verify`) go through the session foundation surface; in the app
  binding that is `getV2Client` from `src/foundation/session.ts`, adopted via
  `getFoundation().adoptAuthenticatedSession`. Provisioned staff pass `mfaCode`; the DTO
  omits it when not enrolled.
- Facility-scoped ops order queue (`listOpsOrders`, `GET /v2/ops/orders/queue`) and
  selected-order detail (`getOrder`, `GET /v2/orders/{id}`), rendered from DTO facts only.
- One server-permitted action: care advance (`advanceCare`, `POST /v2/ops/orders/{id}/care`)
  with retained idempotency keys across unknown outcomes. No other mutation is presented;
  unwired areas are labelled as not wired, never faked.
- Explicit idle/loading/error/empty/stale states; freshness stamps from an injected clock.
- Retained committed Framed sheet navy/teal direction (no resampling).

Owned writes (exactly the allowlist):
- `apps/ops/src/features/**` — `signIn.ts`, `opsQueue.ts`, `orderDetail.ts`,
  `careActions.ts`, `errors.ts`, `format.ts`, `useSyncedState.ts`
- `apps/ops/src/pages/**` — `ProductOperationsApp.tsx`, `ProductOperationsApp.test.tsx`,
  `vitest.owned.config.ts`
- `apps/ops/src/styles/operations.css`
- `docs/implementation/handoffs/F04/**`

Untouched as required: `apps/ops/src/{App.tsx,main.tsx,styles.css,api.ts,guards.ts,
components.tsx,foundation/session.ts}`, `apps/ops/{tsconfig.json,vitest.config.ts,
package.json,vite.config.ts,index.html}`, all packages (`api-client`, `app-foundation`,
`contracts`), backend, manifests, CI.

## Changed files

- `apps/ops/src/features/signIn.ts` — `SignInController` with deps
  `{ foundation: SessionFoundation; publicClient: () => V2Client }`; `requestOtp` /
  `verifyOtp(code, mfaCode?)`; session adopted via `foundation.adoptAuthenticatedSession`;
  `restore()` maps `initialize()` snapshots; `backToPhone()`; errors rendered as
  `PresentableError { code, message, traceId }`; invalid phone rejected pre-network.
- `apps/ops/src/features/opsQueue.ts` — `QueueController` +
  `createQueueController(deps: { runAuthorized, clock, staleAfterMs? })`; loads via
  `listOpsOrders({ limit: 50 })`; deterministic ordering (`prioritiseQueue`: ON_HOLD →
  AT_FACILITY → others, stable); freshness `loadedAt`/`lastGoodAt` from injected clock;
  refresh failure keeps rows, sets `stale: true` + `refreshError`; empty state explicit.
- `apps/ops/src/features/orderDetail.ts` — `OrderDetailController` +
  `createOrderDetailController`; `select(orderId)` parses the server Order; staleness via
  injected clock; refresh failure keeps previous detail with `stale` + `refreshError`.
- `apps/ops/src/features/careActions.ts` — `CareActionController` +
  `createCareActionController` + `nextStaffCareAction(order, role)`; SUPPORT blocked
  ("Care tools are limited to facility and operator staff."); `AWAITING_ADJUSTMENT` or a
  PROPOSED adjustment blocks with "customer must accept…" and sends nothing (F04-02);
  `advanceCare(orderId, target, expectedVersion, { idempotencyKey })`; unknown outcome
  (`UnknownOutcomeError`) retains key + frozen input `{ orderId, target, expectedVersion }`
  and `retry()` replays the IDENTICAL body + key; definitive `V2ApiError` retires the key
  and surfaces `code/message/traceId/currentVersion`.
- `apps/ops/src/features/errors.ts` — `PresentableError` + `describeError` mapping
  `V2ApiError` / `UnknownOutcomeError` / unexpected throw.
- `apps/ops/src/features/format.ts` — `formatInrMinor` (integer INR minor units, en-IN),
  `formatSignedInrMinor`, `formatWeight`, `formatCount`, `shortId`, `formatWindow`
  (timezone-qualified), `formatInstantInTz`, `formatClock`.
- `apps/ops/src/features/useSyncedState.ts` — React glue hook for controller state.
- `apps/ops/src/pages/ProductOperationsApp.tsx` — the deliverable: `ProductOperationsApp`
  (default + named export) composing `SignInView` + `OperationsWorkspaceView`; accepts
  injected `foundation` / `generateKey` props for tests; 15s queue heartbeat via
  `useEffect` + `setInterval`; `registerPrivateCache` invalidation on identity change;
  DTO-only rendering (unit-appropriate quantities, minor-unit totals, timezone windows).
- `apps/ops/src/pages/ProductOperationsApp.test.tsx` — 14 focused behavior tests using the
  REAL `createV2Client` (mock `fetchImpl`) and REAL `createSessionFoundation` (memory
  stores); views asserted via `renderToStaticMarkup` (jsdom/testing-library not installed).
- `apps/ops/src/pages/vitest.owned.config.ts` — owned vitest config (root =
  `apps/ops`, include `src/{features,pages}/**/*.test.{ts,tsx}`) because the default
  `vitest.config.ts` only includes `test/**` and is not owned by this task.
- `apps/ops/src/styles/operations.css` — scoped `ops-*` classes retaining the committed
  navy/teal framed-sheet direction (flat 1px borders, ≤3% color-on-data, no fake KPIs).

## Commands and results (actual runs in this tree)

- `pnpm --filter @laundry/ops exec vitest run --config src/pages/vitest.owned.config.ts`
  → **14 passed (14)**, 1 test file passed.
- `pnpm --filter @laundry/ops check` → **clean** (`tsc --noEmit` exits 0).

Failures encountered and fixed during the loop (kept for honesty):
1. Owned vitest config root was off by one level ("No test files found") — fixed to
   `apps/ops`.
2. `SignInController` constructor mismatch (page used deps object, tests used bare
   foundation) — reconciled to the deps object everywhere.
3. Test harness adopted sessions without awaiting `adoptAuthenticatedSession` →
   `authorized()` threw UNAUTHENTICATED — made helpers async and awaited.
4. Missing `createQueueController` / `createOrderDetailController` /
   `createCareActionController` factory exports — added.
5. Test fixture violated the KG-line contract (`garmentTypeId` present on a KG line) →
   zod parse failures surfaced as queue/detail error states — fixture corrected.
6. `formatClock(undefined)` for detail freshness (`DetailState.ready` has `loadedAt`, not
   `lastGoodAt`) — `FreshnessLine` now uses `loadedAt` with an invalid-instant guard.

## Scenarios verified by the owned tests

- OTP request with only the phone; verify with code + TOTP; keyed mutation; `mfaCode`
  omitted when not enrolled; `Authorization: Bearer …` after adoption.
- API failure surfaces `code`/`message`/`traceId` verbatim (no paraphrasing).
- Invalid phone rejected before any network call (`INVALID_INPUT`).
- Queue load: freshness stamp from injected clock (`2026-10-12T05:00:00.000Z`), GET on
  `/v2/ops/orders/queue`, no client-side scoping tricks.
- Refresh failure keeps previous rows, marks `stale`, keeps `refreshError`.
- Explicit empty state: exactly "No orders in this queue yet." — never fabricated rows.
- Deterministic queue ordering (exception ahead of resting).
- Detail renders DTO facts only ("4,500 g", "Measured 5,300 g", "Asia/Kolkata",
  `shortId`, minor-unit totals).
- Care advance: exact body `{ target: "IN_CARE", expectedVersion: 3 }`,
  `Idempotency-Key: wired-care-key`, `Authorization: Bearer session-access-token`;
  response adopted.
- F04-02: care blocked while customer has not accepted an intake adjustment; zero
  network calls.
- VERSION_CONFLICT surfaces the server's `currentVersion` (7); no fake success.
- Unknown outcome: two retries with identical bodies and the same key; phase stays
  honest ("unknown" until a definitive outcome; idle only after a real success).
- SUPPORT role cannot start care; FACILITY can (F04-01 role honesty).

## Not done / honest limits

- No browser acceptance in this environment (no browser tooling available here): the
  coordinator must mount and inspect the actual apps in a browser before claiming full
  F04 acceptance. Mounting instructions: compose `ProductOperationsApp` from
  `apps/ops/src/pages/ProductOperationsApp.tsx` in `apps/ops/src/App.tsx` (coordinator
  owned) — the component takes optional `foundation` / `generateKey` props and defaults
  to `src/foundation/session.ts` bindings when omitted.
- PostgreSQL-backed acceptance tests, duplicate-payment/webhook replay, ownership/role
  checks on the backend, stale quote/order versions, pickup/return custody, capacity
  promises, post-delivery reviews, and conversation draft confirmation are out of this
  slice's bounded scope and remain open for the wider F04 task.
- Fixture mode vs live mode: the page uses the real session foundation and real SDK
  client; no demo capture, demo login, messaging outbox, or simulated delivery is
  presented anywhere in the UI. Tests inject fixtures at the fetch boundary only.
- Remaining F04 scope (intake recording, quality-check recording, hold/exception
  resolution, dispatch, reconciliation, refunds, conversations, dead-letter tooling) is
  intentionally absent; panels explain they are not wired rather than presenting dead
  controls.

## Handoff state

- Source tree status: implemented and verified in the tested working tree; nothing
  committed (no commits were requested or made).
- Source: 887695fab281cd773700c18dcd701bcd6c96d8a5 · baseline
  16eddf74e29945932a8042d2aae88c944ea6c9f1 · candidate OpenAPI SHA256
  1e14e90db26d9715e187b70e361a4283713f4a37396367635c09c36945227626.
