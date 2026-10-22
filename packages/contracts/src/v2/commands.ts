import { z } from "zod";
import { expectedVersionSchema, idSchema, instantSchema, moneySchema } from "./common.js";
import { containerSchema, measuredLineSchema } from "./orders.js";
import { garmentConditionSchema, handoverProofSchema } from "./logistics.js";
import { incidentCategorySchema } from "./support.js";

const reasonSchema = z.string().trim().min(1).max(2000);
const mediaIdsSchema = z.array(idSchema).max(20);
export const versionedCommandSchema = z.object({ expectedVersion: expectedVersionSchema }).strict();
export type VersionedCommand = z.infer<typeof versionedCommandSchema>;
export const orderCancellationSchema = versionedCommandSchema.extend({ reason: reasonSchema });
export const orderRescheduleSchema = versionedCommandSchema.extend({ newQuoteId: idSchema, quoteVersion: expectedVersionSchema });
export type OrderReschedule = z.infer<typeof orderRescheduleSchema>;
export const intakeRecordSchema = versionedCommandSchema.extend({
  lines: z.array(measuredLineSchema).min(1).max(20),
  containers: z.array(containerSchema).min(1).max(100),
  mediaIds: mediaIdsSchema,
}).superRefine((v, ctx) => {
  for (const key of ["lines", "containers"] as const) {
    const ids = v[key].map(item => "orderLineId" in item ? item.orderLineId : item.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Duplicate inventory IDs are not allowed." });
  }
});
export type IntakeRecord = z.infer<typeof intakeRecordSchema>;
export const careUpdateSchema = versionedCommandSchema.extend({ target: z.enum(["IN_CARE", "QUALITY_CHECK"]), reason: reasonSchema.optional() });
export type CareUpdate = z.infer<typeof careUpdateSchema>;
export const qualityCheckSchema = versionedCommandSchema.extend({
  passed: z.boolean(),
  containers: z.array(containerSchema).min(1).max(100),
  mediaIds: mediaIdsSchema,
  note: reasonSchema.optional(),
}).refine(v => v.passed || v.note !== undefined, { path: ["note"], message: "Failed quality checks require a reason." });
export type QualityCheck = z.infer<typeof qualityCheckSchema>;
export const orderHoldSchema = orderCancellationSchema;
// Resuming care and exceptional unpaid returns are different audited commands.
export const exceptionResolutionSchema = versionedCommandSchema.extend({
  action: z.enum(["RESUME", "AGREED_RETURN", "CANCEL", "ESCALATE"]),
  reason: reasonSchema,
});
export type ExceptionResolution = z.infer<typeof exceptionResolutionSchema>;

export const manualPaymentConfirmationSchema = versionedCommandSchema.extend({
  method: z.enum(["CASH", "UPI"]),
  amountMinor: moneySchema.refine(v => v > 0, "A receipt requires money received."),
  currency: z.literal("INR"),
  externalReference: z.string().trim().min(1).max(200).optional(),
  reason: reasonSchema,
}).refine(v => v.method !== "UPI" || v.externalReference !== undefined, { path: ["externalReference"], message: "Manual UPI needs a transaction reference." });
export type ManualPaymentConfirmation = z.infer<typeof manualPaymentConfirmationSchema>;
export const refundRequestSchema = versionedCommandSchema.extend({
  orderId: idSchema,
  paymentId: idSchema,
  obligationId: idSchema,
  amountMinor: moneySchema.refine(v => v > 0, "Refund amount must be positive."),
  currency: z.literal("INR"),
  reason: reasonSchema,
});
export type RefundRequest = z.infer<typeof refundRequestSchema>;
export const reconciliationRequestSchema = z.object({ period: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/) }).strict();

// A rider cannot select provider verification or operator exceptions.
export const riderHandoverSchema = handoverProofSchema.innerType().omit({ method: true }).extend({
  jobId: idSchema,
  expectedVersion: expectedVersionSchema,
  actionId: idSchema,
  method: z.literal("CODE"),
  code: z.string().regex(/^\d{6}$/),
}).strict();
export type RiderHandover = z.infer<typeof riderHandoverSchema>;
export const deliveryExceptionSchema = versionedCommandSchema.extend({
  actionId: idSchema,
  reason: reasonSchema,
  capturedAt: instantSchema,
  mediaIds: mediaIdsSchema,
});
export type DeliveryException = z.infer<typeof deliveryExceptionSchema>;
export const riderLocationReportSchema = z.object({
  jobId: idSchema,
  expectedVersion: expectedVersionSchema,
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().nonnegative().optional(),
  reportedAt: instantSchema,
}).strict();
export type RiderLocationReport = z.infer<typeof riderLocationReportSchema>;
export const assignmentInputSchema = versionedCommandSchema.extend({ legAttemptId: idSchema, riderId: idSchema, reason: reasonSchema });
export type AssignmentInput = z.infer<typeof assignmentInputSchema>;
export const reassignmentInputSchema = versionedCommandSchema.extend({ riderId: idSchema, reason: reasonSchema });
export type ReassignmentInput = z.infer<typeof reassignmentInputSchema>;
export const legCancellationSchema = orderCancellationSchema;
export type LegCancellation = z.infer<typeof legCancellationSchema>;

export const incidentInputSchema = z.object({ orderId: idSchema, category: incidentCategorySchema, summary: reasonSchema, detail: reasonSchema.optional(), mediaIds: mediaIdsSchema }).strict();
export type IncidentInput = z.infer<typeof incidentInputSchema>;
export const incidentMessageInputSchema = z.object({ body: z.string().trim().min(1).max(5000), mediaIds: mediaIdsSchema }).strict();
export type IncidentMessageInput = z.infer<typeof incidentMessageInputSchema>;
export const incidentResolutionInputSchema = versionedCommandSchema.extend({
  outcome: z.enum(["REPROCESS", "REFUND", "REPLACE", "REWORK", "NO_ACTION"]),
  reason: reasonSchema,
  refundAmountMinor: moneySchema.optional(),
}).superRefine((v, ctx) => {
  if ((v.outcome === "REFUND") !== (v.refundAmountMinor !== undefined)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["refundAmountMinor"], message: "Only refund resolutions require an amount." });
});
export type IncidentResolutionInput = z.infer<typeof incidentResolutionInputSchema>;
export const rewashRequestInputSchema = versionedCommandSchema.extend({ reason: reasonSchema });
export type RewashRequestInput = z.infer<typeof rewashRequestInputSchema>;
export const reviewModerationInputSchema = versionedCommandSchema.extend({ decision: z.enum(["PUBLISH", "REJECT", "HIDE"]), reason: reasonSchema });
export type ReviewModerationInput = z.infer<typeof reviewModerationInputSchema>;
