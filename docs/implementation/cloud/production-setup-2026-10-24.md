# Production setup execution — 24 October 2026

Working branch: `work/production-direct-20261022`, based on `3232b2f`.
The founder authorized continuing the production build and account setup autonomously, using the existing signed-in Chrome session. That does not supply approved commercial values or authorize paid model/provider calls.

## Accounts and isolation

- Chrome DevTools connected to the user's existing Chrome via auto-connect. Existing personal tabs were left in place. No cookie/profile/credential extraction was used.
- Cloudflare's only account was created on 22 October and had no Worker scripts. Creating a dedicated `Laundry` account failed with the provider's seven-day account-age restriction. No unrelated project resources were reused or modified.
- A named Cloudflare CLI profile `laundry` was authorized with user-read, account-read, Workers-write, Workers-scripts-write and Workers-deployments-read scopes. The two legacy script/deployment scopes were added after the initial deployment was denied. OAuth storage is outside the repository. No payment method or paid plan was activated.
- The existing Neon Laundry organization and Free project `laundry-staging` (`broad-rain-86048848`, Singapore, PostgreSQL 17) were confirmed in Chrome.
- A project-scoped Neon API-key profile `laundry` was established. It is not an account-wide application credential.
- Created child branch `release-candidate`, `br-fancy-glade-a1tjuotr`, under the staging parent. Fixed 0.25 CU; Free default suspension retained. The API rejected explicitly setting the Free-plan suspension setting; no upgrade was attempted.
- The candidate was checked to contain zero users/orders. The existing staging parent was not reseeded or rewritten.
- Added `laundry_platform`, a non-owner read-only probe role with no role/database creation, no user-table reads, no order writes and no schema creation. Credentials are ignored, 0600 files under `.data/`, never committed.

## Infrastructure implementation

`infra/neon/src/platform.mjs` is a server-secret-authenticated, read-only infrastructure preflight, not the product API. It authenticates before opening a database connection, pins the branch/database, verifies required schema and rejects an overprivileged runtime role. Queries run read-only with bounded timeouts; driver exceptions and connection URLs are not returned.

`infra/cloudflare/src/gateway.mjs` is a fail-closed staging gateway. Liveness is separate from readiness. Readiness deliberately returns 503 and `productionReady: false`. All product routes and writes are disabled. The internal probe requires an independent operations token; only the gateway's own origin secret reaches Neon. Paths, queries, cookies and incoming user credentials are not forwarded. Origin URLs are pinned to native HTTPS Neon Functions, redirects are not followed, response fields are whitelisted and responses are no-store with security headers.

`infra/cloudflare/cloudflare.config.ts` supports staging only. There is no automatic production promotion. Workers.dev is a staging endpoint, not a custom-domain launch certificate. No WAF/custom-domain/Android/live-provider claim is made.

`neon.ts` declares only the infrastructure probe and private environment requirements. No AI Gateway, public bucket or live provider is enabled by this configuration.

Cloudflare CLI 1.0.0-beta.21 requires Node 24.22.0; the existing product toolchain was 24.20.0. A separate 24.22.0 deployment runtime was downloaded from nodejs.org and checked against its SHA-256 list, without changing the global product runtime. Cloudflare's new config/build APIs are beta and pinned in the lockfile; no migration of the NestJS product API to Workers was attempted.

## Legacy production safety repairs

- Production cannot enable demo identity even if `DEMO_MODE=true` is mistakenly supplied.
- Missing demo flags no longer seed demo identities, addresses, rates or promises.
- The legacy OTP adapter rejects real-mode request/verification before storing an undeliverable plaintext challenge or issuing a session. A real production identity module is still required.
- Legacy refunds are explicitly demo-only and cannot contact a commercial provider merely because keys exist. Missing live reconciliation cannot be labeled a successful refund.
- Rider/facility/system identities cannot read customer payment or receipt resources.
- Existing legacy/demo sessions are rejected by the authentication boundary when demo mode is switched off, including sessions minted before the switch.
- Removed anonymous manual-logistics event writes. Manual handovers must use authenticated assigned-job commands.
- WhatsApp draft linking verifies the claimed number against the signed-in account rather than accepting any claimed phone.
- The legacy acceptance DB guard now parses the URL and requires a loopback `laundry_verify_` database. Its old substring test incorrectly rejected a safe isolated database with `production` in the test label. No hosted database is permitted by the replacement.

## Verification before deployment

- New PostgreSQL production-safety suite: nine cases pass, each reproduced before its fix. The ninth closes preexisting legacy/demo sessions when real mode is selected, rather than only preventing new demo sessions. One initial assertion cascaded from a deliberately changed seed; test cleanup was corrected before the passing run.
- `pnpm check`: exit 0.
- `pnpm test:tooling`: 50 pass, including public-revision propagation and clean-tooling prerequisite/exit-code checks (the initial hardening run had 44).
- Full workspace tests on a fresh disposable PostgreSQL 17 Docker instance: exit 0, 612 tests across all suites including the gateway's 11 tests. The first broad run failed because the old DB guard matched the test label; it was not reported as passing.
- Complete workspace build with Node 24.22.0: exit 0, including both Expo web exports, operations, pilot console, API/worker and the staging gateway. An interrupted earlier build was not counted as a pass.
- Gateway staging Vite build: exit 0.
- Docker Desktop was stopped at session start. It was started for isolated acceptance; owned task containers were cleaned up. Downloaded binary experimentation was not substituted for PostgreSQL-backed evidence.

The CI workflow now uses an explicitly isolated `laundry_verify_ci` database, pins Node 24.22.0, runs tooling/contract checks and all four browser scenarios, and retains SHA-bound browser artifacts. Removed the automatic Convex deployment on ordinary branch pushes; it is not the canonical production backend. The checked-in platform deployment command refuses dirty trees, pins the Laundry account/project/candidate branch, keeps database credentials out of Cloudflare, validates the build before uploading, and records a private receipt. Fresh cloud runs for committed `537802956d1cbc23a4eb86025514762e22bec736` subsequently passed: Laundry checks `40096669816` and Agent verification evidence `40096669801`. Their success does not imply that a later revision passed.

## Actual staging deployment and recovery

- Deployed initial source `d1ad1cd4f643a54a7c2f054e7e0ab3b965633458` to the Neon `platform` Function and Cloudflare `laundry-platform-staging` Worker.
- Gateway: `https://laundry-platform-staging.aditya-s274adi.workers.dev`.
- Manual live probes returned liveness 200, readiness 503, anonymous gateway/native-origin 401 and authenticated edge → Function → restricted PostgreSQL 200. The latter explicitly returned `productionReady: false` and `productApiEnabled: false`.
- Cloudflare initially reported a missing subdomain despite the dashboard and authenticated API confirming `aditya-s274adi.workers.dev`. Binding the named Laundry profile to this checkout resolved the beta CLI helper's inconsistent credential lookup. The automated deployment command now performs that scoped binding.
- All four legacy/demo browser scenarios passed on clean commits `d1ad1cd` and `f31f7b9`, with the actual SDK/API/PostgreSQL and SHA-bound videos/traces. The recovery rehearsal also passed cleanly at `f31f7b9`.
- A later deployment succeeded but its receipt command failed because Cloudflare emits its progress/URL on stderr. The tool no longer scrapes human output: it verifies the pinned public endpoint actually serves the intended committed revision before issuing a receipt. Stale revisions, redirects, failures and unexpected production-ready claims fail that check.
- The new recovery rehearsal passed in its working-tree check: 36 public tables, every sequence, capture amounts, both completed custody legs and review uniqueness matched after `pg_dump`/`pg_restore` to a second empty PostgreSQL 17 instance. The first attempt failed because stopping the task container discards its tmpfs contents; the corrected rehearsal keeps the source running until the dump. Both attempts cleaned up their owned contexts. A stopped task database is not advertised as durable storage.
- `pnpm test:voice`: 23 adapter/tool tests pass; this is not production speech-provider acceptance. `pnpm check:convex`: exit 0; historical adapter compilation is not product backend activation.

Fresh GitHub run `40095269561` passed the pilot browser/restart job and uploaded its original artifact. The artifact was actually downloaded; ffprobe showed 1440×1000 at 25 fps, so it does not meet the required 1080p/30fps original-recording gate. The ordinary phone preview is 368×800 at 25 fps and is not called production recording evidence. A separate `pnpm verify:recording` command now captures only a task-owned 1920×1080 Xvfb display directly with ffmpeg at 30 fps, H.264, CRF 20; it drives headed actual-app browser scenarios at a reviewable pace, validates output metadata and hashes, and extracts three sample frames. This does not upscale or relabel an existing preview. Its clean-cloud run at `5378029` later passed; the downloaded original and all three sample frames were inspected. The original is H.264, 1920×1080, 30 fps, 38.433 seconds, with SHA-256 `6f5575466f11658a748f7c0c906d05252769badfcd3e414af5a7ab8ab75c0ff8`. Initial local metadata passed, but manual sample inspection found black frames: Chromium had inherited the host Wayland session rather than the Xvfb display. The recorder now clears Wayland variables, explicitly launches Chromium on X11, and refuses mostly blank samples in addition to requiring visual inspection. The earlier `40095269561` browser job failed because `pnpm test:tooling` did not build its contract prerequisite. Fresh run `40095269584` exposed an old source-substring test that required the now-forbidden automatic production branch deployment. Both were repaired: the public tooling command now builds contracts first (with three execution-level regressions), and the workflow test parses the declarative YAML into a typed model and checks the non-deploying verification policy. A subsequent cloud run passed the compile/unit stages but exposed a real multi-order selector assumption: the rider queue contained six pickup jobs after the API suites, while the browser test selected by customer/leg alone. The actual job card now exposes a stable delivery-ID test identifier, and the browser selects the ID returned by the real dispatch command. It does not delete other jobs, use `.first()`, relax assertions or fabricate a response. Both repaired workflows actually completed successfully at `5378029` (runs `40096669816` and `40096669801`). The downloaded Laundry checks artifact includes all four demo web scenarios, the original 1080p/30fps recording and a clean synthetic restore receipt: 36 tables, one delivered order, one capture, two completed delivery legs and one review. Earlier failed runs remain failed; the new runs replace rather than relabel that evidence.

`pnpm platform:verify` records nine current live checks in `.verification/platform-live.json`; `pnpm verify:restore` records the tested SHA, dirty state, archive digest and row fingerprints in `.verification/restore-rehearsal.json`. Neither receipt certifies the production-v2 application. Fresh cloud-runner/current committed recovery receipts must be checked rather than inferred from these working-tree results. These implementation results are not a launch approval.

## Dependency security gate

The next hardening change reduces the production-dependency audit from 56 advisories (including one critical) to two high findings. It upgrades NestJS and scoped transitive dependencies, with version-pinned compatibility patches for Metro's image decoder and Expo Router's query dependency. Local full build/check, 612 workspace tests and 59 tooling tests pass. The audit itself still exits 1 for Zod and node-forge; the separate security workflow is deliberately fail-closed, with no advisory waivers. See [the dependency handoff](dependency-hardening-2026-10-24.md). This is not security clearance or production enablement.

## Subsequent browser and artifact review

The actual service-detail reload returned 404 under the old static preview server. The [SPA routing repair](spa-preview-routing.md) adds a real browser reload regression and a task-only safe fallback server; it does not configure production hosting. A later artifact review also found 77% unused black canvas in an otherwise format-compliant 1080p recording. That footage is not treated as satisfactory full-frame review evidence. The [recording correction](recording-framing.md) separates phone acceptance from desktop recording viewports and adds a black-canvas gate; 68 tooling tests pass locally. At clean `b29d34d`, the corrected local original passed with only 3% black canvas in each visually inspected sample. That review then exposed sparse delivered-order tracking and cancellation affordance bugs; the [display repair](tracking-display.md) adds ten customer tests and real-browser assertions, bringing the local workspace count to 622. Later revisions require their own clean receipts.

## Still required for the actual product

Production v2 identity/business HTTP handlers and real app consumers, shared design/app work, verified phone/staff MFA delivery, complete due-at-return accounting, private media lifecycle, durable workers, signed provider callbacks, current native acceptance, restore rehearsal, approved rates/areas/capacity/care/refund policies and a physical fulfillment pilot. Production ordering stays disabled while these are absent. Founder approval cannot be invented from a request to finish autonomously.
