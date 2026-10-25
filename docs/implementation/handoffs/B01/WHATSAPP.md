# B01 verified WhatsApp channel binding

Baseline: `15fa892`. This implements the published `identity.whatsapp.link`
route inside the owned identity paths. It is not B01 completion, not a contract
freeze and not production enablement.

## Implemented behavior

Canonical additive migration `010_whatsapp_links.sql` adds
`identity_whatsapp_links` with one row per profile, a unique phone constraint
and `linked_at`. Tables 001-009 are unchanged.

`POST /v2/identity/whatsapp/link` now authenticates the caller, requires a
customer actor and verifies a fresh OTP challenge before writing the link:

- The challenge must be `ACCEPTED`, issued in the service's current mode
  (`LIVE` in production), unexpired and under five attempts.
- The challenge phone must equal the phone bound to the authenticated profile.
  A proof of any other number is refused before an attempt is consumed, so a
  caller cannot burn another account's challenge.
- The attempt is consumed with one conditional update, the six-digit code is
  compared in constant time against the keyed hash, and the challenge flips to
  `USED` only after a match. A racing sign-in verification either wins the row
  or leaves this link with nothing to consume.
- Success upserts the link and writes `WHATSAPP_LINKED` against the profile.
  No session is minted, and neither the code nor the phone enters the audit
  table or the encrypted replay cache.
- The command is idempotent per actor/key/intent, replays the sealed result,
  revalidates the session on replay, and is bounded by an hourly
  `whatsapp-link` bucket.

The route also proves immediate staff-scope recovery: after a provisioned
staff row is deactivated, an existing access token resolves to `CUSTOMER` on
its next request. The staff suite now asserts that stale-session case.

## Deliberate limits (blockers, not waivers)

- The published request carries only `challengeId` and `code`, so the verified
  number is the challenge phone and must match the account phone. Linking a
  different number would need a contract revision before implementation.
- The code is delivered through the existing SMS port. That proves control of
  the account phone, matching the v1 account-link precedent, but it is not
  WhatsApp channel delivery. Inbound sender authorization and consent remain
  B09 work.
- Non-customer sessions receive `UNAUTHENTICATED` rather than the undeclared
  `FORBIDDEN` because the published route lists `CUSTOMER` with only
  `UNAUTHENTICATED` and `VERSION_CONFLICT` in its error set.
- Conversation draft claiming, opt-out, template rules and live provider
  acceptance remain outstanding. No commercial or provider call was made.

## Verification

- Focused `apps/api/test/identity-whatsapp.test.ts`: six tests covering link
  creation without a new session, encrypted replay stability, changed-intent
  conflict, foreign-phone refusal without attempt consumption, five-attempt
  lock, post-success reuse rejection, expiry, staff refusal, and the real SDK
  over HTTP with contract envelopes.
- `apps/api/test/identity-staff.test.ts`: 13 tests, including the new
  deactivation downgrade assertion.
- Full `@laundry/api` suite: 180 tests on an isolated disposable PostgreSQL 17
  task instance. `pnpm check` and `pnpm contracts:check` pass; `contracts:check`
  is unchanged because the only contract edit is a missing type export for an
  already-published schema.
- Whole-workspace run and clean committed-source receipts are recorded after
  this document is committed.

These results do not claim a deployed product backend, native acceptance,
approved business configuration or production readiness. Production ordering
remains disabled.
