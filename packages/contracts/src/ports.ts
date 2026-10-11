import type {
  Actor,
  CommandMeta,
  DeliveryJob,
  HandoverInput,
  Id,
  Quote,
  QuoteInput,
  Review,
  ReviewInput,
  Checkout,
} from "./types.js";

export interface ServiceView {
  id: Id;
  code: string;
  title: string;
  description: string;
}

export interface RateCard {
  id: Id;
  version: number;
  currency: "INR";
}

export interface OrderView {
  id: Id;
  version: number;
  status: string;
  customerId: Id;
  facilityId?: Id;
}

export interface PaymentEvent {
  paymentId: Id;
  orderId: Id;
  quoteId: Id;
  purpose: "INITIAL" | "TOP_UP";
  amountMinor: number;
}

export interface DeliveryEvent {
  jobId: Id;
  orderId: Id;
  status: string;
  providerOccurredAt: string;
}

export interface PaymentSession {
  paymentId: Id;
  paymentUrl: string;
  expiresAt: string;
}

export interface PaymentView {
  paymentId: Id;
  status: string;
}

export interface RefundView {
  refundId: Id;
  status: string;
}

export interface CatalogPort {
  listServices(areaId: Id): Promise<ServiceView[]>;
  getRateCard(areaId: Id): Promise<RateCard>;
  submitReview(actor: Actor, input: ReviewInput, meta: CommandMeta): Promise<Review>;
}

export interface OrdersPort {
  createQuote(actor: Actor, input: QuoteInput, meta: CommandMeta): Promise<Quote>;
  createCheckout(actor: Actor, quoteId: Id, meta: CommandMeta): Promise<Checkout>;
  getOrder(actor: Actor, orderId: Id): Promise<OrderView>;
  applyPayment(event: PaymentEvent, meta: CommandMeta): Promise<void>;
  applyDelivery(event: DeliveryEvent, meta: CommandMeta): Promise<void>;
  recordIntake(
    actor: Actor,
    input: { orderId: Id; bagIds: Id[]; measuredLines: unknown[] },
    meta: CommandMeta
  ): Promise<OrderView>;
  decideAdjustment(
    actor: Actor,
    input: { orderId: Id; adjustmentId: Id; decision: "ACCEPT" | "DECLINE" },
    meta: CommandMeta
  ): Promise<OrderView>;
  advanceCare(
    actor: Actor,
    input: { orderId: Id; to: "IN_CARE" | "QUALITY_CHECK" | "READY_FOR_RETURN"; reason?: string },
    meta: CommandMeta
  ): Promise<OrderView>;
  cancelOrder(actor: Actor, orderId: Id, reason: string, meta: CommandMeta): Promise<OrderView>;
  rescheduleOrder(actor: Actor, input: { orderId: Id; newQuoteId: Id }, meta: CommandMeta): Promise<OrderView>;
}

export interface BillingPort {
  createPayment(
    input: { orderId: Id; quoteId: Id; purpose: "INITIAL" | "TOP_UP"; amountMinor: number; customerId: Id },
    meta: CommandMeta
  ): Promise<PaymentSession>;
  getPayment(actor: Actor, paymentId: Id): Promise<PaymentView>;
  requestRefund(
    input: { orderId: Id; paymentId: Id; amountMinor: number; reason: string; obligationId: Id },
    meta: CommandMeta
  ): Promise<RefundView>;
}

export interface LogisticsPort {
  quoteLeg(input: { orderId: Id; leg: "PICKUP" | "RETURN" }): Promise<{ providerId: string; priceMinor: number }>;
  bookLeg(
    input: { orderId: Id; leg: "PICKUP" | "RETURN"; providerQuoteId: Id; dispatchMode: "PROVIDER" | "MANUAL" },
    meta: CommandMeta
  ): Promise<DeliveryJob>;
  cancelLeg(jobId: Id, reason: string, meta: CommandMeta): Promise<DeliveryJob>;
  getJob(actor: Actor, jobId: Id): Promise<DeliveryJob>;
  recordHandover(actor: Actor, input: HandoverInput, meta: CommandMeta): Promise<DeliveryJob>;
}

export interface SpeechPort {
  transcribe(input: { privateMediaId: Id; languageHints: string[]; traceId: string }): Promise<{
    text: string;
    detectedLanguage?: string;
    uncertainSpans: string[];
  }>;
}

export interface ConversationPort {
  receive(input: {
    providerMessageId: string;
    senderRef: string;
    receivedAt: string;
    text?: string;
    privateMediaId?: Id;
  }): Promise<{ accepted: boolean }>;
  confirmDraft(actor: Actor, input: { draftId: Id; revision: number; quoteId: Id }, meta: CommandMeta): Promise<Checkout>;
}
