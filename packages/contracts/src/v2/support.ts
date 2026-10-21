import { z } from "zod";
import { idSchema, instantSchema, moneySchema } from "./common.js";

export const incidentStatusSchema = z.enum([
  "OPEN",
  "AWAITING_CUSTOMER",
  "AWAITING_FACILITY",
  "RESOLVED",
  "REJECTED",
]);
export type IncidentStatus = z.infer<typeof incidentStatusSchema>;

export const incidentCategorySchema = z.enum([
  "DAMAGED",
  "MISSING",
  "LATE",
  "QUALITY",
  "BILLING",
  "OTHER",
]);
export type IncidentCategory = z.infer<typeof incidentCategorySchema>;

export const incidentSchema = z
  .object({
    id: idSchema,
    orderId: idSchema,
    status: incidentStatusSchema,
    category: incidentCategorySchema,
    summary: z.string().trim().min(1),
    detail: z.string().trim().min(1).optional(),
    mediaIds: z.array(idSchema),
    createdAt: instantSchema,
    updatedAt: instantSchema,
    resolvedAt: instantSchema.optional(),
    resolution: z.string().trim().min(1).optional(),
    rewashRequestId: idSchema.optional(),
    version: z.number().int().nonnegative(),
  })
  .superRefine((value, ctx) => {
    if (value.updatedAt < value.createdAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["updatedAt"],
        message: "Updated time cannot precede creation.",
      });
    }
    const closed =
      value.status === "RESOLVED" || value.status === "REJECTED";
    if (closed && (!value.resolvedAt || !value.resolution)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resolution"],
        message: "A closed incident requires an audited resolution.",
      });
    }
    if (!closed && value.resolvedAt !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resolvedAt"],
        message: "An open incident cannot have a resolution time.",
      });
    }
  });
export type Incident = z.infer<typeof incidentSchema>;

export const incidentMessageSchema = z.object({
  id: idSchema,
  incidentId: idSchema,
  authorRole: z.enum(["CUSTOMER", "OPERATOR", "SUPPORT", "SYSTEM"]),
  authorId: idSchema,
  body: z.string().trim().min(1),
  mediaIds: z.array(idSchema),
  createdAt: instantSchema,
});
export type IncidentMessage = z.infer<typeof incidentMessageSchema>;

export const incidentResolutionSchema = z
  .object({
    id: idSchema,
    incidentId: idSchema,
    outcome: z.enum(["REPROCESS", "REFUND", "REPLACE", "REWORK", "NO_ACTION"]),
    reason: z.string().trim().min(1),
    refundAmountMinor: moneySchema.optional(),
    decidedBy: idSchema,
    decidedAt: instantSchema,
  })
  .superRefine((value, ctx) => {
    if (value.outcome === "REFUND" && value.refundAmountMinor === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["refundAmountMinor"],
        message: "A refund resolution requires an amount.",
      });
    }
    if (
      value.outcome !== "REFUND" &&
      value.refundAmountMinor !== undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["refundAmountMinor"],
        message: "Only refund resolutions carry a refund amount.",
      });
    }
  });
export type IncidentResolution = z.infer<typeof incidentResolutionSchema>;

export const rewashRequestSchema = z
  .object({
    id: idSchema,
    incidentId: idSchema,
    orderId: idSchema,
    status: z.enum([
      "REQUESTED",
      "APPROVED",
      "IN_PROGRESS",
      "COMPLETED",
      "DECLINED",
    ]),
    reason: z.string().trim().min(1),
    createdAt: instantSchema,
    completedAt: instantSchema.optional(),
    version: z.number().int().nonnegative(),
  })
  .superRefine((value, ctx) => {
    if (
      value.status === "COMPLETED" &&
      value.completedAt === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "A completed rewash request requires a completion time.",
      });
    }
    if (
      value.status !== "COMPLETED" &&
      value.completedAt !== undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "Only a completed rewash request has a completion time.",
      });
    }
  });
export type RewashRequest = z.infer<typeof rewashRequestSchema>;
