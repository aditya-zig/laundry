# C01 identity and SDK routing

Updated 22 October 2026. C01 remains `BLOCKED_CONTRACT`. This change does not freeze v2 or implement production authentication.

## Implemented

The v2 identity contracts now validate OTP requests and challenges, sessions, refresh credentials, revocation results and owned addresses. Production challenges reject `demoCode`. Address input rejects client-selected ownership and requires coordinates. Updates and deletions require an expected version.

The SDK validates these identity requests and responses. Invalid successful mutation responses retain the sent idempotency key through `UnknownOutcomeError`. No automatic retries were added.

Every SDK method now selects an operation ID. The shared registry supplies its HTTP verb and path. Operation IDs are checked by TypeScript. `resolveRoute` rejects unknown operations, missing parameters, extra parameters and dot-only traversal segments. It URL-encodes parameter values without changing the registry. The registry rejects duplicate operation IDs as well as duplicate verb/path pairs.

Added registry entries for custody receipts, incident message reads and review eligibility. The inventory now contains 84 declarations. Declaration counts do not prove schema or backend coverage.

Corrected paths and verbs include logout, quotes, adjustment decisions, operations queues, upload finalization, download creation, handovers, location reports, manual payments, reconciliation, exception resolution, rewash requests, review creation/publication reads and dead-letter reads.

Corrected response parsers include billing summaries, upload finalization, assignment acceptance, leg exceptions/cancellations, location reports, manual-payment receipts, incident resolution and review moderation. Declared page responses now retain cursor metadata rather than parsing as arrays.

Review creation takes a strict intent DTO with the expected order version. It no longer requires server-assigned IDs, customer ownership, publication state or timestamps. Adjustment decisions send the scalar decision instead of nesting a full decision inside another decision.

## Consumer changes

V1 exports and methods are unchanged. V2 is not frozen and has no app consumers yet.

- `refreshSession` requires the refresh token explicitly.
- `deleteAddress` requires the expected address version.
- `checkServiceArea` requires a postal code.
- `createReview` takes `v2.ReviewInput`, including `expectedVersion`.
- `decideAdjustment` takes `ACCEPT` or `DECLINE` as its decision argument.
- Paginated order, billing, incident and public-review reads return `{ items, pageInfo }`.
- Download creation and reconciliation accept mutation options so callers can persist an explicit key.
- Shared handover and location endpoints retain the SDK job ID in the body. Full command DTO validation remains pending.

## Verification

Twenty new SDK behavior tests failed before implementation. They detected permissive identity parsing and fourteen incorrect paths or verbs. Additional tests cover session refresh payloads, versioned deletion, flat adjustment intent, review input, rider job context, reconciliation keys, cursor metadata and billing summaries.

The contracts tests also cover strict identity input/output, review input, duplicate operation IDs and parameter resolution for every registry entry.

This SDK verification uses synthetic payloads and an injected HTTP transport. It does not prove production OTP delivery, refresh rotation, session revocation, ownership enforcement or v2 backend routes.

- Contracts build and tests passed. All 63 contracts tests passed.
- SDK build and tests passed. All 60 SDK tests passed, including 16 existing v1/pilot cases.
- `pnpm check` passed.
- Full `pnpm test` passed against the new isolated PostgreSQL 17 database `laundry_verify_c01_identity` on loopback port 5547. All 217 tests passed, including 63 existing API tests. External providers used fixtures. This is local acceptance, not fresh-cloud or v2 backend acceptance.
- The inventory generator produced 84 route declarations.

The task-only database container was stopped after verification. Existing project databases were not used.

## Remaining gates

- Replace the remaining generic response parsers for slots and job administration.
- Complete executable request DTOs and version requirements for all commands. Generic `Input` parameters remain in several SDK methods.
- Cover every registry declaration with an executable schema, deterministic fixture, SDK operation and consumer compile check.
- Correct provider-webhook authentication metadata and module ownership where the registry still has historical placeholders.
- Publish OpenAPI, transition guards and shared transaction, audit, inbox/outbox and idempotency integration boundaries.
- Run P01 fresh-cloud checks and pin a complete contracts/SDK/fixtures digest before feature dispatch.

No browser, Android, cloud, paid-provider or production acceptance is claimed. No UI changed in this patch.
