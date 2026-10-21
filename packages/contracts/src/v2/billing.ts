import { z } from "zod";
import {
  idSchema,
  instantSchema,
  moneySchema,
  currencySchema,
} from "./common.js";

export const obligationStatusSchema = z.enum([
  "OPEN",
  "PARTIALLY_SETTLED",
  "SETTLED",
  "VOID",
]);
export type ObligationStatus = z.infer<typeof obligationStatusSchema>;

export const paymentModelSchema = z.enum(["DUE_AT_RETURN", "PREPAID_V1"]);
export type PaymentModel = z.infer<typeof paymentModelSchema>;

export const obligationSchema = z
  .object({
    id: idSchema,
    orderId: idSchema,
    status: obligationStatusSchema,
    amountDueMinor: moneySchema,
    amountSettledMinor: moneySchema,
    currency: currencySchema,
    paymentModel: paymentModelSchema,
    dueAt: instantSchema,
    voidReason: z.string().trim().min(1).optional(),
    version: z.number().int().nonnegative(),
  })
  .superRefine((value, ctx) => {
    if (value.amountSettledMinor > value.amountDueMinor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amountSettledMinor"],
        message: "Settled amount cannot exceed the amount due.",
      });
    }
    if (
      value.status === "SETTLED" &&
      value.amountSettledMinor !== value.amountDueMinor
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "A settled obligation must be fully settled.",
      });
    }
    if (
      value.status === "PARTIALLY_SETTLED" &&
      (value.amountSettledMinor <= 0 ||
        value.amountSettledMinor >= value.amountDueMinor)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "A partially settled obligation must have a partial payment.",
      });
    }
    if (value.status === "OPEN" && value.amountSettledMinor !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "An open obligation cannot have settled funds.",
      });
    }
    if (value.status === "VOID") {
      if (value.amountDueMinor !== value.amountSettledMinor) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["amountSettledMinor"],
          message: "A void obligation must have zero remaining due.",
        });
      }
      if (!value.voidReason) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["voidReason"],
          message: "A void obligation requires a reason.",
        });
      }
    } else if (value.voidReason !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["voidReason"],
        message: "Only a void obligation may carry a void reason.",
      });
    }
  });
export type Obligation = z.infer<typeof obligationSchema>;

export const attemptStatusSchema = z.enum([
  "CREATED",
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "EXPIRED",
  "OUTCOME_UNKNOWN",
]);
export type AttemptStatus = z.infer<typeof attemptStatusSchema>;

export const paymentMethodSchema = z.enum([
  "CASH",
  "UPI",
  "CARD",
  "WALLET",
  "GATEWAY",
]);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const paymentAttemptSchema = z
  .object({
    id: idSchema,
    obligationId: idSchema,
    status: attemptStatusSchema,
    method: paymentMethodSchema,
    amountMinor: moneySchema,
    providerReference: z.string().trim().min(1).optional(),
    externalEventId: z.string().trim().min(1).optional(),
    startedAt: instantSchema,
    resolvedAt: instantSchema.optional(),
    failureReason: z.string().trim().min(1).optional(),
    attemptCount: z.number().int().positive(),
  })
  .superRefine((value, ctx) => {
    const terminal =
      value.status === "SUCCEEDED" ||
      value.status === "FAILED" ||
      value.status === "EXPIRED";
    if (terminal && !value.resolvedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resolvedAt"],
        message: "A terminal payment attempt requires a resolution time.",
      });
    }
    if (
      value.status === "OUTCOME_UNKNOWN" &&
      value.failureReason !== undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failureReason"],
        message: "An unknown outcome is not a confirmed failure.",
      });
    }
  });
export type PaymentAttempt = z.infer<typeof paymentAttemptSchema>;

export const receiptConfirmationSchema = z.enum([
  "MANUAL_CASH",
  "MANUAL_UPI",
  "GATEWAY_CAPTURE",
]);
export type ReceiptConfirmation = z.infer<typeof receiptConfirmationSchema>;

export const receiptSchema = z
  .object({
    id: idSchema,
    obligationId: idSchema,
    amountMinor: moneySchema,
    currency: currencySchema,
    method: paymentMethodSchema,
    confirmedBy: idSchema.optional(),
    confirmedVia: receiptConfirmationSchema,
    externalReference: z.string().trim().min(1).optional(),
    issuedAt: instantSchema,
  })
  .superRefine((value, ctx) => {
    if (
      value.confirmedVia === "GATEWAY_CAPTURE" &&
      value.externalReference === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["externalReference"],
        message: "A gateway capture requires an external reference.",
      });
    }
    if (
      value.confirmedVia !== "GATEWAY_CAPTURE" &&
      value.confirmedBy === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmedBy"],
        message: "A manual confirmation requires a staff actor ID.",
      });
    }
  });
export type Receipt = z.infer<typeof receiptSchema>;

export const refundStatusSchema = z.enum([
  "REQUESTED",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "OUTCOME_UNKNOWN",
]);
export type RefundStatus = z.infer<typeof refundStatusSchema>;

export const refundSchema = z
  .object({
    id: idSchema,
    orderId: idSchema,
    paymentId: idSchema,
    obligationId: idSchema.optional(),
    status: refundStatusSchema,
    amountMinor: moneySchema,
    currency: currencySchema,
    reason: z.string().trim().min(1),
    requestedBy: idSchema,
    requestedAt: instantSchema,
    resolvedAt: instantSchema.optional(),
    externalReference: z.string().trim().min(1).optional(),
    attemptCount: z.number().int().positive(),
  })
  .superRefine((value, ctx) => {
    if (
      (value.status === "SUCCEEDED" || value.status === "FAILED") &&
      value.resolvedAt === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resolvedAt"],
        message: "A completed refund attempt requires a resolution time.",
      });
    }
  });
export type Refund = z.infer<typeof refundSchema>;

export const reconciliationKindSchema = z.enum([
  "CAPTURE",
  "REFUND",
  "MANUAL",
  "CHARGEBACK",
]);
export type ReconciliationKind = z.infer<typeof reconciliationKindSchema>;

export const reconciliationEntrySchema = z.object({
  id: idSchema,
  kind: reconciliationKindSchema,
  amountMinor: moneySchema,
  currency: currencySchema,
  externalReference: z.string().trim().min(1),
  recordedAt: instantSchema,
  matched: z.boolean(),
});
export type ReconciliationEntry = z.infer<typeof reconciliationEntrySchema>;

export const reconciliationSchema = z
  .object({
    periodStart: instantSchema,
    periodEnd: instantSchema,
    entries: z.array(reconciliationEntrySchema),
    capturedMinor: moneySchema,
    refundedMinor: moneySchema,
    manualMinor: moneySchema,
    unmatchedCount: z.number().int().nonnegative(),
    differenceMinor: z.number().int(),
  })
  .superRefine((value, ctx) => {
    if (value.periodStart >= value.periodEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodEnd"],
        message: "The reconciliation period must have a positive duration.",
      });
    }
    const unmatched = value.entries.filter(
      (entry: z.infer<typeof reconciliationEntrySchema>) => !entry.matched,
    ).length;
    if (value.unmatchedCount !== unmatched) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unmatchedCount"],
        message: "Unmatched count must equal the number of unmatched entries.",
      });
    }
  });
export type Reconciliation = z.infer<typeof reconciliationSchema>;

export const billingSummarySchema = z.object({
  orderId: idSchema,
  obligationStatus: obligationStatusSchema,
  amountDueMinor: moneySchema,
  amountSettledMinor: moneySchema,
  currency: currencySchema,
  receipts: z.array(receiptSchema),
  refunds: z.array(refundSchema),
  dueAt: instantSchema,
});
export type BillingSummary = z.infer<typeof billingSummarySchema>;
