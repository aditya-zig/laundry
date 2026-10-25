# B01 staff login enforcement — handoff

Status: IMPLEMENTED (bounded slice; not INTEGRATED — canonical migration 019 and coordinator integration pending)
Worker: B01 isolated cloud task (staff login enforcement slice)
Source SHA: a34281a2bad86b67f5de0ae0742652fd6a4d3f82 (recovered unintegrated candidate)
Inherited baseline: 16eddf74e29945932a8042d2aae88c944ea6c9f1
Candidate OpenAPI SHA256: 1e14e90db26d9715e187b70e361a4283713f4a37396367635c09c36945227626
Contract: laundry-wire-v2.0.0 — NOT edited. Coordinator-added `OtpVerify.mfaCode` (packages/contracts/src/v2/identity.ts:21) and SDK `verifyOtp` opts.mfaCode (packages/api-client/src/v2.ts:219) are consumed as-is.
Tested working tree: the live checkout at the SHA above with only the owned files below changed; all results in this file were produced from this working tree in this session.

## Scope of this slice (not full B01 completion)

Production staff sessions (including RIDER) now require an enrolled current TOTP **and** the phone OTP at sign-in. Session families are bound to the provisioned staff identity, role and MFA version at issue time; the binding is rechecked on authenticate, refresh and cached credential replay. Customer login and existing nonproduction customer/staff-peer behavior stay compatible; enforcement in nonproduction is opt-in via `requireStaffMfa` for focused tests and can never be disabled in production.

## Owned files changed

- `modules/identity/src/identity.ts` — modified
  - `IdentityOptions.requireStaffMfa?: boolean`; effective requirement is `requireStaffMfa === true || NODE_ENV === 'production'` (production cannot opt out).
  - `verifyOtp`: after the phone OTP verifies, an active `identity_staff` phone must additionally present `mfaCode` matching the enrolled `identity_staff_mfa` ENABLED secret (drift window ±1 step, `MFA_STEP_MS`/`MFA_WINDOW` reused from totp.ts). Missing enrollment, missing/wrong code → `UNAUTHENTICATED`; attempts bounded by the existing challenge attempt cap (5) plus a new hourly `staff-login-mfa:<staffId>` bucket (10) and the existing per-peer verify bucket. The matched TOTP step is recorded via `INSERT … ON CONFLICT DO NOTHING RETURNING` into `identity_staff_mfa_steps` inside the same transaction — a replayed step is rejected atomically. Issuer isolation unchanged (challenge `issuer_mode` must equal provider mode; production requires LIVE).
  - Session families issued to staff are bound in `identity_session_staff_bindings` (staff_id, role, mfa_version at issue; NULL version = issued without an MFA-bound enrollment in nonproduction focus mode).
  - `actor()` no longer resolves staff by live phone lookup. Unbound families are customer-scoped for life — a customer session can never gain staff privileges after later provisioning. Bound families recheck staff active flag, role equality and (when bound) MFA version equality; on mismatch the family is revoked with reason `STAFF_UNBOUND` and the token fails (`UNAUTHENTICATED`) instead of degrading to a customer actor.
  - `refresh` rechecks the binding before rotation and returns `UNAUTHENTICATED` (revoking the family) so a held refresh token cannot mint new privileged tokens after deactivation/role change/MFA reset.
  - Cached credential replay rechecks the binding because every `command()` runs its `authorize` callback (→ `authenticated()` → binding recheck) before returning the sealed prior result.
  - Removed the now-dead phone-based `staffBinding()` helper. `maintenance.ts`, `totp.ts`, `provider.ts`, `errors.ts` and all existing MFA helpers untouched.
- `modules/schema/proposals/B01-staff-sessions.sql` — new, additive only (coordinator assigns canonical migration 019):
  - `identity_session_staff_bindings (family_id PK → identity_session_families, staff_id → identity_staff, role CHECK staff roles, mfa_version nullable >0, created_at)`
  - `identity_staff_mfa_steps (staff_id → identity_staff, step bigint, used_at, PK(staff_id,step))` + `used_at` index for future pruning.
- `apps/api/test/identity-staff.test.ts` — modified: applies the proposal in `beforeAll` (suite initializes its own proposal), adds the two proposal tables to its TRUNCATE, and the old deactivation case now expects `UNAUTHENTICATED` rejections for authenticate **and** refresh plus a persisted `STAFF_UNBOUND` family revocation — no customer fallback on the same token. A fresh sign-in after deactivation still yields a plain customer session.
- `apps/api/test/identity-staff-login.test.ts` — new focused regression suite (10 tests) with `requireStaffMfa: true` (plus one production-mode case); applies the proposal itself; FAKE OTP delivery only; the production case uses a LIVE-mode provider object whose `send` is an in-memory fake (no network). Rider MFA in that suite is owner-provisioned by sealing the secret exactly as the service stores enabled records — no new runtime route was invented and no administrator phone was created.
- `docs/implementation/handoffs/B01/STAFF-LOGIN.md` — this handoff.

Unrelated files preserved; no contracts/SDK/migration/composition/manifest edits.

## Commands and results (actual exits, this session)

| Command (argv) | Exit | Result |
|---|---|---|
| `pnpm --filter @laundry/api exec vitest run identity-staff` (before fix) | 1 | Red as required: deactivation case resolved a CUSTOMER actor on the same token (old fallback); new login suite failed on missing enforcement. 1 failed + new suite collection error (missing import, fixed). |
| `pnpm --filter @laundry/api exec vitest run identity-staff` (after fix) | 0 | **23/23 passed** — identity-staff.test.ts 13/13, identity-staff-login.test.ts 10/10. |
| `pnpm --filter @laundry/api exec vitest run identity-v2 identity-whatsapp identity-maintenance identity-provider` | 1→0 | 47/48 before build; the single failure (`identity-provider` production bootstrap) was `MODULE_NOT_FOUND` for `dist/apps/api/src/main.js` — missing build artifact in the recovered checkout, unrelated to this change. After `pnpm --filter @laundry/api build`: **48/48 passed**. Customer login compatibility confirmed (identity-v2 26/26). |
| `pnpm --filter @laundry/api build` | 0 | tsc build + bundler clean. |
| `pnpm --filter @laundry/api typecheck` | 0 | `tsc -p tsconfig.json --noEmit` clean (includes tests). |
| `pnpm --filter @laundry/api exec vitest run orders-v2` | 0 | 21/21 — staff-consuming peer suite stays compatible (nonproduction staff sign-in without MFA still yields staff actors). |

No pipeline masked any exit; failures above were preserved and re-run to green only after the fix.

## Scenario coverage mapped to B01 packet

- Staff login enforcement (this slice): phone OTP + enrolled current TOTP required for OPERATOR and RIDER; denial without enrollment/code; wrong code rejected; binding row records role + MFA version. (new suite)
- TOTP step reuse rejected atomically; next step accepted; step ledger count asserted. (new suite)
- Customer sessions never gain staff privileges after later provisioning (authenticate and refresh stay CUSTOMER). (new suite)
- Deactivation → authenticate/refresh reject, family revoked `STAFF_UNBOUND`, fresh sign-in is customer. (new suite + updated old test)
- Role change → privileged tokens fail. (new suite)
- MFA reset (disable) → privileged tokens fail. (new suite)
- Cached credential replay rechecks binding (createAddress replay after deactivation rejects). (new suite)
- Production cannot disable enforcement (`NODE_ENV=production`, `requireStaffMfa` unset, LIVE-mode fake provider). (new suite)
- Customer login compatibility and peer staff suites unchanged. (identity-v2, orders-v2 runs above)

Not claimed here: browser/native/provider/physical acceptance; end-to-end B01 scenarios B01-01..04 beyond the identity scope; integration.

## Fixture / provider modes

- OTP delivery: FAKE everywhere; the production-mode case uses a `mode:'LIVE'` provider object with an in-memory fake `send` (labeled in the test). No external SMS/provider/network calls; no paid calls.

## Database

- `DATABASE_URL` from the environment (disposable `laundry_verify_cloud` on loopback:5448). Never changed; no other database used. Both owned suites apply `modules/schema/proposals/B01-staff-sessions.sql` themselves after `initializeDb()`.

## Integration requests to coordinator

1. Assign and apply canonical migration 019 from `modules/schema/proposals/B01-staff-sessions.sql`. Until 019 is canonical, any suite that signs in staff through `IdentityService` on a fresh DB needs the proposal applied — peer suites themselves were not edited (out of ownership) and were verified against the proposal-applied shared verification DB.
2. No composition change is required: `identityFromEnvironment` needs no new wiring because production enforcement is internal to the service.

## Remaining blockers / notes

- None blocking this slice. Peer suites on a fresh database without migration 019 will fail on the new binding table until the coordinator integrates the migration (expected for an unintegrated candidate; not hidden or worked around in peer files).
- `identity_staff_mfa_steps` grows one row per staff login step; pruning can be added to identity maintenance later (left untouched per instructions).
- Rider self-enrollment remains restricted by the published staff/MFA role set; production riders must be enrolled via the owner provisioning path before first login (existing constraint, unchanged).
- Evidence scope: IMPLEMENTED on the tested working tree; coordinator must rerun integrated checks after merging 019 before VERIFIED.
