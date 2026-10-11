import { z } from "zod";

export const idSchema = z.string().uuid();
export const instantSchema = z.string().datetime();
export const currencySchema = z.literal("INR");

export const moneySchema = z.object({
  amountMinor: z.number().int().min(0),
  currency: currencySchema,
});

export const windowSchema = z
  .object({
    start: instantSchema,
    end: instantSchema,
    timezone: z.string().min(1),
  })
  .refine((w) => Date.parse(w.end) > Date.parse(w.start), {
    message: "window end must be after start",
  });

export const serviceCodeSchema = z.enum(["WASH_FOLD", "WASH_PRESS", "PRESS_ONLY", "DRY_CLEAN"]);

export const garmentPriceSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  priceMinor: z.number().int().min(0),
});

export const serviceSchema = z.object({
  id: idSchema,
  code: serviceCodeSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  imageUrl: z.string().url(),
  priceMinor: z.number().int().min(0),
  priceUnit: z.string().min(1),
  turnaroundHours: z.number().int().positive(),
  garments: z.array(garmentPriceSchema).min(1),
  features: z.array(z.string()),
});

export const requestedLineSchema = z.object({
  serviceId: idSchema,
  garmentTypeId: idSchema,
  quantity: z.number().int().min(1).max(100),
  estimatedWeightGrams: z.number().int().min(1).max(50000).optional(),
  careNotes: z.string().max(500).optional(),
});

export const quoteInputSchema = z.object({
  addressId: idSchema,
  lines: z.array(requestedLineSchema).min(1).max(20),
  pickupWindow: windowSchema,
  requestedReturnBy: instantSchema,
  timezone: z.string().min(1),
});

export const priceLineSchema = z.object({
  label: z.string().min(1),
  amountMinor: z.number().int(),
});

export const quoteLineSchema = requestedLineSchema.extend({
  unitPriceMinor: z.number().int().min(0),
  lineTotalMinor: z.number().int().min(0),
});

export const quoteSchema = z.object({
  id: idSchema,
  version: z.number().int().min(1),
  expiresAt: instantSchema,
  rateCardId: idSchema.optional(),
  rateCardVersion: z.number().int().min(1).optional(),
  lines: z.array(quoteLineSchema).min(1),
  totalMinor: z.number().int().min(0),
  currency: currencySchema,
  provisional: z.boolean(),
  pickupWindow: windowSchema,
  promisedReturnWindow: windowSchema,
  breakdown: z.array(priceLineSchema).min(1),
});

export const checkoutSchema = z.object({
  orderId: idSchema,
  paymentId: idSchema,
  paymentUrl: z.string().url(),
  expiresAt: instantSchema,
  status: z.enum(["AWAITING_PAYMENT", "RESOLUTION_REQUIRED"]),
});

export const orderStatusSchema = z.enum([
  "AWAITING_PAYMENT",
  "CONFIRMED",
  "PICKUP_PENDING",
  "AT_FACILITY",
  "IN_CARE",
  "QUALITY_CHECK",
  "READY_FOR_RETURN",
  "RETURNING",
  "DELIVERED",
  "AWAITING_ADJUSTMENT",
  "ON_HOLD",
  "RESOLUTION_REQUIRED",
  "CANCEL_REQUESTED",
  "CANCELLED",
]);

export const deliveryStatusSchema = z.enum([
  "REQUESTED",
  "BOOKING_UNKNOWN",
  "BOOKED",
  "ASSIGNED",
  "AT_PICKUP",
  "IN_TRANSIT",
  "COMPLETED",
  "FAILED",
  "CANCEL_REQUESTED",
  "CANCELLED",
]);

export const deliveryJobSchema = z.object({
  id: idSchema,
  orderId: idSchema,
  leg: z.enum(["PICKUP", "RETURN"]),
  status: deliveryStatusSchema,
  version: z.number().int().min(1),
  customerName: z.string().min(1),
  address: z.string().min(1),
  window: windowSchema,
  bagIds: z.array(z.string().min(1)),
  provider: z.string().min(1),
  dispatchMode: z.enum(["PROVIDER", "MANUAL"]),
  capabilities: z.array(z.string()),
  assignedTo: idSchema.optional(),
});

export const timelineEventSchema = z.object({
  status: orderStatusSchema,
  label: z.string().min(1),
  at: instantSchema,
});

export const orderSchema = z.object({
  id: idSchema,
  version: z.number().int().min(1),
  status: orderStatusSchema,
  customerId: idSchema,
  facilityId: idSchema.optional(),
  lines: z.array(
    quoteLineSchema.extend({ orderLineId: idSchema })
  ),
  totalMinor: z.number().int().min(0),
  currency: currencySchema,
  pickupWindow: windowSchema,
  promisedReturnWindow: windowSchema,
  createdAt: instantSchema,
  timeline: z.array(timelineEventSchema),
  paymentStatus: z.enum(["CREATED", "PENDING", "CAPTURED", "FAILED", "EXPIRED"]),
  adjustment: z
    .object({ id: idSchema, status: z.string(), deltaMinor: z.number().int(), reason: z.string() })
    .optional(),
  deliveries: z.array(deliveryJobSchema),
});

export const handoverInputSchema = z.object({
  jobId: idSchema,
  actionId: idSchema,
  bagIds: z.array(z.string().min(1)).min(1),
  method: z.enum(["OTP", "PROVIDER_PROOF", "OPERATOR_EXCEPTION"]),
  proofReference: z.string().optional(),
  otp: z.string().optional(),
  capturedAt: instantSchema,
});

export const addressSchema = z.object({
  id: idSchema,
  version: z.number().int().min(1),
  ownerId: idSchema,
  label: z.string().min(1),
  line1: z.string().min(1),
  city: z.string().min(1),
  postalCode: z.string().min(1),
});

export const otpRequestSchema = z.object({ phone: z.string().min(6).max(20) });
export const otpVerifySchema = z.object({ challengeId: idSchema, code: z.string().min(4).max(10) });
export const demoAuthSchema = z.object({ role: z.enum(["customer", "rider", "operator"]) });

export const sessionSchema = z.object({
  token: z.string().min(1),
  user: z.object({
    id: idSchema,
    role: z.string().min(1),
    name: z.string().min(1),
    phone: z.string().min(1),
  }),
});

export const errorEnvelopeSchema = z.object({
  code: z.enum([
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "NOT_FOUND",
    "INVALID_INPUT",
    "OUT_OF_AREA",
    "NO_CAPACITY",
    "DEADLINE_UNAVAILABLE",
    "QUOTE_EXPIRED",
    "VERSION_CONFLICT",
    "IDEMPOTENCY_CONFLICT",
    "PAYMENT_PENDING",
    "PROVIDER_UNAVAILABLE",
    "PROVIDER_OUTCOME_UNKNOWN",
    "REQUIRES_APPROVAL",
    "RATE_LIMITED",
  ]),
  message: z.string().min(1),
  traceId: z.string().min(1),
  retryable: z.boolean(),
  fieldErrors: z.record(z.string()).optional(),
});

export const reviewInputSchema = z.object({
  orderId: idSchema,
  overall: z.number().int().min(1).max(5),
  serviceScore: z.number().int().min(1).max(5).optional(),
  deliveryScore: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(2000).optional(),
  mediaIds: z.array(idSchema).optional().default([]),
  publishConsent: z.boolean(),
});

export const cancelOrderSchema = z.object({
  reason: z.string().min(1).max(500),
  expectedVersion: z.number().int().min(1),
});

export const conversationMessageSchema = z.object({
  text: z.string().min(1).max(4000),
  receivedAt: instantSchema.optional(),
  draftId: idSchema.optional(),
});

export const draftConfirmSchema = z.object({
  draftId: idSchema,
  revision: z.number().int().min(1),
  quoteId: idSchema,
});
