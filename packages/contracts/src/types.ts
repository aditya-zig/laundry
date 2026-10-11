// Shared domain types for the /v1 wire contract. Money is integer minor
// units. Instants are ISO-8601 UTC strings. Direct resource/list shapes on
// success; { code, message, traceId, retryable } on errors.

export type Id = string;
export type Instant = string;

export type Currency = "INR";
export interface Money {
  amountMinor: number;
  currency: Currency;
}

export interface Window {
  start: Instant;
  end: Instant;
  timezone: string;
}

export type Role = "customer" | "rider" | "facility" | "operator" | "admin" | "system";
export interface Actor {
  id: Id;
  role: Role;
  scopes: string[];
}

export type ServiceCode = "WASH_FOLD" | "WASH_PRESS" | "PRESS_ONLY" | "DRY_CLEAN";

export interface GarmentPrice {
  id: Id;
  name: string;
  priceMinor: number;
}

export interface Service {
  id: Id;
  code: ServiceCode;
  name: string;
  description: string;
  imageUrl: string;
  priceMinor: number;
  priceUnit: string;
  turnaroundHours: number;
  garments: GarmentPrice[];
  features: string[];
}

export interface RequestedLine {
  serviceId: Id;
  garmentTypeId: Id;
  quantity: number;
  estimatedWeightGrams?: number;
  careNotes?: string;
}

export interface QuoteInput {
  addressId: Id;
  lines: RequestedLine[];
  pickupWindow: Window;
  requestedReturnBy: Instant;
  timezone: string;
}

export interface PriceLine {
  label: string;
  amountMinor: number;
}

export interface QuoteLine extends RequestedLine {
  unitPriceMinor: number;
  lineTotalMinor: number;
}

export interface Quote {
  id: Id;
  version: number;
  expiresAt: Instant;
  rateCardId?: Id;
  rateCardVersion?: number;
  lines: QuoteLine[];
  totalMinor: number;
  currency: Currency;
  provisional: boolean;
  pickupWindow: Window;
  promisedReturnWindow: Window;
  breakdown: PriceLine[];
}

export type CheckoutStatus = "AWAITING_PAYMENT" | "RESOLUTION_REQUIRED";
export interface Checkout {
  orderId: Id;
  paymentId: Id;
  paymentUrl: string;
  expiresAt: Instant;
  status: CheckoutStatus;
}

export type OrderStatus =
  | "AWAITING_PAYMENT"
  | "CONFIRMED"
  | "PICKUP_PENDING"
  | "AT_FACILITY"
  | "IN_CARE"
  | "QUALITY_CHECK"
  | "READY_FOR_RETURN"
  | "RETURNING"
  | "DELIVERED"
  | "AWAITING_ADJUSTMENT"
  | "ON_HOLD"
  | "RESOLUTION_REQUIRED"
  | "CANCEL_REQUESTED"
  | "CANCELLED";

export type PaymentStatus = "CREATED" | "PENDING" | "CAPTURED" | "FAILED" | "EXPIRED";

export interface TimelineEvent {
  status: OrderStatus;
  label: string;
  at: Instant;
}

export interface OrderLine extends QuoteLine {
  orderLineId: Id;
}

export interface Order {
  id: Id;
  version: number;
  status: OrderStatus;
  customerId: Id;
  facilityId?: Id;
  lines: OrderLine[];
  totalMinor: number;
  currency: Currency;
  pickupWindow: Window;
  promisedReturnWindow: Window;
  createdAt: Instant;
  timeline: TimelineEvent[];
  paymentStatus: PaymentStatus;
  adjustment?: { id: Id; status: string; deltaMinor: number; reason: string };
  deliveries: DeliveryJob[];
}

export type DeliveryLeg = "PICKUP" | "RETURN";
export type DeliveryStatus =
  | "REQUESTED"
  | "BOOKING_UNKNOWN"
  | "BOOKED"
  | "ASSIGNED"
  | "AT_PICKUP"
  | "IN_TRANSIT"
  | "COMPLETED"
  | "FAILED"
  | "CANCEL_REQUESTED"
  | "CANCELLED";

export interface DeliveryJob {
  id: Id;
  orderId: Id;
  leg: DeliveryLeg;
  status: DeliveryStatus;
  version: number;
  customerName: string;
  address: string;
  window: Window;
  bagIds: string[];
  provider: string;
  dispatchMode: "PROVIDER" | "MANUAL";
  capabilities: string[];
  assignedTo?: Id;
}

export interface HandoverInput {
  jobId: Id;
  actionId: Id;
  bagIds: string[];
  method: "OTP" | "PROVIDER_PROOF" | "OPERATOR_EXCEPTION";
  proofReference?: string;
  otp?: string;
  capturedAt: Instant;
}

export interface Address {
  id: Id;
  version: number;
  ownerId: Id;
  label: string;
  line1: string;
  city: string;
  postalCode: string;
}

export interface SessionUser {
  id: Id;
  role: string;
  name: string;
  phone: string;
}
export interface Session {
  token: string;
  user: SessionUser;
}

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "OUT_OF_AREA"
  | "NO_CAPACITY"
  | "DEADLINE_UNAVAILABLE"
  | "QUOTE_EXPIRED"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "PAYMENT_PENDING"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_OUTCOME_UNKNOWN"
  | "REQUIRES_APPROVAL"
  | "RATE_LIMITED";

export interface ErrorEnvelope {
  code: ErrorCode;
  message: string;
  traceId: string;
  retryable: boolean;
  fieldErrors?: Record<string, string>;
}

export interface ReviewInput {
  orderId: Id;
  overall: number;
  serviceScore?: number;
  deliveryScore?: number;
  comment?: string;
  mediaIds?: Id[];
  publishConsent: boolean;
}

export interface Review extends ReviewInput {
  id: Id;
  version: number;
  createdAt: Instant;
}

export interface ConversationDraft {
  draftId: Id;
  revision: number;
  state: "COLLECTING" | "QUOTED" | "CONFIRMED" | "CHECKOUT_CREATED" | "EXPIRED" | "HUMAN_HANDOFF";
  quoteId?: Id;
  expiresAt: Instant;
  missingFields: string[];
}

export interface ConversationMessageResult {
  draft: ConversationDraft;
  reply: string;
  missingFields: string[];
}

export interface CommandMeta {
  idempotencyKey: string;
  expectedVersion?: number;
  traceId: string;
}
