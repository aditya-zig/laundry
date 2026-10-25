# B01 staff boundary: invitations, binding and MFA lifecycle

Baseline: `e69b435`. This continues the coordinator identity integration inside
the owned allowlist (`modules/identity/**`,
`apps/api/src/features/identity/**`, canonical migrations). It is not B01
completion, not a contract freeze, and not production enablement.

## Implemented behavior

Canonical additive migration `009_staff_identity.sql` adds `identity_staff`,
`identity_staff_facilities`, `identity_staff_invitations`,
`identity_staff_mfa` and `identity_staff_mfa_enrollments`. Shared identity
rate buckets, audit and command-result tables are reused; nothing in 001-008
changes.

- The two published staff routes now have real handlers:
  `identity.staff.invite` (`POST /v2/identity/staff/invitations`) and
  `identity.staff.mfa` (`POST /v2/identity/staff/mfa`), both actor-scoped
  idempotency commands in the same keyed-hash/encrypted-cache discipline as
  the customer identity commands.
- Invitations are operator-approved intent records: `{phone, role,
  facilityIds, reason}` with a seven-day expiry, one PENDING invitation per
  phone (partial unique index), lazy expiry on trusted server time, FORBIDDEN
  when the phone already carries any staff provisioning record, and an audit
  entry `STAFF_INVITATION_CREATED` attributed to the caller's profile.
  `created_by` references the caller's provisioned staff row, not the
  request body.
- Nothing in the runtime can promote a phone into staff. Only provisioning
  (deployment-owner path, like the migration job) creates active
  `identity_staff` rows. OTP sign-in now binds the session actor from the
  provisioning record: active staff phones get their provisioned role and
  facility scope on issue and on refresh; deactivated staff phones sign in
  as plain customer actors. An invited-but-unprovisioned phone still signs
  in as `CUSTOMER` until provisioning.
- MFA is RFC 6238 TOTP: `ENROLL` mints a bounded 20-byte secret sealed with
  AES-256-GCM under the enrollment identity, ten-minute enrollment window,
  reuse of a live pending challenge (no secret or counter churn on repeated
  ENROLL), five-attempt lock per enrollment, envelope `CHALLENGE`. `VERIFY`
  checks the current/±1 step code and flips the bound record to `ENABLED`
  with a monotonically advancing version. `DISABLE` requires the published
  `expectedVersion` plus a valid current code and returns `DISABLED`; a
  stale version returns the published-route code `FORBIDDEN` and carries
  `currentVersion` in its envelope instead of the unlisted
  `VERSION_CONFLICT` code. Verification volume is bounded (`staff-mfa-verify`
  hourly bucket) exactly like the OTP paths.
- The device provisioning URI is exported only through the deployment-owner
  helper `mfaProvisioningUri(challengeId)` on the service. No HTTP route can
  reveal an enrollment secret, and the wire result never contains one.
- The contract emission gained only missing type exports
  (`StaffInvitationResult`, `StaffMfaResult`) for schemas that already
  shipped; no schema, route or wire bytes changed and the OpenAPI check
  passes unchanged.

## Deliberate limits (blockers, not waivers)

- RIDER is excluded from the MFA command role set exactly as the published
  route lists it. `RATE_LIMITED` remains produced by the shared bucket
  discipline as with OTP verification.
- MFA is not yet a session-issuance requirement (the frozen OtpVerify/Session
  wire carries no MFA challenge field), and session revocation on staff
  deactivation is not implemented. Both require an explicit contract
  revision before implementation.
- No invitation-message delivery exists: delivery of an invitation to the
  phone is an owner/operations process until a transport port is approved.
  No commercial or provider calls were made.
- Business modules, staff MFA "login must satisfy MFA" enforcement, verified
  WhatsApp linking, application session wiring and live/native acceptance
  remain outstanding per the B01 packet.

## Verification

- Focused suite `apps/api/test/identity-staff.test.ts`: 13 tests, including
  FORBIDDEN for customers/riders, audit attribution, lazy expiry,
  no-promotion from invitations, provisioned role/facility binding and
  deactivation fallback, five-attempt enrollment lock, drift tolerance,
  replay stability, version-gated disable, and the real SDK over HTTP with
  contract envelopes.
- Full `@laundry/api` suite: 174 tests on an isolated disposable PostgreSQL
  17 task instance. `pnpm check`, `pnpm contracts:check` and the whole
  workspace run pass on the working tree.
- Clean committed-source cloud receipts for `261779a`: Wandary checks
  run `40186614691` passed (6m59s) and Agent verification evidence run
  `40186614705` passed (4m47s). The Dependency security gate run
  `40186614628` fails by design: the retained audit artifact lists exactly
  one high advisory, `node-forge@1.4.0` (GHSA-86w9-cpqp-85rv, CVE-2026-85393)
  via `apps__customer>expo>@expo/cli`. No patched node-forge release exists
  in the registry; upstream fix work is tracked in digitalbazaar/forge#1152
  and expo/expo#51773. The boundary change introduced no new findings.

These results do not claim a deployed product backend, native/staff
acceptance, approved business configuration or production readiness.
Production ordering remains disabled.
