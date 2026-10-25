# Deploy notes (foundation)

Local services run via root `docker-compose.yml`. Do not start containers as
part of contract tests. Postgres listens on host port 5448 to avoid clashing
with a default 5432 install. Redis maps to 6381.

Production uses separate credentials, database, and buckets. Demo credentials
in `.env.example` are development-only placeholders.

## Compiled Node image and identity boundary

`apps/api/Dockerfile` builds real CommonJS artifacts, installs only deployed production dependencies, and runs the API as UID 1000 under Node 24.22.0. It does not start the legacy worker automatically. API/worker `start` commands use compiled JavaScript; local `dev` commands retain tsx watch. Build before running the artifacts. The Docker context is allowlisted: private environment files, keys, logs, recordings, generated output and repository credentials must not even be transferred to the daemon.

`pnpm verify:container` requires clean committed source and a local Unix-socket Docker context. It exercises Docker's actual ignore rules with synthetic private-file canaries, builds the real image, verifies production refusal without configured identity, starts the compiled API against an owned PostgreSQL context without demo credentials, inspects non-root/pruned runtime behavior, and removes only its owned resources. The receipt is `.verification/container.json`; it is not whole-product readiness.

Legacy `/v1` catalog/serviceability, billing and conversation/provider controllers are explicitly nonproduction demo-only. They return 503 outside that mode; enabling v2 identity cannot expose synthetic catalog promises or activate historical provider callbacks. This intentionally does not present those legacy integrations as live production handlers.

Production API startup requires `DEMO_MODE=false`, a PostgreSQL URL with `sslmode=verify-full`, exact HTTPS frontend origins and explicit Laundry-only identity/provider keys/send budget. SMS settings remain empty in `.env.example`; configuring them is not provider, template/DLT, privacy or commercial approval. No paid SMS was sent during implementation. Ordinary JSON is bounded separately from the explicit nonproduction base64 voice fixture. The new v2 customer identity API and SDK/PostgreSQL checks do not complete staff MFA, the business modules or the applications' v2 session consumers.

`pnpm verify:restore` additionally restores synthetic v2 identity sessions/addresses and encrypted refresh replay. Independent deployment keys remain in process memory, not in the archive/receipt; missing keys fail closed. Production secret-vault/key recovery is a separate gate.

`pnpm --filter @laundry/worker start:identity-maintenance` runs the narrow compiled privacy worker; `--once` runs one bounded batch. It skips locked rows across replicas, logs only counts, and never sends provider messages. Run reviewed migrations first. Challenge PII and encrypted response secrets are redacted after expiry while hash-only replay tombstones persist. Families cannot rotate past their original 30-day security deadline. The legacy notification worker refuses production. See `docs/implementation/handoffs/B01/RETENTION.md`; whole-product B10 jobs are not completed by this worker.

`pnpm verify:pilot` builds contracts, SDK and the compiled API before the synthetic kilogram browser/restart journey. It does not depend on a retained developer dist directory.

Details and remaining scope: `docs/implementation/handoffs/B01/HANDOFF.md`.

## Cloudflare + Neon release-candidate preflight

This is disabled-product staging infrastructure, **not a production application**.
The existing NestJS/Expo applications have not been migrated by declaring an edge gateway.

- Cloudflare: `infra/cloudflare/cloudflare.config.ts`, staging mode only.
- Neon: `neon.ts`, pinned Laundry project/candidate branch in the deployment tool.
- Use Node 24.22.0+ satisfying the pinned Cloudflare CLI engine and pnpm 10.33.2.
- `pnpm platform:test` tests authentication, routing, redaction and fail-closed behavior.
- `pnpm platform:deploy` requires a clean commit, private `.data/platform.env` (0600), the Laundry CLI profiles and the restricted candidate database. It deploys the Neon preflight and Cloudflare gateway, not product ordering. Both provider profiles must be authorized for Laundry; it never signs in silently with another project's credentials.
- `pnpm platform:verify` runs nine live checks against the committed deployment and writes `.verification/platform-live.json`. Infrastructure success is not launch readiness.
- `pnpm verify:recording` requires Xvfb, xauth, ffmpeg and ffprobe. It records a task-owned virtual desktop directly at 1920×1080/30 fps/H.264/CRF20 and checks the original's metadata and digest; it is not an upscale of the small Playwright preview. Review the extracted sample frames as well as the metadata. It remains demo-web, not native or production-v2 evidence.
- `pnpm verify:restore` creates two disposable PostgreSQL 17 contexts, drives the actual demo web flow, dumps/restores all public tables/sequences, compares row hashes/money/custody and checks review uniqueness after recovery. It retains only a private local synthetic archive and a public-safe receipt, then removes both contexts. This does not certify cloud point-in-time restore or real customer backups.

The Docker task harness uses tmpfs. `--keep` preserves its stopped container/workdir, **not its database contents across a container stop/start**. Recovery verification keeps the source running until the archive is complete.

Ordinary branch pushes do not deploy Convex or the product backend. CI tests and artifacts do not grant production-promotion approval.

`pnpm release:security` is a separate fail-closed dependency gate; its scheduled/push/PR workflow retains the actual audit result. It currently fails on two high-severity Zod/node-forge advisories. Build/browser success is not security clearance. See `docs/implementation/cloud/dependency-hardening-2026-10-24.md` for compatibility patches, verification and unresolved blockers.

Web acceptance serves the exported apps with `tools/verification/serve-web.mjs`, a loopback-only SPA preview. It supports direct/reloaded app routes without treating missing assets or API routes as HTML successes. Production hosting must separately configure and verify its own rewrites; see `docs/implementation/cloud/spa-preview-routing.md`.

Execution details: `docs/implementation/cloud/production-setup-2026-10-24.md`.
