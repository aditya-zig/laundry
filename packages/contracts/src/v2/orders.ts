import { z } from "zod";
import {
  actorRoleSchema,
  billingUnitSchema,
  currencySchema,
  expectedVersionSchema,
  idSchema,
  instantSchema,
  ianaTimezoneSchema,
  moneySchema,
  windowSchema,
} from "./common.js";

const nonNegativeIntegerSchema = z.number().int().nonnegative();

const requestedLineBaseSchema = z.object({
  serviceId: idSchema,
  billingUnit: billingUnitSchema,
  garmentTypeId: idSchema.optional(),
  estimatedWeightGrams: z.number().int().positive().optional(),
  pieceQuantity: z.number().int().positive().optional(),
  declaredGarmentCount: nonNegativeIntegerSchema.optional(),
  careNotes: z.string().max(2000).optional(),
});

export const requestedLineSchema = requestedLineBaseSchema.superRefine(
  (line, context) => {
    if (line.billingUnit === "KG") {
      if (line.estimatedWeightGrams === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["estimatedWeightGrams"],
          message: "KG lines require estimatedWeightGrams",
        });
      }
      if (line.pieceQuantity !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pieceQuantity"],
          message: "KG lines cannot declare pieceQuantity",
        });
      }
      if (line.garmentTypeId !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["garmentTypeId"],
          message: "KG lines cannot declare garmentTypeId",
        });
      }
    } else {
      if (line.pieceQuantity === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pieceQuantity"],
          message: "PIECE lines require pieceQuantity",
        });
      }
      if (line.garmentTypeId === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["garmentTypeId"],
          message: "PIECE lines require garmentTypeId",
        });
      }
      if (line.estimatedWeightGrams !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["estimatedWeightGrams"],
          message: "PIECE lines cannot declare estimatedWeightGrams",
        });
      }
    }
  },
);
export type RequestedLine = z.infer<typeof requestedLineSchema>;

export function isMixedUnitBasket(
  lines: ReadonlyArray<{ billingUnit: "KG" | "PIECE" }>,
): boolean {
  return new Set(lines.map((line) => line.billingUnit)).size > 1;
}

export const quoteInputSchema = z.object({
  addressId: idSchema,
  lines: z.array(requestedLineSchema).min(1).max(20),
  pickupWindow: windowSchema,
  requestedReturnBy: instantSchema,
  timezone: ianaTimezoneSchema,
});
export type QuoteInput = z.infer<typeof quoteInputSchema>;

export const quoteLineSchema = requestedLineSchema
  .innerType()
  .extend({
    unitPriceMinor: moneySchema,
    lineTotalMinor: moneySchema,
    rateCardId: idSchema.optional(),
    rateCardVersion: z.number().int().min(1).optional(),
    provisional: z.boolean(),
  })
  .superRefine((line, context) => {
    if (line.billingUnit === "KG") {
      if (
        line.estimatedWeightGrams === undefined ||
        line.pieceQuantity !== undefined ||
        line.garmentTypeId !== undefined
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid KG quote line",
        });
      }
    } else if (
      line.pieceQuantity === undefined ||
      line.garmentTypeId === undefined ||
      line.estimatedWeightGrams !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid PIECE quote line",
      });
    }
  });
export type QuoteLine = z.infer<typeof quoteLineSchema>;

export const quoteComponentSchema = z.object({
  label: z.string().min(1),
  kind: z.enum([
    "BASE",
    "PER_KG",
    "PER_PIECE",
    "INCREMENT",
    "MINIMUM",
    "TAX",
    "FEE",
  ]),
  amountMinor: z.number().int(),
});
export type QuoteComponent = z.infer<typeof quoteComponentSchema>;

export const quoteSchema = z.object({
  id: idSchema,
  version: z.number().int().min(1),
  lines: z.array(quoteLineSchema).min(1).max(20),
  totalMinor: moneySchema,
  currency: currencySchema,
  provisional: z.boolean(),
  expiresAt: instantSchema,
  addressSnapshotId: idSchema,
  pickupWindow: windowSchema,
  promisedReturnWindow: windowSchema,
  holdReference: idSchema.optional(),
  holdExpiresAt: instantSchema.optional(),
  catalogVersion: z.number().int().min(1),
  breakdown: z.array(quoteComponentSchema),
});
export type Quote = z.infer<typeof quoteSchema>;

export const bookingInputSchema = z.object({
  quoteId: idSchema,
  expectedVersion: expectedVersionSchema.optional(),
  paymentModel: z.enum(["DUE_AT_RETURN", "PREPAID_V1"]),
});
export type BookingInput = z.infer<typeof bookingInputSchema>;

export const orderStatusSchema = z.enum([
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
  "CANCEL_REQUESTED",
  "CANCELLED",
  "RESOLUTION_REQUIRED",
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const orderActionSchema = z.enum([
  "ACCEPT_ADJUSTMENT",
  "DECLINE_ADJUSTMENT",
  "REQUEST_CANCEL",
  "CONFIRM_DELIVERY",
  "APPROVE_RECEIPT",
]);
export type OrderAction = z.infer<typeof orderActionSchema>;

export const custodyConditionSchema = z.enum([
  "GOOD",
  "DAMAGED",
  "STAINTED",
  "MISSING",
]);
export type CustodyCondition = z.infer<typeof custodyConditionSchema>;

export const measuredLineSchema = z.object({
  orderLineId: idSchema,
  countedQuantity: nonNegativeIntegerSchema.optional(),
  measuredWeightGrams: nonNegativeIntegerSchema.optional(),
  measuredPieceQuantity: nonNegativeIntegerSchema.optional(),
  condition: custodyConditionSchema,
  note: z.string().max(2000).optional(),
});
export type MeasuredLine = z.infer<typeof measuredLineSchema>;

export const containerSchema = z.object({
  id: idSchema,
  sealId: z.string().min(1).optional(),
  sealed: z.boolean(),
  condition: custodyConditionSchema,
  garmentCount: nonNegativeIntegerSchema,
  weightGrams: nonNegativeIntegerSchema.optional(),
});
export type Container = z.infer<typeof containerSchema>;

export const adjustmentSchema = z.object({
  id: idSchema,
  version: z.number().int().min(1),
  reason: z.string().min(1),
  previousTotalMinor: moneySchema,
  newTotalMinor: moneySchema,
  deltaMinor: z.number().int(),
  state: z.enum([
    "PROPOSED",
    "ACCEPTED",
    "DECLINED",
    "EXPIRED",
    "ESCALATED",
  ]),
  expiresAt: instantSchema,
  decidedAt: instantSchema.optional(),
});
export type Adjustment = z.infer<typeof adjustmentSchema>;

export const adjustmentDecisionSchema = z.object({
  adjustmentId: idSchema,
  adjustmentVersion: expectedVersionSchema,
  decision: z.enum(["ACCEPT", "DECLINE"]),
});
export type AdjustmentDecision = z.infer<
  typeof adjustmentDecisionSchema
>;

export const orderLineSchema = quoteLineSchema
  .innerType()
  .extend({
    orderLineId: idSchema,
    declaredGarmentCount: nonNegativeIntegerSchema.optional(),
    measured: measuredLineSchema.optional(),
  })
  .superRefine((line, context) => {
    if (line.billingUnit === "KG") {
      if (
        line.estimatedWeightGrams === undefined ||
        line.pieceQuantity !== undefined ||
        line.garmentTypeId !== undefined
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid KG order line",
        });
      }
    } else if (
      line.pieceQuantity === undefined ||
      line.garmentTypeId === undefined ||
      line.estimatedWeightGrams !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid PIECE order line",
      });
    }
  });
export type OrderLine = z.infer<typeof orderLineSchema>;

export const deliveryLegSummarySchema = z.object({
  leg: z.enum(["PICKUP", "RETURN"]),
  status: z.string().min(1),
  version: z.number().int().min(1),
  assignedTo: idSchema.optional(),
  completedAt: instantSchema.optional(),
  handoffMethod: z.string().min(1).optional(),
});
export type DeliveryLegSummary = z.infer<
  typeof deliveryLegSummarySchema
>;

export const orderTimelineEventSchema = z.object({
  status: orderStatusSchema,
  label: z.string().min(1),
  at: instantSchema,
  actorRole: actorRoleSchema.optional(),
  reason: z.string().optional(),
});
export type OrderTimelineEvent = z.infer<
  typeof orderTimelineEventSchema
>;

export const orderSchema = z.object({
  id: idSchema,
  version: z.number().int().min(1),
  status: orderStatusSchema,
  customerId: idSchema,
  facilityId: idSchema.optional(),
  lines: z.array(orderLineSchema).min(1),
  totalMinor: moneySchema,
  currency: currencySchema,
  paymentModel: z.enum(["DUE_AT_RETURN", "PREPAID_V1"]),
  pickupWindow: windowSchema,
  promisedReturnWindow: windowSchema,
  createdAt: instantSchema,
  timeline: z.array(
    z.object({
      status: orderStatusSchema,
      label: z.string().min(1),
      at: instantSchema,
    }),
  ),
  adjustment: adjustmentSchema.optional(),
  containers: z.array(containerSchema),
  measuredLines: z.array(measuredLineSchema).optional(),
  permittedActions: z.array(orderActionSchema),
  deliveryLegs: z.array(deliveryLegSummarySchema),
});
export type Order = z.infer<typeof orderSchema>;

export const custodyReceiptSchema = z.object({
  orderId: idSchema,
  estimatedQuantity: nonNegativeIntegerSchema,
  declaredGarmentCount: nonNegativeIntegerSchema.optional(),
  countedQuantity: nonNegativeIntegerSchema.optional(),
  measuredWeightGrams: nonNegativeIntegerSchema.optional(),
  sealedContainerCount: nonNegativeIntegerSchema,
  amountDueAtReturnMinor: moneySchema,
  currency: currencySchema,
  currentHandoff: z.enum([
    "NONE",
    "PICKUP_PENDING",
    "AT_PICKUP",
    "PICKED_UP",
    "AT_FACILITY",
    "IN_CARE",
    "READY_FOR_RETURN",
    "RETURN_PENDING",
    "RETURNED",
    "DELIVERED",
  ]),
  updatedAt: instantSchema,
});
export type CustodyReceipt = z.infer<typeof custodyReceiptSchema>;
