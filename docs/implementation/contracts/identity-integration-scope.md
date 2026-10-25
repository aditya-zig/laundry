# Coordinator identity integration scope

Baseline: reviewed validator migration `a5dcc90`. Shared target remains
`laundry-wire-v2.0.0-candidate`; this is not a general C01 freeze or permission to
launch dependent workers. P01 has actual fresh-cloud PostgreSQL/browser receipts.

The current coordinator serially owns the following integration paths for the
production identity boundary: `modules/identity/**`,
`apps/api/src/features/identity/**`, identity composition in AppModule,
`apps/api/test/identity*.test.ts`, canonical migrations 007–008, narrow compiled
`apps/worker/src/identity-maintenance.ts` and legacy-worker production refusal,
non-owner runtime verification, the separate compiled deployment migration job,
and the associated shared contracts/configuration documentation. No concurrent worker lease is
created, no local child agent is substituted for a cloud worker, and root/lockfile
changes remain serialized. Verification runs locally and in fresh GitHub jobs;
local execution is never called a cloud-worker implementation receipt.

Public identity commands must not require a fabricated authenticated Actor.
Customer identity will use hashed OTP/session storage, encrypted idempotency
responses, bounded attempts/expiry/rate limits, refresh-family replay detection,
revocation and owned versioned addresses. The existing v1 demo verifier will not
accept v2 tokens and v2 will not accept demo tokens. Provider delivery is a port;
a real adapter requires explicit Laundry-owned configuration. Tests fake only the
external provider. Fake delivery cannot enable production startup.

Staff invitations/MFA, verified WhatsApp linking, provider acceptance and app
session wiring remain separate unverified requirements until actually integrated.
No customer signup may grant a staff role or scope. No production readiness claim
or business approval follows from this integration scope.
