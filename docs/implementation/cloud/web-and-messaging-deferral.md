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
forces a clean Expo export; the deployment must be rerun and verified rather
than treating the initial hosted build as accepted.

## Backend checkpoint

The pinned empty Laundry release-candidate database was backed up before the
reviewed migration chain was applied without demo seeding. A separate non-owner
runtime role was created and verified against the actual privilege checker.
Runtime staff provisioning remains denied. Private inputs and backups remain
ignored and permission-restricted in `.data`; they are not repository content.

A managed Node Fetch entry imports the existing compiled Nest application,
without migrating, seeding or rewriting business routes. Provider database
aliases must match the explicitly configured restricted runtime credential;
an owner URL is not discarded or concealed. Actual hosted invocation is still
required before this backend is accepted.

Focused compiled API build/typecheck and 52 runtime/provider/HTTP/database tests
passed with messaging deferred. They are not live-provider or native-device
acceptance. Cloud secrets, real commercial sends and ordering activation remain
separate from publishing these application URLs.
