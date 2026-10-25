import { v2 } from "@laundry/contracts";

export const V2_FIXTURE_LABEL = "Synthetic contract fixture only. Not approved prices, promises, customers or production integrations.";
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const at = "2026-10-22T05:00:00.000Z";
const expiry = "2026-10-22T06:00:00.000Z";
const pickup = { start: "2026-10-23T03:30:00.000Z", end: "2026-10-23T04:30:00.000Z", timezone: "Asia/Kolkata" };
const returned = { start: "2026-10-26T03:30:00.000Z", end: "2026-10-26T04:30:00.000Z", timezone: "Asia/Kolkata" };
const page = <T>(...items: T[]) => ({ items, pageInfo: { hasMore: false } });
const reason = { expectedVersion: 1, reason: "Synthetic operator decision" };
const actor: v2.Actor = { id: id(1), role: "CUSTOMER", facilityIds: [], scope: { facilityIds: [] } };
const addressInput: v2.AddressInput = { label: "Synthetic home", line1: "Synthetic address", city: "Bengaluru", postalCode: "560038", coordinates: { lat: 12.97, lng: 77.64 } };
const address: v2.Address = { ...addressInput, id: id(2), ownerId: actor.id, version: 1 };
const garment: v2.GarmentEligibility = { id: id(3), name: "Synthetic shirt", eligibleServiceCodes: ["WASH_PRESS", "PRESS_ONLY", "DRY_CLEAN"], active: true };
const services: v2.Service[] = v2.serviceCodeSchema.options.map((code, index) => ({
  id: id(10 + index), version: 1, code, name: `Synthetic ${code}`, description: V2_FIXTURE_LABEL,
  imageUrl: `https://example.invalid/catalog/${code}.jpg`, billingUnit: code === "WASH_FOLD" ? "KG" : "PIECE",
  turnaroundHours: 72, garments: [garment], features: [], careExclusions: ["Synthetic unsupported fabric"], active: true,
}));
const rateInput: v2.RateCardInput = { serviceCodes: [...v2.serviceCodeSchema.options], components: [{ label: "Synthetic rate", kind: "PER_KG", amountMinor: 5000, synthetic: true }], weightIncrementGrams: 500, minimumBillableGrams: 1000, rounding: "CEIL", effectiveFrom: at, synthetic: true };
const rateCard: v2.RateCard = { ...rateInput, id: id(4), version: 1, approvedAt: at, activatedAt: at };
const quoteInput: v2.QuoteInput = {
  addressId: address.id,
  lines: [
    { serviceId: services[0].id, billingUnit: "KG", estimatedWeightGrams: 3000, declaredGarmentCount: 15 },
    { serviceId: services[1].id, billingUnit: "PIECE", garmentTypeId: garment.id, pieceQuantity: 2, declaredGarmentCount: 2 },
  ],
  pickupWindow: pickup, requestedReturnBy: returned.end, timezone: "Asia/Kolkata",
};
const quote: v2.Quote = {
  id: id(5), version: 1, lines: [
    { ...quoteInput.lines[0], unitPriceMinor: 5000, lineTotalMinor: 15000, rateCardId: rateCard.id, rateCardVersion: 1, provisional: true },
    { ...quoteInput.lines[1], unitPriceMinor: 4000, lineTotalMinor: 8000, rateCardId: rateCard.id, rateCardVersion: 1, provisional: false },
  ], totalMinor: 23000, currency: "INR", provisional: true, expiresAt: expiry,
  addressSnapshotId: id(6), pickupWindow: pickup, promisedReturnWindow: returned,
  holdReference: id(7), holdExpiresAt: expiry, catalogVersion: 1,
  breakdown: [{ label: "Synthetic kilogram line", kind: "PER_KG", amountMinor: 15000 }, { label: "Synthetic piece line", kind: "PER_PIECE", amountMinor: 8000 }],
};
const container: v2.Container = { id: id(8), sealId: "SYNTHETIC-SEAL", sealed: true, condition: "GOOD", garmentCount: 17, weightGrams: 3000 };
const measured: v2.MeasuredLine = { orderLineId: id(20), countedQuantity: 15, measuredWeightGrams: 3000, condition: "GOOD" };
const order: v2.Order = {
  id: id(9), version: 1, status: "CONFIRMED", customerId: actor.id, facilityId: id(30),
  lines: quote.lines.map((line, index) => ({ ...line, orderLineId: id(20 + index) })),
  totalMinor: quote.totalMinor, currency: "INR", paymentModel: "DUE_AT_RETURN",
  pickupWindow: pickup, promisedReturnWindow: returned, createdAt: at,
  timeline: [{ status: "CONFIRMED", label: "Synthetic booking", at }],
  containers: [container], permittedActions: ["REQUEST_CANCEL"], deliveryLegs: [],
};
const custody: v2.CustodyReceipt = { orderId: order.id, estimatedQuantity: 17, declaredGarmentCount: 17, countedQuantity: 17, measuredWeightGrams: 3000, sealedContainerCount: 1, amountDueAtReturnMinor: 23000, currency: "INR", currentHandoff: "PICKUP_PENDING", updatedAt: at };
const adjustment: v2.Adjustment = { id: id(31), version: 1, reason: "Synthetic measured-weight increase", previousTotalMinor: 23000, newTotalMinor: 25000, deltaMinor: 2000, state: "ACCEPTED", expiresAt: expiry, decidedAt: at };
const adjustmentDecision: v2.AdjustmentDecision = { adjustmentId: adjustment.id, adjustmentVersion: 1, expectedVersion: 1, decision: "ACCEPT" };
const obligation: v2.Obligation = { id: id(32), orderId: order.id, status: "OPEN", amountDueMinor: 23000, amountSettledMinor: 0, currency: "INR", paymentModel: "DUE_AT_RETURN", dueAt: returned.end, version: 1 };
const receipt: v2.Receipt = { id: id(33), obligationId: obligation.id, amountMinor: 23000, currency: "INR", method: "CASH", confirmedBy: id(34), confirmedVia: "MANUAL_CASH", issuedAt: at };
const attempt: v2.PaymentAttempt = { id: id(35), obligationId: obligation.id, status: "SUCCEEDED", method: "CASH", amountMinor: 23000, startedAt: at, resolvedAt: at, attemptCount: 1 };
const refund: v2.Refund = { id: id(36), orderId: order.id, paymentId: attempt.id, obligationId: obligation.id, status: "REQUESTED", amountMinor: 1000, currency: "INR", reason: "Synthetic agreed refund", requestedBy: id(34), requestedAt: at, attemptCount: 1 };
const leg: v2.LegAttempt = { id: id(37), legId: id(38), orderId: order.id, leg: "RETURN", version: 1, status: "COMPLETED", attemptNumber: 1, startedAt: at, completedAt: at };
const assignment: v2.Assignment = { id: id(39), legAttemptId: leg.id, riderId: id(40), version: 1, assignedAt: at, acceptedAt: at };
const job: v2.RiderJob = { id: id(41), orderId: order.id, leg: "PICKUP", status: "ASSIGNED", version: 1, customerName: "Synthetic customer", addressLine1: address.line1, addressCity: address.city, addressPostalCode: address.postalCode, window: pickup, containerIds: [container.id], containerCount: 1, assignedTo: assignment.riderId, assignmentActive: true };
const tracking: v2.CustomerTracking = { orderId: order.id, status: order.status, steps: [], pickupWindow: pickup, promisedReturnWindow: returned };
const media: v2.MediaReference = { id: id(42), kind: "PROOF_IMAGE", visibility: "PRIVATE", mimeType: "image/jpeg", sizeBytes: 1000, ownerId: actor.id, createdAt: at, expiresAt: expiry, status: "AVAILABLE" };
const incident: v2.Incident = { id: id(43), orderId: order.id, status: "OPEN", category: "QUALITY", summary: "Synthetic care concern", mediaIds: [media.id], createdAt: at, updatedAt: at, version: 1 };
const message: v2.IncidentMessage = { id: id(44), incidentId: incident.id, authorRole: "CUSTOMER", authorId: actor.id, body: "Synthetic support message", mediaIds: [], createdAt: at };
const rewash: v2.RewashRequest = { id: id(45), incidentId: incident.id, orderId: order.id, status: "REQUESTED", reason: incident.summary, createdAt: at, version: 1 };
const reviewInput: v2.ReviewInput = { orderId: order.id, expectedVersion: 1, overall: 4, mediaIds: [], publishConsent: true, comment: "Synthetic review fixture. Not a real review." };
const review: v2.Review = { id: id(46), orderId: order.id, customerId: actor.id, overall: 4, comment: reviewInput.comment, mediaIds: [], publishConsent: true, publication: "PENDING", createdAt: at, updatedAt: at, version: 1 };
const publicReview: v2.PublicReview = { id: review.id, orderId: order.id, displayName: "Synthetic reviewer", overall: 4, mediaIds: [], createdAt: at };
const draft: v2.ConversationDraft = { draftId: id(47), revision: 2, state: "QUOTED", fields: [{ name: "QUANTITY", value: "3 kilograms and 2 pieces", confidence: "HIGH", source: "TEXT" }], quoteId: quote.id, quoteVersion: quote.version, expiresAt: expiry, missingFields: [] };
const confirmation: v2.DraftConfirmation = { draftId: draft.draftId, revision: draft.revision, quoteId: quote.id, quoteVersion: quote.version };
const task: v2.Job = { id: id(48), kind: "synthetic.notification", status: "DEAD_LETTER", version: 1, attempts: 5, runAt: at, lastErrorCode: "PROVIDER_UNAVAILABLE" };
const bucket: v2.CapacityBucket = { id: id(49), facilityId: id(30), areaId: id(50), window: pickup, capacity: 2, reserved: 1, version: 1 };
const area: v2.ServiceArea = { id: bucket.areaId, name: "Synthetic area only", timezone: "Asia/Kolkata", polygon: [{ lat: 12.9, lng: 77.6 }, { lat: 13, lng: 77.6 }, { lat: 13, lng: 77.7 }], hours: [{ dayOfWeek: 1, start: "09:00", end: "18:00" }], active: true };
const billingSummary: v2.BillingSummary = { orderId: order.id, obligationStatus: obligation.status, amountDueMinor: obligation.amountDueMinor, amountSettledMinor: 0, currency: "INR", receipts: [], refunds: [], dueAt: obligation.dueAt };

/** Every value is authored from a concrete synthetic scenario, not generated
 * by walking a permissive schema. Adding a wire name requires a new example. */
export const v2WireFixtures = {
  OtpRequest: { phone: "+919000000000" }, OtpChallenge: { challengeId: id(51), expiresAt: expiry },
  OtpVerify: { challengeId: id(51), code: "123456" }, SessionRefresh: { refreshToken: "synthetic-refresh-not-a-credential" },
  Session: { sessionId: id(52), accessToken: "synthetic-access-not-a-credential", refreshToken: "synthetic-refresh-not-a-credential", expiresAt: expiry, actor },
  LogoutResult: { revoked: true }, SessionRevocation: { sessionId: id(52), revoked: true }, Actor: actor,
  StaffInvitation: { phone: "+919000000001", role: "FACILITY", facilityIds: [id(30)], reason: "Synthetic staff invitation" },
  StaffInvitationResult: { invitationId: id(53), expiresAt: expiry }, StaffMfaSetup: { action: "ENROLL" }, StaffMfaResult: { status: "CHALLENGE", challengeId: id(51), expiresAt: expiry },
  Address: address, AddressInput: addressInput, AddressUpdate: { ...addressInput, expectedVersion: 1 }, AddressDelete: { expectedVersion: 1 }, AddressList: [address], DeleteResult: { id: address.id, deleted: true },
  WhatsAppLink: { challengeId: id(51), code: "123456" }, WhatsAppLinkResult: { linked: true, linkedAt: at },
  Service: services[0], ServiceList: services, GarmentEligibilityList: [garment],
  EffectiveRateSummary: [{ serviceCode: "WASH_FOLD", billingUnit: "KG", unitPriceMinor: 5000, unitLabel: "Synthetic INR per kilogram", weightIncrementGrams: 500, minimumBillableGrams: 1000, rateCardVersion: 1, synthetic: true }],
  ServiceUpdate: { ...reason, active: false }, RateCardInput: rateInput, RateCard: rateCard, VersionedReason: reason,
  ServiceArea: area, SlotPairList: [{ id: id(54), pickupWindow: pickup, returnWindow: returned, available: true }],
  OperationsCalendar: { buckets: [bucket], generatedAt: at }, CapacityUpdate: { ...reason, bucketId: bucket.id, capacity: 2 }, CapacityResult: bucket,
  QuoteInput: quoteInput, Quote: quote, BookingInput: { quoteId: quote.id, expectedVersion: 1, paymentModel: "DUE_AT_RETURN" },
  Order: order, OrderPage: page(order), OrderTimeline: order.timeline, OrderCancellation: reason,
  OrderReschedule: { expectedVersion: 1, newQuoteId: quote.id, quoteVersion: 1 }, AdjustmentDecision: adjustmentDecision, OrderQueue: page(order),
  IntakeRecord: { expectedVersion: 1, lines: [measured], containers: [container], mediaIds: [media.id] },
  CareUpdate: { expectedVersion: 1, target: "IN_CARE" }, QualityCheck: { expectedVersion: 1, passed: true, containers: [container], mediaIds: [] }, OrderHold: reason, ExceptionResolution: { ...reason, action: "RESUME" },
  ObligationList: page(obligation), PaymentAttemptList: page(attempt), ReceiptList: page(receipt), RefundList: page(refund),
  ManualPaymentConfirmation: { ...reason, method: "CASH", amountMinor: 23000, currency: "INR" }, Receipt: receipt,
  RefundRequest: { ...reason, orderId: order.id, paymentId: attempt.id, obligationId: obligation.id, amountMinor: 1000, currency: "INR" }, Refund: refund,
  ReconciliationRequest: { period: "2026-10" }, Reconciliation: { periodStart: at, periodEnd: expiry, entries: [], capturedMinor: 0, refundedMinor: 0, manualMinor: 0, unmatchedCount: 0, differenceMinor: 0 },
  PaymentWebhook: { eventId: "synthetic-provider-event", paymentId: attempt.id, outcome: "SUCCEEDED", amountMinor: 23000, currency: "INR", occurredAt: at, providerReference: "synthetic-provider-reference" }, WebhookResult: { accepted: true, duplicate: false },
  RiderJobList: [job], RiderJob: job, VersionedCommand: { expectedVersion: 1 }, Assignment: assignment,
  RiderHandover: { jobId: job.id, legAttemptId: leg.id, expectedVersion: 1, actionId: id(55), method: "CODE", code: "123456", capturedAt: at, containerIds: [container.id], garmentCount: 17, condition: "GOOD" },
  HandoverResult: { legAttemptId: leg.id, accepted: true, custodyEventId: id(56), attemptCount: 1, nextAttemptAllowed: false },
  DeliveryException: { ...reason, actionId: id(55), capturedAt: at, mediaIds: [] }, LegAttempt: leg,
  RiderLocationReport: { jobId: job.id, expectedVersion: 1, lat: 12.97, lng: 77.64, reportedAt: at }, Location: { orderId: order.id, lat: 12.97, lng: 77.64, reportedAt: at, source: "DEVICE", stale: false },
  AssignmentInput: { ...reason, legAttemptId: leg.id, riderId: assignment.riderId }, ReassignmentInput: { ...reason, riderId: id(57) }, LegCancellation: reason,
  LogisticsWebhook: { eventId: "synthetic-logistics-event", providerReference: "synthetic-job", status: "COMPLETED", occurredAt: at, proofReference: "synthetic-provider-proof" }, CustomerTracking: tracking,
  UploadIntent: { kind: "PROOF_IMAGE", mimeType: "image/jpeg", sizeBytes: 1000, orderId: order.id },
  UploadIntentResult: { uploadId: media.id, uploadUrl: "https://example.invalid/private/upload", expiresAt: expiry, maxBytes: 1000, allowedMimeTypes: ["image/jpeg"] },
  MediaReference: media, MediaDownload: { url: "https://example.invalid/private/download", expiresAt: expiry },
  IncidentInput: { orderId: order.id, category: incident.category, summary: incident.summary, mediaIds: [] }, Incident: incident, IncidentPage: page(incident),
  IncidentMessageInput: { body: message.body, mediaIds: [] }, IncidentMessage: message,
  IncidentResolutionInput: { ...reason, outcome: "REFUND", refundAmountMinor: 1000 }, RewashRequestInput: reason, RewashRequest: rewash,
  ReviewInput: reviewInput, Review: review, ReviewModerationInput: { ...reason, decision: "PUBLISH" }, PublicReviewPage: page(publicReview),
  InboundMessage: { providerMessageId: "synthetic-whatsapp-message", fromPhone: "+919000000000", text: "Synthetic laundry request", receivedAt: at, verification: "VERIFIED" },
  ConversationReply: { draft, reply: "Synthetic exact terms summary", missingFields: [], quote, handoff: false }, DraftConfirmation: confirmation,
  ConversationOptOut: { channel: "WHATSAPP" }, OptOutResult: { optedOut: true }, ConversationHandoff: { expectedRevision: 2, assignedTo: id(34), reason: reason.reason }, ConversationDraft: draft,
  JobPage: page(task), JobReplay: reason, Job: task, JobHealth: { queued: 1, claimed: 0, deadLetter: 1, oldestDueAt: at, observedAt: at },
  ObligationPage: page(obligation), BillingSummary: billingSummary, ReceiptPage: page(receipt), RefundPage: page(refund), CustodyReceipt: custody, IncidentMessagePage: page(message), ReviewEligibility: { orderId: order.id, eligible: true },
  ErrorEnvelope: { code: "VERSION_CONFLICT", message: "Synthetic stale version", retryable: true, traceId: id(58), currentVersion: 2 },
} satisfies Record<v2.WireSchemaName, unknown>;
export type V2WireSchemaName = v2.WireSchemaName;
export type V2EventType = v2.EventType;

export const v2OperationFixtures = Object.fromEntries(v2.ROUTE_REGISTRY.map(route => [route.id, {
  label: V2_FIXTURE_LABEL,
  request: route.requestSchema ? v2WireFixtures[route.requestSchema as v2.WireSchemaName] : undefined,
  response: v2WireFixtures[route.responseSchema as v2.WireSchemaName],
}]));

const envelope = { schemaVersion: 2 as const, aggregateVersion: 1, occurredAt: at, traceId: id(58) };
export const v2EventFixtures = {
  "order.confirmed.v2": { ...envelope, eventId: id(60), eventType: "order.confirmed.v2", aggregateId: order.id, payload: { order, quote } },
  "order.intake-recorded.v2": { ...envelope, eventId: id(61), eventType: "order.intake-recorded.v2", aggregateId: order.id, payload: { orderId: order.id, custodyReceipt: custody, measuredAt: at } },
  "order.adjustment-decided.v2": { ...envelope, eventId: id(62), eventType: "order.adjustment-decided.v2", aggregateId: order.id, payload: { orderId: order.id, adjustment, decision: adjustmentDecision } },
  "order.ready-for-return.v2": { ...envelope, eventId: id(63), eventType: "order.ready-for-return.v2", aggregateId: order.id, payload: { orderId: order.id, readyAt: at, obligation } },
  "order.delivered.v2": { ...envelope, eventId: id(64), eventType: "order.delivered.v2", aggregateId: order.id, payload: { orderId: order.id, deliveredAt: at, legAttempt: leg } },
  "payment.settled.v2": { ...envelope, eventId: id(65), eventType: "payment.settled.v2", aggregateId: obligation.id, payload: { obligation: { ...obligation, status: "SETTLED", amountSettledMinor: 23000 }, receipt } },
  "refund.updated.v2": { ...envelope, eventId: id(66), eventType: "refund.updated.v2", aggregateId: refund.id, payload: { refund } },
  "delivery.updated.v2": { ...envelope, eventId: id(67), eventType: "delivery.updated.v2", aggregateId: leg.id, payload: { legAttempt: leg } },
  "media.uploaded.v2": { ...envelope, eventId: id(68), eventType: "media.uploaded.v2", aggregateId: media.id, payload: { media } },
  "conversation.draft-confirmed.v2": { ...envelope, eventId: id(69), eventType: "conversation.draft-confirmed.v2", aggregateId: draft.draftId, payload: { confirmation, confirmedAt: at } },
} satisfies Record<v2.EventType, v2.DomainEvent>;
