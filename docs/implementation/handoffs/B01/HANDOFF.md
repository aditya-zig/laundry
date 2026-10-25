# B01 customer identity boundary — coordinator integration

Base: `a5dcc90097c7da1128d926ecb3caf3b90fa72f79`.
Shared wire target remains `laundry-wire-v2.0.0-candidate`. This is a **partial
implementation**, not completion of B01 or the production application. No cloud
worker dispatch, general contract freeze, staff MFA acceptance or live SMS
acceptance is asserted. Ownership is recorded in
`docs/implementation/contracts/identity-integration-scope.md`.

## Implemented behavior

- Real `/v2/identity` HTTP handlers for OTP request/verification, opaque sessions,
  refresh rotation, logout/revocation and owned/versioned address CRUD.
- Challenge codes and bearer/refresh tokens use keyed hashes. Successful
  idempotency responses are AES-256-GCM encrypted with separate deployment keys;
  replay cannot resurrect revoked/rotated sessions or deleted addresses.
- Phone-scoped request idempotency survives a peer/network change. Verification
  binds the challenge/key/code intent. Attempts, expiry, cooldown and fixed
  clock-hour quotas persist in PostgreSQL across restarts.
- An explicit cross-replica send budget bounds SMS exposure even with arbitrary
  phones/peers. Commercial configuration requires an operator-supplied budget;
  no commercial call was made during this work.
- Twilio SMS adapter has a pinned endpoint, timeout, bounded response, no implicit
  retry and redacted errors. Accepted queueing is not called handset delivery.
  Unknown outcomes remain UNKNOWN and cannot silently resend or authenticate.
- Fake challenges and sessions cannot be promoted into live-issued sessions.
  Customer signup cannot select staff roles, facilities or scopes.
- The first-party SDK exercises the actual HTTP handlers and PostgreSQL, including
  stale versions, ownership, malformed requests, revocation and encrypted replay.
- Canonical migration 007 creates eight separate tables; no historical demo
  identity/order/payment rows are promoted into production identities.

## Production execution repairs

Actual Node builds now include CommonJS output metadata. API and worker start
compiled JavaScript, not TypeScript source through a development loader. The API
unit command builds its runtime prerequisite. Workspace contract dependencies
and deployment file lists produce independently deployable production bundles.

The image uses pinned Node 24.22.0, pruned production dependencies and an
unprivileged runtime user. It starts API only; the legacy worker is not silently
claimed to be a production-v2 worker. Its build context is allowlisted and rejects
private environment/key/log/generated state. The new container verification
command tests the real Docker ignore consumer with synthetic canaries, compiled
startup against PostgreSQL, missing-production-provider refusal and actual
absence of development loaders/private context. A passing clean receipt must be
observed separately before calling that command verified.

Production startup also requires exact HTTPS origins, verified TLS PostgreSQL and
explicit non-demo identity configuration before migration/listening. Ordinary
JSON is bounded at 64 KB; only the explicit nonproduction voice-note fixture can
use the larger parser. Malformed/oversized parser errors do not reflect payloads.
Raw webhook signature bytes remain intact. Readiness stays 503 and cannot be
confused with liveness.

## Direct review

### Standards

Manual review of this diff used AGENTS.md, the C01/B01 packets and their shared
specification. No paid review agent or local child worker was invoked. It is not
represented as an independent review.

Resolved: private module imports were replaced by the identity module's public
exports; failed transaction rollback discards the client; all owned container
cleanup is attempted; secret-bearing exceptions are not logged/reflected; Docker
builds no longer transfer private workstation state or require runtime dev tools.

### Spec

Resolved during review and covered by behavior tests: fake OTPs crossing live
mode, encrypted cached login replay after revocation, refresh races, caller-role
injection, phone idempotency across network handoff, global SMS budget races,
unknown-vs-definite delivery outcomes, stale/foreign/deleted addresses, oversized
identity input and exact raw webhook bytes.

Outstanding scope after this revision: MFA as a session-issuance requirement
(the frozen candidate `Session` carries no challenge field, so it needs an
explicit wire revision), the final shared internal-port compatibility
review/freeze and application session wiring. Staff invitations, roles,
facility membership and TOTP MFA are recorded in `STAFF.md`; verified WhatsApp
channel binding is recorded in `WHATSAPP.md`; the retention worker is recorded
in `RETENTION.md`. These are blockers, not waived findings. All business
handlers, media, money/custody integration, native acceptance and actual
physical/provider evidence still have their own production gates.

## Verification before commit

- `pnpm check`, full Node 24.22.0 workspace build and contract generation/check:
  exit 0.
- 681 workspace tests on isolated PostgreSQL 17: pass (148 API tests).
- 75 tooling tests: pass.
- All four actual web scenarios using the compiled API: pass. Those screens still
  use labeled legacy demo flows; this is not v2 UI acceptance.
- Separate identity dump/restore: two sessions, one owned address, encrypted
  refresh replay and failure without the independent deployment keys: pass.
- The real multi-stage Docker build succeeds; a runtime inspection found Node
  24.22.0, UID 1000, 120 production packages and no tsx/TypeScript/node-forge store
  entry. The broader workspace audit still reports node-forge in Expo tooling.
- Clean canonical container/browser/recording/restore receipts and fresh cloud
  workflows must bind the committed candidate SHA. Working-tree results cannot
  approve a published revision.

## Provider/activation requirements

The `.env.example` documents only empty Laundry-specific provider/key/budget
settings. No existing project's credentials are imported. Real SMS, approved
geographical/template/DLT settings, provider fraud controls, privacy/retention
policy and recovery of independent keys must be verified before activation.
The database archive intentionally cannot decrypt replay responses by itself.
No rates, areas, care/refund terms, facility capacity or real pilot approval is
inferred. Production readiness and ordering remain disabled.
