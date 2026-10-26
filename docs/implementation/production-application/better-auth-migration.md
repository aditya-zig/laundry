# Better Auth migration — implementation checkpoint

Status: **in progress; not deployed or production-accepted**. No live SMS or OAuth provider calls are authorized by this checkpoint. Existing live-ordering gates remain closed.

## Scope

Requested authentication: mobile OTP, Google and Sign in with Apple. Email/password sign-in is disabled. A verified Google email or Apple relay email **does not** replace mobile verification.

The pinned Better Auth framework is `1.7.13`, backed by the existing PostgreSQL database. Migration `020_better_auth.sql` adds isolated framework tables and links framework sessions to existing v2 application session families. It does not migrate demo accounts, rewrite order ownership, or promote customer phones into staff.

## Trust boundaries

- Framework routes: `/v2/auth/identity/*`. The raw framework handler precedes Express body parsing so Apple's form-post callback is not destroyed. Framework responses have their own protocol, not v2 domain envelopes. OAuth state remains database-backed and cookie-bound; with Apple on HTTPS only the short-lived state cookie uses `SameSite=None; Secure` for Apple's cross-site form POST. Ordinary session cookies are not weakened and state checking is never disabled.
- Additive v2 boundary: `POST /v2/identity/session/exchange`, empty JSON object, required idempotency key, current framework session in the authorization header or cookie. The server rechecks the framework session and verified mobile from PostgreSQL; it never accepts user IDs, phone verification or roles in the request body.
- Successful exchange returns the existing v2 `Session` contract. `@laundry/api-client` exposes `exchangeAuthSession`; construct the exchange client with the framework bearer token, then use the returned v2 access token for business calls.
- Existing phone-owned profiles, addresses and orders retain their IDs. Apple/Google emails are not ownership keys. Implicit email account linking is disabled. Explicit provider linking requires the signed-in account and provider proof. A conflicting existing provider/phone account requires controlled recovery; do not silently merge it or claim that recovery is already implemented.
- A framework session without verified mobile cannot exchange. Customer exchange refuses active staff phones: existing enrolled staff-MFA login remains separate and cannot be bypassed by social login.
- Derived v2 sessions are bound to the framework session. Framework logout, expiry, user deletion, phone changes or removal of verification invalidate app authentication, refresh and cached exchange replay. v2 logout/session revocation also removes the corresponding framework session.
- Runtime grants include framework and external-session tables but still prohibit staff provisioning, schema creation, ownership and destructive privileges.

## Phone provider

The adapter is explicitly opt-in Twilio **Verify**, not the older Twilio SMS messaging-service API. Verify owns OTP generation, TTL, attempt limits and atomic redemption. The unused code generated internally by the phone plugin is replaced with a non-secret marker before persistence. Provider error bodies and credentials are not logged or returned.

An explicit bounded hourly send budget is consumed in PostgreSQL before delivery. Better Auth Verify and the legacy SMS sender share the same UTC-hour bucket and HMAC key during migration, so enabling both cannot double the approved budget. Unknown delivery outcomes spend the budget and must not trigger automatic resend. The provider's region, DLT/sender compliance, allowed destinations and fraud protections still need owner approval and real-provider verification. Having an adapter is not evidence that any approval exists.

Tests inject synthetic providers/fetch responses; they do not send SMS or use commercial accounts.

## Deployment inputs (not configured by this change)

- `LAUNDRY_AUTH_ENGINE=better-auth` opts in. Omit it to preserve the current deferred-identity deployment.
- `BETTER_AUTH_URL`: canonical HTTPS API origin in production.
- `BETTER_AUTH_SECRET`: independent random secret, at least 32 characters; do not reuse either identity encryption/hash key.
- `LAUNDRY_AUTH_TRUSTED_ORIGINS`: exact comma-separated application origins, no wildcards.
- `LAUNDRY_PHONE_VERIFICATION_PROVIDER=twilio-verify`.
- Laundry-owned `LAUNDRY_TWILIO_ACCOUNT_SID`, `LAUNDRY_TWILIO_AUTH_TOKEN`, `LAUNDRY_TWILIO_VERIFY_SERVICE_SID` and an explicit `LAUNDRY_SMS_HOURLY_BUDGET`.
- Existing independent `LAUNDRY_IDENTITY_HASH_KEY` and `LAUNDRY_IDENTITY_ENCRYPTION_KEY` for v2 sessions/rate keys.
- Google: paired `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; register the exact `/v2/auth/identity/callback/google` API callback.
- Apple: paired `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET`, optional `APPLE_APP_BUNDLE_IDENTIFIER`; register the exact `/v2/auth/identity/callback/apple` API callback. Apple client-secret signing/rotation, Services ID, domain registration and developer-account ownership remain deployment tasks. Never commit the Apple private key.

If the legacy SMS provider is disabled, its OTP endpoint fails closed rather than generating fake delivery. Staff using that path still need an explicitly configured provider and enrolled MFA. Do not enable Better Auth in production until the staff access/runbook is verified.

## Verification checkpoint

Focused PostgreSQL run `authorigin_20261026080620_497344cd`: **39/39 tests passed** across `better-auth.test.ts`, `better-auth-provider.test.ts`, `identity-staff-login.test.ts` and `runtime-database.test.ts`. This includes origin/redirect rejection, unsigned callbacks, mandatory verified phone, ownership preservation, staff-MFA isolation, shared SMS send cap, logout/replay invalidation, framework schema and raw HTTP/SDK exchange. All providers were synthetic; this is not real Apple/Google/SMS acceptance.

The first production dependency audit also caught Better Auth's optional `vitest` peer pulling development tooling into the production graph. A version-scoped `.pnpmfile.cjs` hook excludes only Better Auth 1.7.13's unused optional Vitest peer; application tests keep the workspace's Vitest. The parent override and lockfile-only re-resolution did not remove cached peer snapshots, so that ineffective override was removed. A real installation regenerated the graph and `pnpm release:security` passed: the sole raw advisory is the pre-existing node-forge advisory, whose existing backport passed exact-source and seven RSA regression checks. No advisories were muted and the release-security gate remains unchanged.

The first security rerun caught the framework disabling origin checks under test. Configuration now explicitly enables origin/CSRF checks in every environment, with an additional trusted-origin check protecting cookie-free OTP requests. The first workspace check also caught the missing additive exchange fixture; the exhaustive fixture registry was completed rather than relaxing its type check.

The shared SDK now also exposes `createBrowserIdentityClient`, using Better Auth's own phone/social client and cookie handling. Its exchange helper fetches the current framework session and passes only its bearer proof to the server exchange, never client-supplied phone-verification flags. Ten synthetic transport/configuration tests pass and the SDK typecheck passes. This is browser-only; it is not a native cookie/deep-link implementation.

The first complete PostgreSQL workspace run stopped at an SDK expectation: the shared schema normalizes expiry timestamps to milliseconds. The expectation was corrected without changing transport/schema behavior. A fresh full run, `authfinish_20261026083520_648b63f6`, subsequently passed **1,069 tests**: contracts 104, fixtures 233, API 361, SDK 160, foundation 32, customer 107, rider 36, ops 34 and design tokens 2. This includes the new social phone-binding and browser SDK tests. The task PostgreSQL database was removed after the successful run.

## Remaining acceptance work

API build, dependency installation/security gate, `pnpm check`, customer/rider web exports and the full PostgreSQL workspace test suite have passed. Metro package exports were enabled for the framework's ESM subpaths. The customer checkout includes an opt-in browser sign-in panel for mobile, Google and Apple, with verified-phone gating and server exchange. `EXPO_PUBLIC_AUTH_ENGINE=better-auth` enables it on web; native and invalid selections block explicitly rather than falling back. Export with a cleared Metro cache when switching build-time environment values.

The actual exported checkout was inspected through gstack's headless browser at desktop, tablet and 375px mobile widths against a local synthetic fail-closed API. Both social buttons displayed the explicit provider-unavailable response; invalid mobile input was rejected before sending. Screenshots were inspected at `/tmp/laundry-auth-browser-desktop.png` and `/tmp/laundry-auth-screen-mobile.png` (tablet/desktop variants share the latter prefix). Expected fixture HTTP 503 errors were observed; an earlier incomplete export produced a 404 before the corrected build. This is not successful live OAuth/SMS acceptance, a recorded production journey or native acceptance.

Still required: real OAuth redirects, native secure session persistence and device callback/logout handling. Inspect the actual apps in a browser and on Android/iOS as appropriate. Real Google/Apple callback, account-conflict recovery, SMS redemption/fraud limits and credential rotation need separate provider-backed acceptance after explicit spending/credential authorization. Until those gates pass this is an authentication migration slice, not completed sign-in or production readiness.
