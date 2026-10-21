import type { Actor } from "./common.js";
import type {
  QuoteInput,
  Quote,
  BookingInput,
  Order,
  MeasuredLine,
  AdjustmentDecision,
} from "./orders.js";
import type {
  Obligation,
  PaymentAttempt,
  Receipt,
  Refund,
  Reconciliation,
} from "./billing.js";
import type {
  LegAttempt,
  Assignment,
  HandoverProof,
  HandoverResult,
  LocationReport,
} from "./logistics.js";
import type {
  MediaReference,
  UploadIntent,
  UploadIntentResult,
  MediaDownload,
} from "./media.js";
import type {
  Incident,
  IncidentMessage,
  IncidentResolution,
  RewashRequest,
} from "./support.js";
import type {
  Review,
  PublicReview,
  ReviewModeration,
  ReviewEligibility,
} from "./reviews.js";
import type {
  ConversationDraft,
  InboundMessage,
  DraftConfirmation,
  ConversationReply,
} from "./conversations.js";
import type { Service, RateCard, ServiceArea } from "./catalog.js";
import type { Page, PageQuery, Id, ScheduleWindow, Instant } from "./common.js";

export interface CommandMeta {
  idempotencyKey: string;
  expectedVersion?: number;
  traceId: Id;
  requestedAt: Instant;
  actor: Actor;
}

export interface PortResult<T> {
  ok: boolean;
  value?: T;
  reason?: string;
}

export interface IdentityPort {
  requestOtp(meta: CommandMeta, input: { phone: string }): Promise<PortResult<{ challengeId: Id }>>;
  verifyOtp(meta: CommandMeta, input: { challengeId: Id; code: string }): Promise<PortResult<{ sessionId: Id }>>;
  refreshSession(meta: CommandMeta, input: { sessionId: Id }): Promise<PortResult<{ sessionId: Id }>>;
  logout(meta: CommandMeta, input: { sessionId: Id }): Promise<PortResult<{ revoked: boolean }>>;
  revokeSession(meta: CommandMeta, input: { sessionId: Id }): Promise<PortResult<{ revoked: boolean }>>;
  getMe(meta: CommandMeta): Promise<PortResult<{ actor: Actor }>>;
  inviteStaff(meta: CommandMeta, input: { phone: string; roles: string[] }): Promise<PortResult<{ invitationId: Id }>>;
  configureStaffMfa(meta: CommandMeta, input: { staffId: Id }): Promise<PortResult<{ configured: boolean }>>;
}

export interface PricingPort {
  /*
   * The caller supplies requested services and quantities, never prices.
   * The pricing implementation derives every amount from the active rate card.
   */
  priceBasket(meta: CommandMeta, input: { lines: QuoteInput["lines"]; rateCardId?: Id }): Promise<PortResult<Quote>>;
  getService(meta: CommandMeta, input: { serviceId: Id }): Promise<PortResult<Service>>;
  getRateCard(meta: CommandMeta, input: { rateCardId: Id }): Promise<PortResult<RateCard>>;
  createRateCard(meta: CommandMeta, input: { rateCard: RateCard }): Promise<PortResult<RateCard>>;
  approveRateCard(meta: CommandMeta, input: { rateCardId: Id }): Promise<PortResult<RateCard>>;
  activateRateCard(meta: CommandMeta, input: { rateCardId: Id }): Promise<PortResult<RateCard>>;
}

export interface AvailabilityPort {
  hold(meta: CommandMeta, input: { areaId: Id; window: ScheduleWindow }): Promise<PortResult<{ holdId: Id; expiresAt: Instant }>>;
  reserve(meta: CommandMeta, input: { holdId: Id; orderId: Id }): Promise<PortResult<{ reservationId: Id }>>;
  release(meta: CommandMeta, input: { reservationId: Id; reason: string }): Promise<PortResult<{ released: boolean }>>;
  listSlots(meta: CommandMeta, input: { areaId: Id; from: Instant; to: Instant }): Promise<PortResult<Array<{ window: ScheduleWindow; available: boolean }>>>;
  checkArea(meta: CommandMeta, input: { postalCode: string }): Promise<PortResult<ServiceArea>>;
  setCapacity(meta: CommandMeta, input: { areaId: Id; window: ScheduleWindow; capacity: number }): Promise<PortResult<{ updated: boolean }>>;
}

export interface OrdersPort {
  quote(meta: CommandMeta, input: QuoteInput): Promise<PortResult<Quote>>;
  book(meta: CommandMeta, input: BookingInput): Promise<PortResult<Order>>;
  recordIntake(meta: CommandMeta, input: { orderId: Id; lines: MeasuredLine[] }): Promise<PortResult<Order>>;
  decideAdjustment(meta: CommandMeta, input: { orderId: Id; decision: AdjustmentDecision }): Promise<PortResult<Order>>;
  cancel(meta: CommandMeta, input: { orderId: Id; reason: string }): Promise<PortResult<Order>>;
  reschedule(meta: CommandMeta, input: { orderId: Id; window: ScheduleWindow }): Promise<PortResult<Order>>;
  getOrder(meta: CommandMeta, input: { orderId: Id }): Promise<PortResult<Order>>;
  listOrders(meta: CommandMeta, input: PageQuery): Promise<PortResult<Page<Order>>>;
}

export interface BillingPort {
  createObligation(meta: CommandMeta, input: { orderId: Id; amountDueMinor: number }): Promise<PortResult<Obligation>>;
  recordAttempt(meta: CommandMeta, input: { obligationId: Id; attempt: PaymentAttempt }): Promise<PortResult<PaymentAttempt>>;
  confirmManualPayment(meta: CommandMeta, input: { obligationId: Id; receipt: Receipt }): Promise<PortResult<Receipt>>;
  refund(meta: CommandMeta, input: { orderId: Id; paymentId: Id; amountMinor: number; reason: string }): Promise<PortResult<Refund>>;
  reconcile(meta: CommandMeta, input: { periodStart: Instant; periodEnd: Instant }): Promise<PortResult<Reconciliation>>;
}

export interface LogisticsPort {
  assign(meta: CommandMeta, input: { legAttemptId: Id; riderId: Id }): Promise<PortResult<Assignment>>;
  reassign(meta: CommandMeta, input: { legAttemptId: Id; riderId: Id; reason: string }): Promise<PortResult<Assignment>>;
  recordHandover(meta: CommandMeta, input: HandoverProof): Promise<PortResult<HandoverResult>>;
  reportException(meta: CommandMeta, input: { legAttemptId: Id; reason: string }): Promise<PortResult<LegAttempt>>;
  reportLocation(meta: CommandMeta, input: LocationReport): Promise<PortResult<{ recorded: boolean }>>;
}

export interface MediaPort {
  createUploadIntent(meta: CommandMeta, input: UploadIntent): Promise<PortResult<UploadIntentResult>>;
  finalizeUpload(meta: CommandMeta, input: { uploadId: Id }): Promise<PortResult<MediaReference>>;
  download(meta: CommandMeta, input: { mediaId: Id }): Promise<PortResult<MediaDownload>>;
  delete(meta: CommandMeta, input: { mediaId: Id; reason: string }): Promise<PortResult<{ deleted: boolean }>>;
}

export interface SupportPort {
  createIncident(meta: CommandMeta, input: { orderId: Id; summary: string; category: Incident["category"]; mediaIds: Id[] }): Promise<PortResult<Incident>>;
  addMessage(meta: CommandMeta, input: { incidentId: Id; body: string; mediaIds: Id[] }): Promise<PortResult<IncidentMessage>>;
  resolveIncident(meta: CommandMeta, input: { incidentId: Id; resolution: IncidentResolution }): Promise<PortResult<Incident>>;
  requestRewash(meta: CommandMeta, input: { incidentId: Id; reason: string }): Promise<PortResult<RewashRequest>>;
  updateRewash(meta: CommandMeta, input: { rewashRequestId: Id; status: RewashRequest["status"] }): Promise<PortResult<RewashRequest>>;
}

export interface ReviewsPort {
  checkEligibility(meta: CommandMeta, input: { orderId: Id }): Promise<PortResult<ReviewEligibility>>;
  createReview(meta: CommandMeta, input: Omit<Review, "id" | "createdAt" | "updatedAt" | "version" | "publication">): Promise<PortResult<Review>>;
  moderate(meta: CommandMeta, input: ReviewModeration): Promise<PortResult<Review>>;
  listPublicReviews(meta: CommandMeta, input: PageQuery): Promise<PortResult<Page<PublicReview>>>;
}

export interface ConversationsPort {
  receive(meta: CommandMeta, input: InboundMessage): Promise<PortResult<ConversationReply>>;
  editDraft(meta: CommandMeta, input: { draftId: Id; expectedRevision: number; fields: ConversationDraft["fields"] }): Promise<PortResult<ConversationDraft>>;
  confirmDraft(meta: CommandMeta, input: DraftConfirmation): Promise<PortResult<Order>>;
  optOut(meta: CommandMeta, input: { phone: string }): Promise<PortResult<{ optedOut: boolean }>>;
  handoff(meta: CommandMeta, input: { draftId: Id; assignedTo: Id; reason: string }): Promise<PortResult<ConversationDraft>>;
}

export interface SpeechPort {
  transcribe(meta: CommandMeta, input: { mediaId: Id; language?: string }): Promise<PortResult<{ text: string; confidence?: number }>>;
}

export interface NotificationTransport {
  send(meta: CommandMeta, input: { recipientId: Id; channel: "SMS" | "WHATSAPP" | "PUSH" | "EMAIL"; template: string; variables: Record<string, string> }): Promise<PortResult<{ messageId: Id }>>;
}

export interface JobRecord {
  id: Id;
  kind: string;
  payload: Record<string, unknown>;
  status: "QUEUED" | "CLAIMED" | "COMPLETED" | "FAILED" | "DEAD_LETTER";
  attempts: number;
}

export interface JobsPort {
  enqueue(meta: CommandMeta, input: { kind: string; payload: Record<string, unknown>; runAt?: Instant }): Promise<PortResult<JobRecord>>;
  claim(meta: CommandMeta, input: { workerId: Id; limit: number }): Promise<PortResult<JobRecord[]>>;
  complete(meta: CommandMeta, input: { jobId: Id; result?: Record<string, unknown> }): Promise<PortResult<JobRecord>>;
  fail(meta: CommandMeta, input: { jobId: Id; reason: string; retryable: boolean }): Promise<PortResult<JobRecord>>;
  deadLetter(meta: CommandMeta, input: { jobId: Id; reason: string }): Promise<PortResult<JobRecord>>;
  replay(meta: CommandMeta, input: { jobId: Id }): Promise<PortResult<JobRecord>>;
}

/*
 * Transaction participation rules:
 * OrdersPort.book joins the caller transaction with the availability reservation
 * and obligation creation when they share the same transactional store.
 * OrdersPort.recordIntake and decideAdjustment join the order and adjustment
 * transaction; downstream billing changes run after commit.
 * Availability hold and release join the caller transaction when supported.
 * Payment provider calls, notifications, speech processing, media uploads,
 * logistics provider booking, and background jobs run after commit.
 * Event consumers use idempotent commands and never share the original transaction.
 */
