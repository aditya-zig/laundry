# E03 — Deployment and security audit (READ-ONLY, bounded)

- Task: E03, bounded review/repair slice. This is **not** release approval, not a C01-approved feature dispatch, not proof of completed B01–B10 integration or production readiness. The coordinator retains all acceptance/deployment authority.
- Investigated source: isolated cloud candidate `887695fab281cd773700c18dcd701bcd6c96d8a5` on inherited baseline `16eddf74e29945932a8042d2aae88c944ea6c9f1` (dispatch metadata). The session command allowlist blocks `git`, so the working-tree commit mapping could not be re-verified locally; status below is stated per inspection of the actual working tree.
- Candidate OpenAPI SHA256 (as supplied by coordinator): `1e14e90db26d9715e187b70e361a4283713f4a37396367635c09c36945227626` (`packages/contracts/openapi-v2.json` is present; no hashing tool was permitted, so the digest was **not** recomputed here).
- **Network is unavailable** in this environment. No package install, audit refresh, provider call, deploy or artifact upload was attempted or possible.
- Private `.data/**`, credentials and `.verification/**` receipts were **not** opened. No code, infrastructure, CI, manifest or migration was changed. The only written file is this audit.

## Commands actually run (this working tree)

| Command | Result |
|---|---|
| `pnpm --filter @laundry/app-foundation exec vitest run test/session.test.ts` | exit 0 — 22/22 passed (new app-foundation session/queue model) |
| `pnpm --filter @laundry/api exec vitest run test/node-http-fetch.test.ts` | exit 0 — 7/7 passed (node-http-fetch bridge suite) |
| Focused source inspection of `apps/api`, `apps/worker`, `apps/*/src/foundation`, `packages/app-foundation`, `modules/{shared,identity}/src`, `modules/schema/{migrations,proposals}`, `infra/{cloudflare,neon}`, `tools/cloud`, `infra/deploy/README.md` | done |

No API suite is owned by E03, so the placeholder `pnpm --filter @laundry/api exec vitest run THIS_TASK_DOES_NOT_OWN_API_TESTS` is not applicable (no fixes were made; no new test was added). Per-task scope: no PostgreSQL acceptance suite was claimed.

Note: `apps/api/dist` does **not** exist in this checkout (build artifacts are not committed). "Compiled runtime" inspection therefore relied on the committed build configuration (`tsconfig.build.json` rootDir `../..` → artifact path `dist/apps/api/src/main.js` matching `start`/`migrate` scripts and the Dockerfile CMD) and on `tools/cloud/verify-container.mjs`, which was written to build and exercise the real image. `packages/{contracts,api-client,app-foundation}/dist` exist in the tree.

## Hosting classification

**Executable product hosting (exists, partially):**
- `apps/api/Dockerfile` — real compiled Node 24.22.0 image, UID 1000, pruned `--prod` deploy outputs, separate migration entrypoint (`/app/api/dist/apps/api/src/migrate.js --apply`), non-root runtime, verified least-privilege runtime DB role and fail-closed production boot in `tools/cloud/verify-container.mjs:51-126`.
- `infra/deploy/README.md:10-28` documents the compiled-image, migration-job/runtime-role boundary, identity-maintenance worker (`start:identity-maintenance`), restore rehearsal (`pnpm verify:restore`) and recording checks.
- `docs/implementation/cloud/*` carry the supporting evidence notes (runtime-database-separation, dependency-hardening, production-setup).
- render.yaml / fly.toml are deploy *descriptors* for the API container only (unmaterialized hosts; see prerequisites).

**Existing disabled-product infrastructure probe (NOT product hosting):**
- `infra/cloudflare/src/gateway.mjs` + `neon.ts` + `infra/neon/src/platform.mjs` (`/internal/platform` preflight) explicitly return `PRODUCTION_NOT_ENABLED` / `productApiEnabled:false` for every non-GET method and for `/health/ready`; `tools/cloud/{provision,deploy,verify}-platform*` drive this probe. They do not mount, proxy or replace the NestJS API — consistent with the **staging-only** claim in `infra/deploy/README.md:30-40` and the pinned host/database (`laundry_staging` on a pinned Neon endpoint, `tools/cloud/provision-platform.mjs:8-11`). Nothing here may be counted as executable product hosting; the product API is a separate compiled process that is not part of the preflight.

## Highest-impact concrete findings (one short pass)

### F1 — The hardened fetch-host ingress (`node-http-fetch`) is not wired into any server entrypoint
- Evidence: `createNodeFetchHandler` is referenced only by `apps/api/test/node-http-fetch.test.ts`; grep shows no import from `apps/api/src/main.ts`, `app.module.ts`, the Dockerfile CMD (`node api/dist/apps/api/src/main.js`, `apps/api/Dockerfile:38`) or any render/fly descriptor.
- Failure scenario: the deployed API binds `HOST:0.0.0.0` through plain Express (`main.ts:56-59`), without the tested 401-before-allocation, loopback-only application bind, body-size/timeout caps, `x-forwarded-*`/secret stripping and `PROVIDER_OUTCOME_UNKNOWN` spread semantics. A reviewer could assume the production ingress exercises the hardened path when it does not.
- Suggested focused regression (for the owning task): an integration test that boots the real `apps/api/src/main.ts` composition in production `LAUNDRY_DATABASE_MODE=runtime` mode through `createNodeFetchHandler` (with an origin secret) and asserts the bridge tests' key behaviors against the actual application (401-first, 413 oversized body, header stripping), plus an entrypoint test asserting the declared CMD path uses the bridge when ingress mode is enabled. Reading-order: this is integration, not new feature work.

### F2 — The v2 job runtime has no start script and no deployment descriptor
- Evidence: `apps/worker/src/jobs.ts` (outbox dispatch, dead letters, privacy sweeps, `job_runs`/`job_dead_letters`/`job_privacy_runs` from canonical migration `018_jobs.sql`, now text-identical to `modules/schema/proposals/B10.sql`) exposes no script entry in `apps/worker/package.json:7-11`; `start` runs only the legacy demo outbox dispatcher (`src/main.ts:132` refuses production: `Legacy dispatcher requires explicit nonproduction DEMO_MODE=true`). The root `render.yaml` and `fly.toml` declare only `laundry-api`; the Dockerfile copies `/out/worker` but its CMD starts only the API (`apps/api/Dockerfile:38`).
- Failure scenario: with the compiled image the only realistic production vehicle is a hand-typed `node /app/worker/dist/apps/worker/src/jobs.js` command that no documented pipeline, schedule or descriptor runs; `v2_outbox` events, dead-lettering and retention/privacy sweeps would never run in a hosted environment, and the identity-maintenance batch would similarly be unhosted except by ad-hoc `docker exec` (as `verify-container.mjs:97` does once).
- Suggested focused regression: a deployment-manifest test enumerating required worker entries (job dispatch `--once`/loop, `--privacy`, `start:identity-maintenance`) and asserting each exists both as an npm script and as a compiled artifact path after `pnpm --filter @laundry/worker build` (e.g. `dist/apps/worker/src/jobs.js` present, script `start:jobs` exists). Also documented hosting prerequisites for a scheduling surface (cron/host service descriptor) before E03 can claim a rehearsed worker.

### F3 — Runtime-role verification covers identity tables only; business-module grants have no provisioning path
- Evidence: `modules/shared/src/runtime-database.ts:3` checks/forecasts only the 16 `identity_*` tables; `tools/cloud/verify-container.mjs:75-80` grants DML only for `left(tablename,9)='identity_'` tables. No shipped tool grants the runtime role privileges on the module tables (`v2_*` from `006_v2_transactions.sql`/`018_jobs.sql`, catalog, availability, orders, billing, logistics, reviews, support, conversation tables from migrations 006–019). No startup or process check asserts they exist.
- Failure scenario: a production boot with correctly restricted credentials passes `verifyRuntimeDatabase` and `/health` goes green, then every business query (quotes, orders, outbox claims, reviews) fails with SQLSTATE 42501. Operator discovers correctness only in mid-flight, after launch wiring.
- Suggested focused regression: (a) extend the required-table grant list (or a derived registry from migrations) checked in `verifyRuntimeDatabase`; (b) harness test that provisions a least-privilege role the same way the container harness does, runs the real booking/outbox path against it, and expects permission-denied *only* until grants are provisioned — i.e. the provisioning script becomes a tested artifact.

### F4 — App-foundation queue: deterministic-but-async failures discard retained intents
- Evidence: `packages/app-foundation/src/session.ts:216` removes the queued record on any `V2ApiError` with `status < 500 && status !== 401`. This includes `429 RATE_LIMITED` (and e.g. transient `460`-style provider-outcome codes) that occurred *after* an idempotency key was minted and potentially after the server accepted the command for later execution.
- Failure scenario: an offline rider sync attempts `logistics.rider.handover` with a retained intent; the API rate-limits the attempt (429). The queue record is deleted, so a later connectivity window cannot replay the same idempotency key; the rider must mint a new intent (new key), which contradicts the "retry retains the same key" rule (IMPLEMENTATION.md §4) and risks a lost handover record rather than a duplicate.
- Suggested focused regression (F00 owns `packages/app-foundation/**`): enqueue `logistics.rider.handover` through a fake wire client that first raises `V2ApiError(429, RATE_LIMITED)`, then allow-lists it; assert the stored queue still holds the record with the original `idempotencyKey` and flush succeeds with exactly one upstream mutation. Alternatively, the owning task may document why 429 is discardable, with an explicit code comment.

### F5 — Dependency/security gate is red (documented, unresolved)
- Evidence: `docs/implementation/cloud/dependency-hardening-2026-10-24.md:37-58`: `pnpm audit --prod` exit 1; two high advisories remain release-relevant — node-forge `GHSA-86w9-cpqp-85rv` (no patched version; Expo toolchain path) and Zod `GHSA-mrhx-c7xc-m3w5` (contracts/consumers pinned to 3.23.8, patched version is a 4.x major requiring a coordinated migration). The gate intentionally has no ignore-list and stays red.
- Status: a genuine blocker for the E03 security gate, not fixed by this audit; resolution belongs to the named owning tasks with real lockfile changes.

### F6 — Migration/rehearsal exclusions at this audit's authority level
- Not verified here (would require hosts/credentials/network/deploy authority, coordinator-owned): real migration rehearsal against a synthetic representative dataset with an independently restored backup (`E03-01` evidence), production TLS/certificate wiring, log redaction and monitoring wiring in an actual host, restore of an actual cloud snapshot, physical pilot evidence, mobile/native signing. None of these were performed and none should be marked passing from this audit.
- Also: this checkout contains no `apps/api/dist`, so no "booted compiled runtime" claim was possible locally without coordinator-owned build/preflight (`pnpm verify:container` needs Docker; not run).

## Exact missing prerequisites before production promotion

1. **Hosting**: a provisioned host for the API container (Render/Fly credentials, DNS, TLS termination, health-monitor wiring; the descriptors exist but the target is unconfigured), plus a **scheduled worker surface** (F2) — none exists for the B10 job runtime or identity maintenance worker.
2. **Database/runtime role**: a Laundry-owned PostgreSQL/Neon instance for *product* traffic (not the pinned `laundry_staging` preflight candidate) with a provisioned non-owner runtime DML role covering all business tables (F3), separately supplied migration credentials (`DATABASE_URL_UNPOOLED` + `LAUNDRY_ALLOW_MIGRATIONS=true` job only, per `apps/api/src/migrate.ts:4-11`), `sslmode=verify-full` cert chain.
3. **Secrets**: production `ORIGIN_SECRET`/`OPERATIONS_TOKEN` (platform probe), production identity keys (`hashKey`/`encryptionKey` distinct 32-byte hex), `LAUNDRY_SMS_HOURLY_BUDGET`, WHATSAPP secrets (required five-way at `runtime-config.ts:28-31` finally), and real CORS_ORIGIN HTTPS list.
4. **Providers**: configured laundry-owned live identity delivery provider (LIVE mode; `identityFromEnvironment` fail-closed at `identity.ts:47,218`), WhatsApp Cloud API/BSP credentials, storage/notification services, refund/payment-at-return provider — all currently fail-closed (`PROVIDER_UNAVAILABLE`); none are invented here and each activation needs explicit commercial authorization.
5. **Business inputs**: approved rate cards, service areas, capacity/turnaround, refund/manual-payment policy, staff provisioning ownership — the disabled-product gate (`/health/ready` 503, `productionReady:false`) stays relative to these, per E03-02.

## Migration/runtime-role split and staff-MFA notes (inspection results)

- **Migration/runtime split** is structurally sound: migrations never run from the API runtime (`DATABASE_URL_UNPOOLED`/`LAUNDRY_ALLOW_MIGRATIONS` refuse at `runtime-config.ts:22`; runtime refuses owner flags at `runtime-database.ts:20-23` and tests both fail-closed paths in the container verifier). Proposal tables are canonicalised (`B10.sql` ≡ `018_jobs.sql`, `B01-staff-sessions.sql` ≡ `019_staff_sessions.sql`, text-identical) — except F3's grant gap.
- **Staff-MFA binding** is consistent at inspection: enrollment challenge lifecycle with attempts/expiry (`identity.ts:452-500`), sign-in MFA issued only to staff phones with a single-use recorded TOTP step (`identity.ts:299-319`, `identity_staff_mfa_steps` primary-key anti-replay), family binding carrying staff/role/**mfa_version** (`identity.ts:260-319`) and revalidated on every authenticate/refresh/cached-replay (`identity.ts:116-152,190-198,343-347`), with production unconditionally enforcing MFA (`identity.ts:52`). No defect surfaced in this pass; a staff MFA-version-bound regression already exists conceptually in `identity-staff-login.test.ts` and `identity-staff.test.ts` (not executed here; API suites are not E03-owned).
- **App-foundation session/queue**: refresh-rotation journaling-before-send protects against transport-loss token replay (`session.ts:114-139`); eviction/quarantine of mismatches is explicit (`ports.ts:17-21`); the memory-only web defaults are honestly labeled (`ports.ts:1-2`); native secure IO is still un-proven (no native device acceptance existed for this audit). F4 is the one concrete queue defect found.

## Remaining blockers / handoff summary

- E03 remains `BLOCKED_*` in aggregate: hosting (F1/F2), database grants (F3), production business/provider inputs, and the red dependency gate (F5). E01/E02 evidence currency is coordinator-held and was not re-verified here.
- Peer-worker state: this isolated candidate has incomplete peer integration (feature/engineering trees present on the baseline). This audit treats missing peer evidence as *unrelated blockers*, not as failures owned by E03, and does not edit peer files.
- No production/deploy approval is granted or implied. The coordinator must re-run canonical preflight/consumer checks on its integration SHA before `VERIFIED`.

*Written by E03 bounded read-only audit. Update log: initial draft — hosting/secret/worker/provider prerequisites, six findings (F1–F6), hosting classification, command evidence.*
