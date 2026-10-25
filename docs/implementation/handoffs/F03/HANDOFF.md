# F03 handoff — rider delivery app: SDK assignments, custody, handover states

Task: F03 · Issue: Redesign delivery app with real assignments, custody and offline recovery · Role: frontend-rider.
Worker: isolated cloud task F03.
Status: RUNNING (bounded slice).

## Identity

- Source SHA (candidate checked out): 887695fab281cd773700c18dcd701bcd6c96d8a5
- Inherited baseline: 16eddf74e29945932a8042d2aae88c944ea6c9f1
- Candidate OpenAPI SHA256: 1e14e90db26d9715e187b70e361a4283713f4a37396367635c09c36945227626
- Contract target: `laundry-wire-v2.0.0` (consumed; not edited)
- Design direction: committed Framed sheet (seed `1278588346`), navy/teal identity from `docs/implementation/handoffs/D01/HANDOFF.md`; consumes existing `apps/partner/src/theme.ts` tokens (surface #FFFFFF, tint #EEF4FF, ink #0F1F3D, action #0E7C7B). No resampling.

## Scope and ownership (exclusive)

- `apps/partner/app/index.tsx`, `apps/partner/app/jobs/**`, `apps/partner/app/history.tsx`, `apps/partner/app/account.tsx`
- `apps/partner/src/features/**` (new feature code + focused behavior tests live here)
- `docs/implementation/handoffs/F03/**`

Not owned and not edited: shared foundation (`apps/partner/src/foundation/session.ts` — read-only import), SDK (`packages/api-client`), contracts, `packages/app-foundation`, app layout/manifests, legacy `src/api.ts|jobs.ts|handover.ts|offline.ts` (left untouched; screens no longer import them), `apps/partner/test/partner-journey.test.tsx` (legacy v1 suite, left as-is; it is not a passing baseline for this slice).

## State at dispatch

- Legacy partner screens use the v1 demo client (`getClient().listPartnerJobs`, `demoSignIn`) — recovered, unintegrated, not v2. This run replaces the four screen files with v2-only SDK flows.
- Runtime peers B01 (identity) and B06 (logistics) are not integrated; all v2 calls go through `createAppSessionBinding` defaults (memory stores, browser-only) — a browser memory queue is NOT durable offline storage.
- Environment: no runnable browser/native app executed in this environment unless later evidence says otherwise; per-screen browser/native visual acceptance is expected BLOCKED_ENV.

## Bounded goal (this slice)

1. Sign-in: public OTP request/verify through the plain v2 client (`getV2Client().requestOtp/verifyOtp`) then `getFoundation().adoptAuthenticatedSession`. Optional staff MFA code field. No demo rider, no default phone.
2. Assigned job list/detail exclusively via `getFoundation().authorized(client => client.listJobs()/getJob(id))`.
3. Custody handover: `getFoundation().enqueueMutation({ routeId: 'logistics.rider.handover', params: { jobId }, body: Omit<v2.RiderHandover,'jobId'> })` — typed DTO (legAttemptId, expectedVersion, actionId, method CODE, 6-digit code, capturedAt, containerIds, garmentCount, condition, note?); result states are explicit: **confirmed online** (HandoverResult accepted), **outcome unknown** (UnknownOutcomeError; record retained in queue), **pending** (queued not yet sent/confirmed), **rejected** (non-retryable V2ApiError or accepted=false; not queued as success).
4. Custody receipt rendered from `v2.HandoverResult` only (custodyEventId, attemptCount, nextAttemptAllowed); no invented custody success, no expected code display.
5. Empty/unassigned/revoked tasks expose no customer data; logout invalidates private loads and clears local private state.

The old v1 dependency (F00 route freeze, durable native stores) remains a blocker for claims beyond this bounded slice.

## Plan

1. Focused failing behavior tests first under `apps/partner/src/features/` (session gating, data-leak guards, handover state machine, action-id/version preservation in the enqueue body, receipt honesty).
2. Feature helpers + screen rewrites (index, jobs/[id], history, account).
3. `pnpm --filter @laundry/partner exec vitest run` (occupied + scoped config) and `pnpm --filter @laundry/partner exec tsc --noEmit`.
4. Browser evidence only if actually executed, else BLOCKED_ENV in evidence.json.

## Commands run (log)

(appended as work proceeds)

## Blockers

- B01 identity integration (real backend) not present — auth flows run against SDK client only when a v2 base URL is configured; nothing here should be called production-ready.
- B06 logistics integration, F00 durable storage/native acceptance pending; memory queue is not durable.
