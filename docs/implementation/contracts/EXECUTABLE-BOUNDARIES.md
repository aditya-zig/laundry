# Executable v2 boundaries, 22 October 2026

Contract target: `laundry-wire-v2.0.0`. This is an implementation update, not an approved freeze or a production release.

## Changes

- `WIRE_SCHEMAS` resolves every named request and success response in the 84-operation registry. Unknown names fail. Command bodies reject undeclared fields.
- The SDK covers all 81 first-party operations. The other three operations are authenticated provider callbacks, not app methods. Inventory tests invoke actual public SDK methods against authored fixtures.
- `openapi-v2.json` describes 80 paths and 84 operations. The generator fails on unsupported Zod constructs instead of emitting a permissive placeholder. Runtime refinements remain documented separately.
- Synthetic fixtures cover every wire schema, operation and all ten payload-bound domain events. Fixture prices, contacts, promises and media URLs are not approved business configuration.
- Order, obligation, attempt, refund, delivery-attempt and conversation-draft states stay separate. Pure transition guards require intake, adjustment consent, quality checks, return custody, settlement or an audited zero-due resolution. Cancellation requires reconciliation. Delivery attempts now distinguish `CANCEL_REQUESTED` from a confirmed cancellation.
- Payment attempts can record a late authoritative success after failure or expiry, but cannot regress a recorded success. Refunds reserve against captured funds; uncertain outcomes require reconciliation before retry.
- Draft confirmation binds the exact draft revision, quote ID and quote version. The server checks both expiries.

These guards consume trusted evidence. They do not verify an actor, a custody code or a provider signature. Owning modules must load and verify those facts within their transaction. Evidence flags are deliberately absent from public request DTOs.

## PostgreSQL command execution

Migration `006_v2_transactions.sql` adds separate command results, audit, inbox and outbox tables. It does not reinterpret historical prepaid v1 rows.

`createPostgresCommandExecutor` checks out one client and uses transaction-scoped advisory locks. Business changes, audit, events and the durable result commit together. Requests have canonical hashes. Replay requires the original actor scope and rechecks current authorization before returning a private result. Inbox consumers require a scoped system identity and deduplicate event delivery.

Tests exercise concurrency, duplicate replay, changed payloads, rollback, missing audit, event identity, revoked access and scoped event consumers against real PostgreSQL.

## Verification

On the implementation working tree, `pnpm check`, `pnpm build`, `pnpm contracts:check` and `pnpm test:tooling` passed. The full workspace suite passed 584 tests against a new task-only PostgreSQL 17 container. Tooling passed 27 tests.

All three web smoke journeys passed with recordings. The evidence command correctly exited 1 because the workspace was dirty. That run cannot approve a published revision. A clean committed-revision receipt must be recorded separately.

## Remaining gates

- C01 stays `BLOCKED_CONTRACT`; the manifest has no freeze SHA or approved digest.
- The typed module ports still need a final compatibility review against all command DTOs and real consumers.
- The production v2 HTTP handlers and business repositories are not implemented by declaring schemas, SDK methods or pure guards.
- Existing apps and browser smoke journeys still use legacy demo routes. They do not prove v2 booking, live payments, real OTP, provider delivery or a native journey.
- Fresh cloud-runner acceptance, uploaded video review and Android acceptance remain unproved.
- Founder approvals for boundaries, tariffs, promises, claims and providers remain required. Production ordering stays off.

## Delegation

OpenCode workers used explicit free models with exclusive file ownership and no commit permission. DeepSeek produced the initial PostgreSQL lifecycle tool. Coordinator review found and fixed password forwarding, inherited migration URLs, signal forwarding and cleanup failures. The GLM and fixture workers hit free-usage limits. The coordinator implemented and verified the transition guards and fixture repairs. A failed overnight retry is not successful delegation evidence.
