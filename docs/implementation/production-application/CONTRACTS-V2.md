# Contract freeze required before parallel implementation

Status: proposed contract `laundry-wire-v2.0.0`; C01 must publish executable schemas, SDK, fixtures, OpenAPI and a digest before consumers start. This document does not claim those artifacts exist. Preserve `/v1` callers through tested adapters. Resolve differences from older contracts in favor of this milestone's explicit payment-at-return policy.

## Freeze contents

C01 implements all request, success, error, pagination and event schemas in `packages/contracts`, all app calls in `packages/api-client`, and deterministic synthetic fixtures in `packages/test-fixtures`. Freeze a git SHA and SHA-256 over these artifacts. Record it in the handoff and task manifest. Schema coverage must include the whole route inventory below; publishing types alone is insufficient.

Common values: UUID IDs; nonnegative integer INR minor-unit money; positive integer grams; separate nonnegative garment/container counts; explicit price unit `KG|PIECE`; versioned immutable rate cards; ISO instants accepting `Z` or valid offsets, normalized to UTC; schedule windows retain `timezone: Asia/Kolkata` and end after start. A server-derived actor carries role, facility memberships and assignment scope. Request bodies never grant these scopes.

All first-party mutations require actor-scoped idempotency keys, including auth/media commands with appropriate pre-auth identity scoping. Webhook deduplication uses authenticated provider/event identity instead. Versioned aggregate commands require `expectedVersion`; new resources do not invent an existing version. The same key/payload replays the original outcome; changed payload conflicts. Durable booking/payment/provider uniqueness survives response-cache expiration. Expiration uses server time.

Error envelope: `{code,message,fieldErrors?,retryable,traceId,currentVersion?}`. Freeze status mapping and safe retry guidance for authentication, ownership, input, area, capacity, deadline, quote expiry, stale version, idempotency conflict, approval required, payment pending, unknown provider outcome and rate limit. Unauthorized private IDs return 404 consistently. SDK preserves typed errors, idempotency keys and unknown outcomes; it must not silently retry with a fresh key.

## Unified commercial model

Requested lines contain `serviceId`, `billingUnit`, `garmentTypeId?`, `estimatedWeightGrams?`, `pieceQuantity?`, `declaredGarmentCount?`, `careNotes?`. Exactly the unit-appropriate pricing quantity is required; custody counts do not become price quantities. The catalog determines garment eligibility. Weight increments, minimum billable weight, rounding, fee/tax components and tier rules come from approved configuration. Synthetic fixture rules are marked synthetic. Mixed baskets have one pickup and one feasible return window using the slowest service.

Quote includes immutable line/component snapshots, catalog/rate versions, provisional/fixed designation, expiry, address snapshot reference, pickup/return promises and capacity-hold reference/expiry. Expiring holds release capacity idempotently. Booking atomically validates quote, ownership, versions and holds and creates an order plus due-at-return obligation. Booking does not require captured payment. The v1 prepaid adapter preserves historical semantics and records the model/version on old orders.

Intake keeps declared, counted and measured facts separate, records bag seals/conditions and generates a priced adjustment. A higher amount requires a decision tied to adjustment ID/version; processing stays held until accepted. Lower measured-weight minimum policy is a business activation gate. Decline, expiry and no response enter an explicit hold/escalation/agreed-return path. Receipt states reflect actual money collected; zero-due unprocessed returns do not fabricate capture.

## Independent state and events

C01 publishes complete transition tables, guards and allowed commands for each state, including exceptions. Proposed happy paths are:

| Aggregate | Path and conditions |
|---|---|
| Order | `CONFIRMED → PICKUP_PENDING → AT_FACILITY → IN_CARE → QUALITY_CHECK → READY_FOR_RETURN → RETURNING → DELIVERED`; intake acceptance authorizes facility receipt; accepted return custody authorizes delivery |
| Order exceptions | `AWAITING_ADJUSTMENT`, `ON_HOLD`, `CANCEL_REQUESTED`, `CANCELLED`, `RESOLUTION_REQUIRED`; carry reason/resume state and permitted next actions |
| Payment obligation | `OPEN → PARTIALLY_SETTLED → SETTLED`; explicit `VOID` for approved zero-due resolution; accepted receipts/captures determine balance |
| Payment attempt | `CREATED → PENDING → SUCCEEDED|FAILED|EXPIRED|OUTCOME_UNKNOWN`; late authoritative success reconciles the ledger without discarding received money |
| Refund | `REQUESTED → PROCESSING → SUCCEEDED|FAILED|OUTCOME_UNKNOWN`; immutable captures bound the refundable amount |
| Delivery leg attempt | `REQUESTED → BOOKING_UNKNOWN|BOOKED → ASSIGNED → AT_PICKUP → IN_TRANSIT → COMPLETED`; failed/cancelled attempts retain history, one active attempt per leg |
| Conversation | `COLLECTING → QUOTED → CONFIRMED → BOOKING_CREATED`; edits advance revision and invalidate confirmation; expiry/human handoff explicit |

Payment unresolved at attempted return blocks ordinary final handover; an authorized exceptional business resolution is separately audited. Pickup completion cannot deliver an order. Custody proof codes are hashed, attempt-limited, expiring and customer-visible only through authorized customer channels. Reissue invalidates old codes. Rider views contain no expected code.

Event envelope: `{eventId,eventType,schemaVersion:2,aggregateId,aggregateVersion,occurredAt,traceId,payload}`. Freeze payloads/consumers for `order.confirmed.v2`, `order.intake-recorded.v2`, `order.adjustment-decided.v2`, `order.ready-for-return.v2`, `order.delivered.v2`, `payment.settled.v2`, `refund.updated.v2`, `delivery.updated.v2`, `media.uploaded.v2`, `conversation.draft-confirmed.v2`. Business write/audit/idempotency/outbox commit together; inbox and downstream effect commit together. Ordered arrival is not assumed.

## Route inventory to encode under `/v2`

The following specifies route families, not permission to leave individual operations undefined. C01 enumerates exact verbs, DTOs, response envelopes, role/scope rules, pagination and idempotency semantics in OpenAPI before freeze.

| Owner | Required operations |
|---|---|
| B01 identity | OTP request/verify, refresh/rotate/logout/revoke sessions, me, staff invitation/MFA lifecycle, owned address CRUD and secure WhatsApp identity linking |
| B02 catalog/pricing | Public services/detail, garment eligibility, effective rate summary; scoped ops catalog/rate create/approve/activate; internal pricing port |
| B03 availability | Service-area check, available pickup/return pairs, scoped calendars/capacity administration; internal hold/reserve/release ports |
| B04 orders | Quotes, bookings, owned order list/detail/timeline, cancel/reschedule, adjustment decision; scoped ops queue/intake/care/QC/hold/exception resolution |
| B05 billing | Owned obligations/attempts/receipts/refunds; audited ops manual cash/UPI confirmation, refunds/reconciliation; signed provider webhooks |
| B06 logistics | Assigned job list/detail, allowed accept/handover/exception/location commands; scoped ops assignment/reassignment/cancel; signed provider webhooks; customer tracking view |
| B07 media | Upload intents/finalize, authorized short-lived download; public licensed catalog variants; internal delete/retention ports |
| B08 support/reviews | Owned incidents/messages/rewash requests, ops resolution; delivered-order review create/edit if permitted, public consented reviews, audited moderation |
| B09 conversations | Verified inbound WhatsApp challenge/messages, current revision draft confirmation, opt-out; scoped conversations/handoff |
| B10 jobs | Scoped ops dead-letter list/replay and job health; internal lease/retry/outbox/inbox interfaces, no public unauthenticated job trigger |

## Shared integration ports

Freeze typed ports for Identity/Access, Pricing, Availability, Orders, Billing, Logistics, Media, Support, Reviews, Conversations, Speech, NotificationTransport and Jobs. Each command takes server-derived actor plus command metadata. Reads enforce scopes too. Publish transaction participation rules: order booking can reserve availability and create the obligation atomically within one database unit of work; notification/provider calls occur after commit. Cross-module writes go through ports, not another module's SQL tables.

Coordinator-owned shared infrastructure exposes transaction, clock, IDs, authorization, audit, idempotency, inbox/outbox, private media references and test context. Feature workers add registrable handlers without editing the composition root. The shared test context creates a real isolated PostgreSQL database, supports deterministic external-provider fakes and reports leaked processes/connections.

## Freeze acceptance

- Schema/SDK tests exercise valid `+05:30`, midnight rollover, invalid windows, mixed KG/PIECE lines, all four service codes, minor-unit arithmetic and every documented error envelope.
- Compatibility tests run the old v1 SDK against adapters without rewriting historical order/payment facts.
- A contract inventory maps every operation/event to a schema, SDK method or internal port, fixture, owning task and permission rule.
- Consumer compile checks cover all three app foundations and each backend module skeleton.
- A digest and pinned baseline are published. A breaking discovery pauses affected tasks; coordinator issues a revised version, adapters and revalidation list. Consumers never fork private DTOs.
