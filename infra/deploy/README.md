# Deploy notes (foundation)

Local services run via root `docker-compose.yml`. Do not start containers as
part of contract tests. Postgres listens on host port 5448 to avoid clashing
with a default 5432 install. Redis maps to 6381.

Production uses separate credentials, database, and buckets. Demo credentials
in `.env.example` are development-only placeholders.

## Cloudflare + Neon release-candidate preflight

This is disabled-product staging infrastructure, **not a production application**.
The existing NestJS/Expo applications have not been migrated by declaring an edge gateway.

- Cloudflare: `infra/cloudflare/cloudflare.config.ts`, staging mode only.
- Neon: `neon.ts`, pinned Laundry project/candidate branch in the deployment tool.
- Use Node 24.22.0+ satisfying the pinned Cloudflare CLI engine and pnpm 10.33.2.
- `pnpm platform:test` tests authentication, routing, redaction and fail-closed behavior.
- `pnpm platform:deploy` requires a clean commit, private `.data/platform.env` (0600), the Laundry CLI profiles and the restricted candidate database. It deploys the Neon preflight and Cloudflare gateway, not product ordering. Both provider profiles must be authorized for Laundry; it never signs in silently with another project's credentials.
- `pnpm platform:verify` runs nine live checks against the committed deployment and writes `.verification/platform-live.json`. Infrastructure success is not launch readiness.
- `pnpm verify:restore` creates two disposable PostgreSQL 17 contexts, drives the actual demo web flow, dumps/restores all public tables/sequences, compares row hashes/money/custody and checks review uniqueness after recovery. It retains only a private local synthetic archive and a public-safe receipt, then removes both contexts. This does not certify cloud point-in-time restore or real customer backups.

The Docker task harness uses tmpfs. `--keep` preserves its stopped container/workdir, **not its database contents across a container stop/start**. Recovery verification keeps the source running until the archive is complete.

Ordinary branch pushes do not deploy Convex or the product backend. CI tests and artifacts do not grant production-promotion approval.

Execution details: `docs/implementation/cloud/production-setup-2026-10-24.md`.
