# Hosted applications and deferred messaging

The user explicitly deferred messaging. The production environment can select
`LAUNDRY_IDENTITY_PROVIDER=disabled` and `LAUNDRY_WHATSAPP_MODE=disabled`.
This creates **no identity provider**, does not send messages, and does not
substitute demo sign-in. Missing or invalid configuration remains an error.
Authenticated operations and new ordering remain unavailable. This is not a
whole-product production-readiness claim.

## Hosting

- Customer: https://laundry-customer.aditya-s274adi.workers.dev
- Rider: https://laundry-rider.aditya-s274adi.workers.dev
- Operations: https://laundry-ops.aditya-s274adi.workers.dev

These are application bundles, not the infrastructure-preflight page. Public
hosting liveness is separate from readiness. `/health/ready` remains 503.
`/v1` demo API routes are not forwarded, missing assets are 404, and the native
API requires a server-only ingress secret. Mutations are not automatically
retried after transport loss. No public credentials or cloud accounts from
another project are used.

An initial real-browser inspection found that Metro retained a previous local
fixture API origin despite changed build environment variables. Deployment now
forces a clean Expo export. The clean exports were subsequently published and
the same-origin API connection was verified at source revision
`79a29e57e7bed057468e146bbfc8eaa17af3e7c3`; the initial cached build was not accepted.

## Backend checkpoint

The pinned empty Laundry release-candidate database was backed up before the
reviewed migration chain was applied without demo seeding. A separate non-owner
runtime role was created and verified against the actual privilege checker.
Runtime staff provisioning remains denied. Private inputs and backups remain
ignored and permission-restricted in `.data`; they are not repository content.

A managed Node Fetch entry imports the existing compiled Nest application,
without migrating, seeding or rewriting business routes. Provider database
aliases must match the explicitly configured restricted runtime credential;
an owner URL is not discarded or concealed. The compiled API is now deployed to
the Laundry candidate branch and connected to all three application origins.
Direct unauthenticated native access returns 401; authenticated native health
and the database-backed public catalog return 200. The temporary credential
inspection function was deleted after verification.

Focused compiled API build/typecheck and 52 runtime/provider/HTTP/database tests
passed with messaging deferred. They are not live-provider or native-device
acceptance. Cloud secrets, real commercial sends and ordering activation remain
separate from publishing these application URLs.

## Verified hosted checkpoint — 2026-10-25

The deployment verifier passed 21 native/public HTTP checks: ingress denial,
health, readiness, public catalog, disabled identity and rejected legacy demo
routes. All three public `/v2/catalog/services` endpoints now reach the product
API; they no longer return the disconnected-origin placeholder. Identity and
readiness deliberately remain 503, and new ordering remains disabled.

The deployed archive was extracted outside the repository and booted against
the restricted candidate database, without workspace dependency fallback.
All 115 production package versions were checked against the original
production dependency tree. An initial symlink-layout failure and a verifier
assertion incorrectly applied to an unauthorized health response were fixed;
neither failed run is recorded as acceptance.

Private deployment/verification receipts remain ignored in `.data`. This is a
hosted, deliberately gated checkpoint—not live messaging/payment, native-device,
physical-fulfillment, approved launch catalog/pricing or whole-product acceptance.
