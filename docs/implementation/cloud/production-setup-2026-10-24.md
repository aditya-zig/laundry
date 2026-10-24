# Production setup execution — 24 October 2026

Working branch: `work/production-direct-20261022`, based on `3232b2f`.
The founder authorized continuing the production build and account setup autonomously, using the existing signed-in Chrome session. That does not supply approved commercial values or authorize paid model/provider calls.

## Accounts and isolation

- Chrome DevTools connected to the user's existing Chrome via auto-connect. Existing personal tabs were left in place. No cookie/profile/credential extraction was used.
- Cloudflare's only account was created on 22 October and had no Worker scripts. Creating a dedicated `Laundry` account failed with the provider's seven-day account-age restriction. No unrelated project resources were reused or modified.
- A named Cloudflare CLI profile `laundry` was authorized with user-read, account-read and Workers-write scopes. OAuth storage is outside the repository. No payment method or paid plan was activated.
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
- Removed anonymous manual-logistics event writes. Manual handovers must use authenticated assigned-job commands.
- WhatsApp draft linking verifies the claimed number against the signed-in account rather than accepting any claimed phone.
- The legacy acceptance DB guard now parses the URL and requires a loopback `laundry_verify_` database. Its old substring test incorrectly rejected a safe isolated database with `production` in the test label. No hosted database is permitted by the replacement.

## Verification before deployment

- New PostgreSQL production-safety suite: eight cases failed before the fixes; eight pass after. One initial assertion cascaded from a deliberately changed seed; test cleanup was corrected before the passing run.
- `pnpm check`: exit 0.
- `pnpm test:tooling`: 44 pass.
- Full workspace tests on a fresh disposable PostgreSQL 17 Docker instance: exit 0, 611 tests across all suites including the gateway's 11 tests. The first broad run failed because the old DB guard matched the test label; it was not reported as passing.
- Complete workspace build with Node 24.22.0: exit 0, including both Expo web exports, operations, pilot console, API/worker and the staging gateway. An interrupted earlier build was not counted as a pass.
- Gateway staging Vite build: exit 0.
- Docker Desktop was stopped at session start. It was started for isolated acceptance; owned task containers were cleaned up. Downloaded binary experimentation was not substituted for PostgreSQL-backed evidence.

The CI workflow now uses an explicitly isolated `laundry_verify_ci` database, pins Node 24.22.0, runs tooling/contract checks and all four browser scenarios, and retains SHA-bound browser artifacts. Removed the automatic Convex deployment on ordinary branch pushes; it is not the canonical production backend. The checked-in platform deployment command refuses dirty trees, pins the Laundry account/project/candidate branch, keeps database credentials out of Cloudflare, validates the build before uploading, and records a private receipt. The workflow itself still needs an actual fresh cloud-runner receipt.

Deployment URLs, clean-SHA browser receipts and cloud acceptance will be recorded separately after actual verification. These implementation results are not a launch approval.

## Still required for the actual product

Production v2 identity/business HTTP handlers and real app consumers, shared design/app work, verified phone/staff MFA delivery, complete due-at-return accounting, private media lifecycle, durable workers, signed provider callbacks, current native acceptance, restore rehearsal, approved rates/areas/capacity/care/refund policies and a physical fulfillment pilot. Production ordering stays disabled while these are absent. Founder approval cannot be invented from a request to finish autonomously.
