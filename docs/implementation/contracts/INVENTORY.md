# C01 contract inventory

Contract target: `laundry-wire-v2.0.0`.

C01 is not frozen. This file records declarations generated from `packages/contracts/src/v2/routes.ts`. A schema name does not prove that the schema exists or that a backend implements it. Permission and transaction behavior below are requirements, not acceptance evidence. See `IDENTITY-AND-ROUTING.md` for the latest SDK checks and remaining gaps.

Published operations: 84.
Event types: 10.
Error codes: 17.
Service codes: 4.
Billing units: 2.

## Permission and idempotency rules

| Rule | Meaning |
|---|---|
| `PUBLIC` | No session. The route may return only public catalog and reference data. |
| `CUSTOMER` | The session must resolve to a customer, and the route must scope the read or write to that customer's own records. |
| `RIDER` | The session must resolve to a delivery partner, and the route must scope the read or write to that partner's current assignment. |
| `OPERATOR` | The session must resolve to a staff member with facility membership. The facility scope comes from the server, never from the request body. |
| `SUPPORT` | Staff support access, audited. |
| `ADMIN` | Administrative access, audited, and never granted by a client-selected field. |
| `REQUIRED` | The request carries an `Idempotency-Key`. The same key with the same payload replays the original result. The same key with a different payload is an idempotency conflict. |
| `OPTIONAL` | The command accepts an idempotency key. Without one the command is not safe to retry. |
| `NOT_APPLICABLE` | A read. A read never sends an idempotency key. |

## Operations

### B01

| Method | Path | Request | Response | Roles | Idempotency | Errors |
|---|---|---|---|---|---|---|
| `POST` | `/v2/identity/otp` | `OtpRequest` | `OtpChallenge` | PUBLIC | REQUIRED | INVALID_INPUT, RATE_LIMITED, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN |
| `POST` | `/v2/identity/otp/verify` | `OtpVerify` | `Session` | PUBLIC | REQUIRED | INVALID_INPUT, UNAUTHENTICATED, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/identity/session/refresh` | `SessionRefresh` | `Session` | PUBLIC | REQUIRED | UNAUTHENTICATED, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/identity/logout` | - | `LogoutResult` | CUSTOMER, RIDER, FACILITY, OPERATOR, SUPPORT, ADMIN | REQUIRED | UNAUTHENTICATED, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/identity/sessions/{sessionId}/revoke` | - | `SessionRevocation` | CUSTOMER, RIDER, FACILITY, OPERATOR, SUPPORT, ADMIN | REQUIRED | UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/identity/me` | - | `Actor` | CUSTOMER, RIDER, FACILITY, OPERATOR, SUPPORT, ADMIN | NOT_APPLICABLE | UNAUTHENTICATED, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/identity/staff/invitations` | `StaffInvitation` | `StaffInvitationResult` | OPERATOR, ADMIN | REQUIRED | FORBIDDEN, INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/identity/staff/mfa` | `StaffMfaSetup` | `StaffMfaResult` | FACILITY, OPERATOR, ADMIN, SUPPORT | REQUIRED | FORBIDDEN, UNAUTHENTICATED, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/identity/addresses` | `AddressInput` | `Address` | CUSTOMER | REQUIRED | INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/identity/addresses` | - | `AddressList` | CUSTOMER | NOT_APPLICABLE | UNAUTHENTICATED, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `PATCH` | `/v2/identity/addresses/{addressId}` | `AddressUpdate` | `Address` | CUSTOMER | REQUIRED | NOT_FOUND, VERSION_CONFLICT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `DELETE` | `/v2/identity/addresses/{addressId}` | `AddressDelete` | `DeleteResult` | CUSTOMER | REQUIRED | NOT_FOUND, VERSION_CONFLICT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/identity/whatsapp/link` | `WhatsAppLink` | `WhatsAppLinkResult` | CUSTOMER | REQUIRED | UNAUTHENTICATED, VERSION_CONFLICT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |

### B02

| Method | Path | Request | Response | Roles | Idempotency | Errors |
|---|---|---|---|---|---|---|
| `GET` | `/v2/catalog/services` | - | `ServiceList` | PUBLIC | NOT_APPLICABLE | INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/catalog/services/{serviceId}` | - | `Service` | PUBLIC | NOT_APPLICABLE | NOT_FOUND, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/catalog/garments/eligibility` | - | `GarmentEligibilityList` | PUBLIC | NOT_APPLICABLE | INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/catalog/rates/effective` | - | `EffectiveRateSummary` | PUBLIC | NOT_APPLICABLE | NOT_FOUND, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `PATCH` | `/v2/ops/catalog/services/{serviceId}` | `ServiceUpdate` | `Service` | OPERATOR, ADMIN | REQUIRED | FORBIDDEN, VERSION_CONFLICT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/ops/catalog/rate-cards` | `RateCardInput` | `RateCard` | OPERATOR, ADMIN | REQUIRED | INVALID_INPUT, VERSION_CONFLICT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/ops/catalog/rate-cards/{rateCardId}/approve` | `VersionedReason` | `RateCard` | OPERATOR, ADMIN | REQUIRED | FORBIDDEN, VERSION_CONFLICT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/ops/catalog/rate-cards/{rateCardId}/activate` | `VersionedReason` | `RateCard` | OPERATOR, ADMIN | REQUIRED | FORBIDDEN, VERSION_CONFLICT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |

### B03

| Method | Path | Request | Response | Roles | Idempotency | Errors |
|---|---|---|---|---|---|---|
| `GET` | `/v2/availability/areas/{postalCode}` | - | `ServiceArea` | PUBLIC | NOT_APPLICABLE | NOT_FOUND, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/availability/slots` | - | `SlotPairList` | PUBLIC | NOT_APPLICABLE | INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/ops/availability/calendar` | - | `OperationsCalendar` | OPERATOR, SUPPORT, ADMIN | NOT_APPLICABLE | FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `PUT` | `/v2/ops/availability/capacity` | `CapacityUpdate` | `CapacityResult` | OPERATOR, ADMIN | REQUIRED | FORBIDDEN, VERSION_CONFLICT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |

### B04

| Method | Path | Request | Response | Roles | Idempotency | Errors |
|---|---|---|---|---|---|---|
| `POST` | `/v2/orders/quotes` | `QuoteInput` | `Quote` | CUSTOMER | REQUIRED | INVALID_INPUT, NOT_FOUND, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/orders` | `BookingInput` | `Order` | CUSTOMER | REQUIRED | VERSION_CONFLICT, INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/orders` | - | `OrderPage` | CUSTOMER | NOT_APPLICABLE | UNAUTHENTICATED, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/orders/{orderId}` | - | `Order` | CUSTOMER | NOT_APPLICABLE | NOT_FOUND, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/orders/{orderId}/timeline` | - | `OrderTimeline` | CUSTOMER | NOT_APPLICABLE | NOT_FOUND, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/orders/{orderId}/cancel` | `OrderCancellation` | `Order` | CUSTOMER | REQUIRED | VERSION_CONFLICT, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/orders/{orderId}/reschedule` | `OrderReschedule` | `Order` | CUSTOMER | REQUIRED | VERSION_CONFLICT, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/orders/{orderId}/adjustments/decision` | `AdjustmentDecision` | `Order` | CUSTOMER | REQUIRED | VERSION_CONFLICT, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/ops/orders/queue` | - | `OrderQueue` | FACILITY, OPERATOR, ADMIN, SUPPORT | NOT_APPLICABLE | FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/ops/orders/{orderId}/intake` | `IntakeRecord` | `Order` | FACILITY, OPERATOR, ADMIN | REQUIRED | VERSION_CONFLICT, INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/ops/orders/{orderId}/care` | `CareUpdate` | `Order` | FACILITY, OPERATOR, ADMIN | REQUIRED | VERSION_CONFLICT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/ops/orders/{orderId}/quality-check` | `QualityCheck` | `Order` | FACILITY, OPERATOR, ADMIN | REQUIRED | VERSION_CONFLICT, INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/ops/orders/{orderId}/hold` | `OrderHold` | `Order` | OPERATOR, ADMIN | REQUIRED | VERSION_CONFLICT, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/ops/orders/{orderId}/exceptions/resolve` | `ExceptionResolution` | `Order` | OPERATOR, SUPPORT, ADMIN | REQUIRED | VERSION_CONFLICT, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |

### B05

| Method | Path | Request | Response | Roles | Idempotency | Errors |
|---|---|---|---|---|---|---|
| `GET` | `/v2/orders/{orderId}/billing/obligations` | - | `ObligationList` | CUSTOMER | NOT_APPLICABLE | NOT_FOUND, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/orders/{orderId}/billing/attempts` | - | `PaymentAttemptList` | CUSTOMER | NOT_APPLICABLE | NOT_FOUND, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/orders/{orderId}/billing/receipts` | - | `ReceiptList` | CUSTOMER | NOT_APPLICABLE | NOT_FOUND, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/orders/{orderId}/billing/refunds` | - | `RefundList` | CUSTOMER | NOT_APPLICABLE | NOT_FOUND, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/ops/billing/obligations/{obligationId}/confirm-manual` | `ManualPaymentConfirmation` | `Receipt` | OPERATOR, ADMIN | REQUIRED | VERSION_CONFLICT, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/ops/billing/refunds` | `RefundRequest` | `Refund` | OPERATOR, ADMIN | REQUIRED | VERSION_CONFLICT, FORBIDDEN, INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/ops/billing/reconciliation` | `ReconciliationRequest` | `Reconciliation` | OPERATOR, ADMIN | REQUIRED | FORBIDDEN, INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/webhooks/payments/{provider}` | `PaymentWebhook` | `WebhookResult` | PROVIDER | PROVIDER_EVENT | UNAUTHENTICATED, INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/billing/obligations` | - | `ObligationPage` | CUSTOMER | NOT_APPLICABLE | UNAUTHENTICATED, INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/billing/obligations/{obligationId}` | - | `BillingSummary` | CUSTOMER | NOT_APPLICABLE | UNAUTHENTICATED, NOT_FOUND, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/billing/obligations/{obligationId}/receipts` | - | `ReceiptPage` | CUSTOMER | NOT_APPLICABLE | UNAUTHENTICATED, NOT_FOUND, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/billing/refunds` | - | `RefundPage` | CUSTOMER | NOT_APPLICABLE | UNAUTHENTICATED, INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |

### B06

| Method | Path | Request | Response | Roles | Idempotency | Errors |
|---|---|---|---|---|---|---|
| `GET` | `/v2/rider/jobs` | - | `RiderJobList` | RIDER | NOT_APPLICABLE | FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/rider/jobs/{jobId}` | - | `RiderJob` | RIDER | NOT_APPLICABLE | NOT_FOUND, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/rider/jobs/{jobId}/accept` | `VersionedCommand` | `Assignment` | RIDER | REQUIRED | VERSION_CONFLICT, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/rider/handovers` | `RiderHandover` | `HandoverResult` | RIDER | REQUIRED | VERSION_CONFLICT, FORBIDDEN, INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/rider/jobs/{jobId}/exception` | `DeliveryException` | `LegAttempt` | RIDER | REQUIRED | VERSION_CONFLICT, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/rider/location` | `RiderLocationReport` | `Location` | RIDER | REQUIRED | FORBIDDEN, INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/ops/logistics/assignments` | `AssignmentInput` | `Assignment` | OPERATOR, ADMIN | REQUIRED | VERSION_CONFLICT, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/ops/logistics/assignments/{assignmentId}/reassign` | `ReassignmentInput` | `Assignment` | OPERATOR, ADMIN | REQUIRED | VERSION_CONFLICT, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/ops/logistics/legs/{legAttemptId}/cancel` | `LegCancellation` | `LegAttempt` | OPERATOR, ADMIN | REQUIRED | VERSION_CONFLICT, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/webhooks/logistics/{provider}` | `LogisticsWebhook` | `WebhookResult` | PROVIDER | PROVIDER_EVENT | UNAUTHENTICATED, INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/orders/{orderId}/tracking` | - | `CustomerTracking` | CUSTOMER | NOT_APPLICABLE | NOT_FOUND, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/logistics/tracking/{orderId}` | - | `CustomerTracking` | CUSTOMER | NOT_APPLICABLE | UNAUTHENTICATED, NOT_FOUND, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/orders/{orderId}/custody-receipt` | - | `CustodyReceipt` | CUSTOMER | NOT_APPLICABLE | NOT_FOUND, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |

### B07

| Method | Path | Request | Response | Roles | Idempotency | Errors |
|---|---|---|---|---|---|---|
| `POST` | `/v2/media/upload-intents` | `UploadIntent` | `UploadIntentResult` | CUSTOMER, RIDER, FACILITY, OPERATOR, SUPPORT, ADMIN | REQUIRED | FORBIDDEN, INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/media/{mediaId}/finalize` | - | `MediaReference` | CUSTOMER, RIDER, FACILITY, OPERATOR, SUPPORT, ADMIN | REQUIRED | NOT_FOUND, FORBIDDEN, INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/media/{mediaId}/download` | - | `MediaDownload` | CUSTOMER, RIDER, FACILITY, OPERATOR, SUPPORT, ADMIN | REQUIRED | NOT_FOUND, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |

### B08

| Method | Path | Request | Response | Roles | Idempotency | Errors |
|---|---|---|---|---|---|---|
| `POST` | `/v2/orders/{orderId}/incidents` | `IncidentInput` | `Incident` | CUSTOMER | REQUIRED | NOT_FOUND, FORBIDDEN, INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/incidents` | - | `IncidentPage` | CUSTOMER | NOT_APPLICABLE | UNAUTHENTICATED, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/incidents/{incidentId}/messages` | `IncidentMessageInput` | `IncidentMessage` | CUSTOMER, OPERATOR, SUPPORT, ADMIN | REQUIRED | NOT_FOUND, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/ops/incidents/{incidentId}/resolve` | `IncidentResolutionInput` | `Incident` | OPERATOR, SUPPORT, ADMIN | REQUIRED | VERSION_CONFLICT, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/incidents/{incidentId}/rewash-requests` | `RewashRequestInput` | `RewashRequest` | CUSTOMER | REQUIRED | NOT_FOUND, VERSION_CONFLICT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/orders/{orderId}/reviews` | `ReviewInput` | `Review` | CUSTOMER | REQUIRED | VERSION_CONFLICT, FORBIDDEN, INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/ops/reviews/{reviewId}/moderation` | `ReviewModerationInput` | `Review` | OPERATOR, SUPPORT, ADMIN | REQUIRED | NOT_FOUND, FORBIDDEN, VERSION_CONFLICT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/reviews` | - | `PublicReviewPage` | PUBLIC | NOT_APPLICABLE | INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/incidents/{incidentId}/messages` | - | `IncidentMessagePage` | CUSTOMER, OPERATOR, SUPPORT, ADMIN | NOT_APPLICABLE | NOT_FOUND, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/reviews/eligibility/{orderId}` | - | `ReviewEligibility` | CUSTOMER | NOT_APPLICABLE | NOT_FOUND, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |

### B09

| Method | Path | Request | Response | Roles | Idempotency | Errors |
|---|---|---|---|---|---|---|
| `POST` | `/v2/webhooks/conversations/{provider}` | `InboundMessage` | `ConversationReply` | PROVIDER | PROVIDER_EVENT | UNAUTHENTICATED, INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/conversations/drafts/{draftId}/confirm` | `DraftConfirmation` | `Order` | CUSTOMER | REQUIRED | VERSION_CONFLICT, INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/conversations/opt-out` | `ConversationOptOut` | `OptOutResult` | CUSTOMER | REQUIRED | INVALID_INPUT, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/ops/conversations/{draftId}/handoff` | `ConversationHandoff` | `ConversationDraft` | OPERATOR, SUPPORT, ADMIN | REQUIRED | NOT_FOUND, VERSION_CONFLICT, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |

### B10

| Method | Path | Request | Response | Roles | Idempotency | Errors |
|---|---|---|---|---|---|---|
| `GET` | `/v2/ops/jobs/dead-letter` | - | `JobPage` | OPERATOR, ADMIN | NOT_APPLICABLE | FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `POST` | `/v2/ops/jobs/{jobId}/replay` | `JobReplay` | `Job` | OPERATOR, ADMIN | REQUIRED | NOT_FOUND, VERSION_CONFLICT, FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |
| `GET` | `/v2/ops/jobs/health` | - | `JobHealth` | OPERATOR, ADMIN | NOT_APPLICABLE | FORBIDDEN, PROVIDER_UNAVAILABLE, PROVIDER_OUTCOME_UNKNOWN, RATE_LIMITED |

## Events

Every event uses the envelope `{eventId, eventType, schemaVersion: 2, aggregateId, aggregateVersion, occurredAt, traceId, payload}`.

| Event type | Emitted when | Consumers |
|---|---|---|
| `order.confirmed.v2` | A booking creates an order and its due-at-return obligation | B04, B05, B06, F01, F02 |
| `order.intake-recorded.v2` | The facility records counted and measured intake | B04, B05, F02, F04 |
| `order.adjustment-decided.v2` | The customer accepts or declines a price adjustment | B04, B05, F02 |
| `order.ready-for-return.v2` | Care and quality check are complete | B06, F02, F03 |
| `order.delivered.v2` | Return custody is accepted and the order is delivered | B05, B08, F02 |
| `payment.settled.v2` | An obligation reaches settled or void | B05, B04, F02, F04 |
| `refund.updated.v2` | A refund moves state | B05, F02, F04 |
| `delivery.updated.v2` | A delivery leg attempt moves state | B06, F02, F03, F04 |
| `media.uploaded.v2` | A private media object becomes available | B07, B08, F02, F03 |
| `conversation.draft-confirmed.v2` | A conversation draft is confirmed against the current quote | B09, B04, F02 |

## Internal ports

Every module writes through a typed port. A port never accepts a client-supplied role or scope, and a port never throws across a module boundary. Each command carries `CommandMeta` with the server-derived actor, the idempotency key, the expected version when the aggregate is versioned, a trace id and the request time.

| Port | Owning module | Commands |
|---|---|---|
| `IdentityPort` | B01 | requestOtp, verifyOtp, refreshSession, revokeSession, inviteStaff, completeMfa, listAddresses, createAddress, linkWhatsapp |
| `PricingPort` | B02 | priceBasket, effectiveRate, approveRateCard, activateRateCard |
| `AvailabilityPort` | B03 | listSlots, hold, reserve, release, setCapacity |
| `OrdersPort` | B04 | quote, book, recordIntake, decideAdjustment, cancel, reschedule |
| `BillingPort` | B05 | createObligation, recordAttempt, confirmManualPayment, refund, reconcile |
| `LogisticsPort` | B06 | assign, reassign, recordHandover, reportException |
| `MediaPort` | B07 | createUploadIntent, finalize, resolveDownload, deleteExpired |
| `SupportPort` | B08 | openIncident, postIncidentMessage, resolveIncident, requestRewash |
| `ReviewsPort` | B08 | listEligible, createReview, moderateReview |
| `ConversationsPort` | B09 | receiveInbound, reviseDraft, confirmDraft, requestHandoff |
| `SpeechPort` | B09 | transcribe |
| `NotificationTransport` | B10 | send, sendBatch |
| `JobsPort` | B10 | enqueue, claim, complete, fail, deadLetter, replay |

## Transaction participation

| Command | Joins the caller's transaction | Runs after commit |
|---|---|---|
| `book` | Quote validation, ownership, version check, capacity reservation, order creation, obligation creation, audit, idempotency result and outbox record | Notification and provider calls |
| `recordIntake` | Measured facts, container events, adjustment creation, audit, outbox record | Notification and provider calls |
| `decideAdjustment` | Adjustment state, order state, audit, outbox record | Notification and provider calls |
| `confirmManualPayment` | Receipt, obligation balance, ledger entry, audit, outbox record | Notification and provider calls |
| `recordHandover` | Custody event, leg attempt state, order state, audit, outbox record | Notification and provider calls |
| `refund` | Refund state, ledger entry, audit, outbox record | Gateway calls |
| `reserve` | Capacity hold and reservation, audit, outbox record | Notification and provider calls |

No vendor network request happens inside a long database transaction. The intent and a stable provider reference are persisted first, the external call runs after the commit, and the outcome is reconciled afterwards, including the case where the outcome is unknown.

## Compatibility

The v1 contract is unchanged and keeps its own exports, its own default base URL and its own tests. The v2 contract is exported as a namespace, `import { v2 } from "@laundry/contracts"`, so a consumer can migrate one screen at a time. A v1 order keeps its recorded model and payment facts. A legacy record is never relabelled as a native v2 order by changing an identifier.
