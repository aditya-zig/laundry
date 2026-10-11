# Shared contracts v1 — implementation boundary specification

Status: normative proposal for A0 to encode as executable schemas before parallel work. Import types only from `@wandary/contracts`, SDK only from `@wandary/api-client`. No independent copies. Implementation must not start concurrent API consumers until A0 produces all request/response/event schemas, fixtures and contract tests. Product behavior: [spec](product-spec.md). Values below are engineering defaults, not advertised service promises.

## Common types and request rules

`Id` = UUID string; `Instant` = ISO-8601 UTC timestamp; `Money = { amountMinor: integer >= 0, currency: 'INR' }`; `Window = { start: Instant, end: Instant, timezone: string }`, end after start. `Actor = { id, role: 'customer'|'rider'|'facility'|'operator'|'admin'|'system', scopes: string[] }` comes from server-verified identity, never request body. Provider identities are service credentials, not customer tokens.

`ServiceCode = 'WASH_FOLD'|'WASH_PRESS'|'PRESS_ONLY'|'DRY_CLEAN'`.
`RequestedLine = { serviceId: Id, garmentTypeId: Id, quantity: integer 1..100, estimatedWeightGrams?: integer 1..50000, careNotes?: string }`. Maximum 100 garments/order and 20 distinct lines as configurable pilot limits. At least one line; reject a weight where the selected rate card forbids it. Quantity always counts garments; weight changes only weight-based prices.

Errors: `{ code, message, fieldErrors?: Record<string,string>, retryable: boolean, traceId }`. Fixed codes: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_INPUT`, `OUT_OF_AREA`, `NO_CAPACITY`, `DEADLINE_UNAVAILABLE`, `QUOTE_EXPIRED`, `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `PAYMENT_PENDING`, `PROVIDER_UNAVAILABLE`, `PROVIDER_OUTCOME_UNKNOWN`, `REQUIRES_APPROVAL`, `RATE_LIMITED`.

Every mutating request carries `Idempotency-Key` (client-generated UUID) and state-changing requests carry `expectedVersion`. Same actor/key/payload returns original result; same key/different payload returns 409. Unique indexes protect checkout-per-quote and provider-event IDs permanently, independent of a 30-day API response-cache TTL. Version conflicts return 409 and current permitted state. Private resources return 404 to unauthorized resource IDs. UTC server clock governs expiry. Pagination is cursor-based, default 20/max 100. A0 publishes precise response schemas for every route below.

## Ports (exported from packages/contracts/src/ports.ts)

All commands take server-derived `Actor` and validate resource authorization in the owning module. Domain event handlers use narrowly scoped system actors. `CommandMeta = { idempotencyKey: string, expectedVersion?: number, traceId: string }`.

```ts
interface CatalogPort {
  listServices(areaId: Id): Promise<Service[]>;
  getRateCard(areaId: Id): Promise<RateCard>;
  submitReview(actor: Actor, input: ReviewInput, meta: CommandMeta): Promise<Review>;
}
interface OrdersPort {
  createQuote(actor: Actor, input: QuoteInput, meta: CommandMeta): Promise<Quote>;
  createCheckout(actor: Actor, quoteId: Id, meta: CommandMeta): Promise<Checkout>;
  getOrder(actor: Actor, orderId: Id): Promise<OrderView>;
  applyPayment(event: PaymentEvent, meta: CommandMeta): Promise<void>;
  applyDelivery(event: DeliveryEvent, meta: CommandMeta): Promise<void>;
  recordIntake(actor: Actor, input: IntakeInput, meta: CommandMeta): Promise<OrderView>;
  decideAdjustment(actor: Actor, input: AdjustmentDecision, meta: CommandMeta): Promise<OrderView>;
  advanceCare(actor: Actor, input: CareTransition, meta: CommandMeta): Promise<OrderView>;
  cancelOrder(actor: Actor, orderId: Id, reason: string, meta: CommandMeta): Promise<OrderView>;
  rescheduleOrder(actor: Actor, input: RescheduleInput, meta: CommandMeta): Promise<OrderView>;
}
interface BillingPort {
  createPayment(input: PaymentRequest, meta: CommandMeta): Promise<PaymentSession>;
  getPayment(actor: Actor, paymentId: Id): Promise<PaymentView>;
  requestRefund(input: RefundRequest, meta: CommandMeta): Promise<RefundView>;
}
interface LogisticsPort {
  quoteLeg(input: LegRequest): Promise<LegQuote>;
  bookLeg(input: BookLegRequest, meta: CommandMeta): Promise<DeliveryJob>;
  cancelLeg(jobId: Id, reason: string, meta: CommandMeta): Promise<DeliveryJob>;
  getJob(actor: Actor, jobId: Id): Promise<DeliveryJob>;
  recordHandover(actor: Actor, input: HandoverInput, meta: CommandMeta): Promise<DeliveryJob>;
}
interface SpeechPort {
  transcribe(input: { privateMediaId: Id; languageHints: string[]; traceId: string }):
    Promise<{ text: string; detectedLanguage?: string; uncertainSpans: string[] }>;
}
interface ConversationPort {
  receive(input: InboundMessage): Promise<{ accepted: boolean }>;
  confirmDraft(actor: Actor, input: DraftConfirmation, meta: CommandMeta): Promise<Checkout>;
}
```

`Service` includes ID/code, title, descriptions, media variants/alt/license reference, supported garments, price unit and active areas. `RateCard` has ID/version/currency, garment/service prices, fee/tax lines and eligibility. Catalog versions are immutable once quoted.

`QuoteInput = { addressId, lines: RequestedLine[], pickupWindow, requestedReturnBy, timezone }`.
`Quote = { id, version, expiresAt, rateCardId, rateCardVersion, lines, priceBreakdown, total: Money, provisional: boolean, pickupWindow, promisedReturnWindow, holdId }`.
`Checkout = { orderId, paymentId, paymentUrl, expiresAt, status: 'AWAITING_PAYMENT'|'RESOLUTION_REQUIRED' }`. Payment URL is allowlisted and supplied by billing; never model-generated.
`PaymentRequest = { orderId, quoteId, purpose: 'INITIAL'|'TOP_UP', amount: Money, customerId }`.
`RefundRequest = { orderId, paymentId, amount: Money, reason, obligationId }`.
`IntakeInput = { orderId, bagIds: Id[], measuredLines: { orderLineId, quantity, weightGrams?, conditionMediaIds: Id[] }[] }`.
`AdjustmentDecision = { orderId, adjustmentId, decision: 'ACCEPT'|'DECLINE' }`.
`CareTransition = { orderId, to: 'IN_CARE'|'QUALITY_CHECK'|'READY_FOR_RETURN', reason?: string }`.
`RescheduleInput = { orderId, newQuoteId }`; reschedule requires newly confirmed terms and provider cancellation/reconciliation where already dispatched.
`ReviewInput = { orderId, overall: integer 1..5, serviceScore?: integer 1..5, deliveryScore?: integer 1..5, comment?: string, mediaIds: Id[], publishConsent: boolean }`.

`LegRequest = { orderId, leg: 'PICKUP'|'RETURN', fromAddress, toAddress, window, bagCount, estimatedWeightGrams }`.
`LegQuote` contains provider ID, capability flags, expiry, price and window. `BookLegRequest = { request: LegRequest, providerQuoteId, dispatchMode: 'PROVIDER'|'MANUAL' }`.
`DeliveryJob` has ID/order/leg, provider/assignment reference, status/version, bag IDs, tracking freshness and optional authorized coordinates. `HandoverInput = { jobId, actionId, bagIds, method: 'OTP'|'PROVIDER_PROOF'|'OPERATOR_EXCEPTION', proofReference?, otp?, capturedAt }`. OTP verified online; photos/upload IDs cannot complete a handover without the required proof. Operator exception is restricted/audited, never a rider fallback.

`BookingDraft` has ID/customer/conversation/revision, nullable QuoteInput fields, field source/uncertainty, quoteId?, expiresAt and state. `DraftConfirmation = { draftId, revision, quoteId }`. Draft expiry proposal: 24 hours; quote expiry can be earlier and controls booking. `InboundMessage` has provider/message ID, verified sender reference, receipt instant, text or private media ID, reply context. No raw access tokens in its persisted shape.

## API surfaces and owner

A0 encodes JSON schemas for all commands, not just happy-path examples. GETs are paginated where they return lists. Every response includes traceId; resource views include version. No client chooses its role or facility scope.

| Owner | Routes under /v1 | Purpose |
|---|---|---|
| A0 | POST /auth/otp/request, /auth/otp/verify, /auth/refresh; POST /auth/logout; GET /me | Verified identity, sessions and revocation; OTP attempts/expiry/rate limits |
| A0 | GET/POST /addresses; PATCH/DELETE /addresses/:id; POST /account-links/whatsapp | Owned addresses, secure account linking |
| A0 | POST /media/upload-intents; GET /media/:id/download | Signed uploads/downloads, MIME/size/ownership rules |
| A1 | GET /service-areas/check, /services, /services/:id, /services/:id/reviews; POST /reviews | Browse and verified reviews |
| A1 | POST/PATCH /ops/services; POST /ops/rate-cards; PATCH /ops/reviews/:id | Catalog, versioned pricing and audited moderation |
| A2 | POST /quotes, /checkouts; GET /orders, /orders/:id, /orders/:id/timeline | Shared ordering and tracking |
| A2 | POST /orders/:id/cancel, /orders/:id/reschedule, /orders/:id/adjustments/:adjustmentId/decision | Changes require current version |
| A2 | POST /orders/:id/support; GET /support/:id; POST /support/:id/messages | Customer/operator incident trail |
| A2 | GET /ops/orders; POST /ops/orders/:id/intake, /ops/orders/:id/care; GET/PUT /ops/capacity; PATCH /ops/support/:id | Facility workflow, capacity and support |
| A3 | GET /payments/:id, /orders/:id/receipts; POST /ops/refunds; GET /ops/reconciliation | Customer payment status, operations refund/reconciliation |
| A3 | POST /webhooks/payments/:provider | Authenticated external events only |
| A4 | GET /partner/jobs, /partner/jobs/:id; POST /partner/jobs/:id/accept, /partner/jobs/:id/handover, /partner/jobs/:id/exception | Task access and evidence |
| A4 | GET /ops/deliveries; POST /ops/deliveries/:id/dispatch, /ops/deliveries/:id/cancel | Manual/provider job controls |
| A4 | POST /webhooks/logistics/:provider | Provider-specific signature/auth verification |
| A8 | GET/POST /webhooks/whatsapp; POST /conversation-drafts/:id/confirm | Challenge verification and signed inbound messages; confirmation |
| A8 | GET /ops/conversations; POST /ops/conversations/:id/handoff | Restricted human escalation |

## Independent state machines

Order: `AWAITING_PAYMENT → CONFIRMED → PICKUP_PENDING → AT_FACILITY → IN_CARE → QUALITY_CHECK → READY_FOR_RETURN → RETURNING → DELIVERED`.
Exceptions: `AWAITING_ADJUSTMENT` before IN_CARE; `ON_HOLD` with recorded resume state/reason; `RESOLUTION_REQUIRED` for paid/slot conflict; `CANCEL_REQUESTED → CANCELLED` after logistics/care cancellation is resolved. No generic client-supplied status setter. Facility receipt, not merely a courier “delivered” event, authorizes AT_FACILITY.

Payment: `CREATED → PENDING → CAPTURED|FAILED|EXPIRED`. Capture is an immutable ledger fact; refunds are separate `REQUESTED → PROCESSING → SUCCEEDED|FAILED` records. Delayed authoritative capture can supersede a provisional failed/expired view; never discard money received. Refunded sums cannot exceed captured sums. Multiple payment attempts are tied to the same obligation and overpayments reconciled/refunded.

Delivery job: `REQUESTED → BOOKING_UNKNOWN|BOOKED → ASSIGNED → AT_PICKUP → IN_TRANSIT → COMPLETED`; exceptions `FAILED`, `CANCEL_REQUESTED`, `CANCELLED`. Leg completion does not mean order completion; only return completion with valid proof can deliver the order. Rebook creates a new attempt under the same leg, retaining history. At most one active attempt per leg.

Conversation: `COLLECTING → QUOTED → CONFIRMED → CHECKOUT_CREATED`; also `EXPIRED` and `HUMAN_HANDOFF`. Field edits increment revision and return to COLLECTING/QUOTED. A failed checkout request is retried with the same key; never generate a second key merely because of a timeout.

## Event and transaction contract

Envelope: `{ eventId, eventType, schemaVersion: 1, aggregateId, aggregateVersion, occurredAt, traceId, payload }`. Store the business update and outbox row in one DB transaction. Consumers record event ID and resulting local update in one transaction. Publish after commit; acknowledge after durable handling. Retry transient errors with bounded backoff, then dead-letter; retain replay capability and operator ownership.

- `payment.captured.v1` payload `{ paymentId, orderId, quoteId, purpose, amount }`: A3 → A2.
- `refund.updated.v1` payload `{ refundId, obligationId, orderId, status, amount }`: A3 → A2/A8.
- `order.confirmed.v1` payload `{ orderId, orderVersion }`: A2 → A4/A8.
- `order.ready-for-return.v1` payload `{ orderId, orderVersion, bagIds }`: A2 → A4.
- `delivery.updated.v1` payload `{ jobId, orderId, leg, attemptId, status, proofReference?, providerOccurredAt? }`: A4 → A2/A8.
- `order.updated.v1` payload `{ orderId, orderVersion, customerVisibleStatus, reasonCode? }`: A2 → A8.
- `order.delivered.v1` payload `{ orderId, customerId, deliveredAt }`: A2 → A1 creates review eligibility projection.

Ordering across providers is not assumed. Reject illegal regressions; fetch/reconcile authoritative provider state when sequence is uncertain. Do not fabricate provider sequence numbers. Public endpoints never accept these internal events from customer credentials.

## Data ownership

A0: identities, memberships, addresses, media metadata, auth sessions, outbox/inbox infrastructure, idempotency records, audit infrastructure.
A1: services, garment types, rate-card versions, service-area definitions, catalog assets, reviews, review eligibility.
A2: facilities, capacity buckets/holds, quotes/lines, orders/lines, order history, inventory/intake, adjustments, care tasks, support incidents.
A3: payment attempts, captures, refund obligations/attempts and reconciliation cursors.
A4: delivery legs/attempts, provider job refs, assignments, bag custody events and proof refs.
A8: conversation identity links (A0 verifies linking), messages, draft revisions, consent/opt-out records and notification deliveries.

A0 integrates all migrations. Use FK references for shared IDs, but exposed module ports for cross-module behavior. Snapshot address and rate information into the order so later profile edits do not alter an active delivery. Index owner/order/time queries, provider event IDs, outbox due time, and active facility capacity. Atomic conditional updates/row locks prevent overbooking; retry serialization conflicts with bounded attempts. Side effects never run inside a long DB transaction.

## Security and operational contracts

Rider sees only current assignment and minimum handover data; revoked assignment cannot sync a completion. Facility sees only its orders. Staff tokens have explicit roles and MFA in production. Short-lived signed media URLs; private proof/audio buckets; public catalog media separate. Webhook raw-body verification occurs before parsing; secrets stay server-side. Rate-limit auth, quote creation, media, webhooks and AI usage. Default incoming voice limit: 2 minutes/10 MB with friendly rejection; actual provider limits can be stricter. No card data in app/backend logs. Every trace redacts phone/address/audio/transcript by default.

Notification failure never rolls back an order. Payment failures never imply that a pending capture is impossible. Failed provider booking with unknown outcome is reconciled by stable external reference before retry. Proposed automated retry budget: 5 attempts over 15 minutes, then operator queue; exact vendor rate limits take precedence. Audio deletion must include queued temporary files and failed transcription paths. Privacy/care/refund policies are configured before launch and are not claimed as legal advice by this plan.
