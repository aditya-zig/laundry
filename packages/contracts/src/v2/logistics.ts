import { z } from "zod";
import {
  idSchema,
  instantSchema,
  windowSchema,
  expectedVersionSchema,
} from "./common.js";
import { orderStatusSchema, containerSchema } from "./orders.js";

export const legSchema = z.enum(["PICKUP", "RETURN"]);
export type Leg = z.infer<typeof legSchema>;

export const legAttemptStatusSchema = z.enum([
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
export type LegAttemptStatus = z.infer<typeof legAttemptStatusSchema>;

export const legAttemptSchema = z
  .object({
    id: idSchema,
    legId: idSchema,
    orderId: idSchema,
    leg: legSchema,
    version: expectedVersionSchema,
    status: legAttemptStatusSchema,
    attemptNumber: z.number().int().positive(),
    provider: z.string().trim().min(1).optional(),
    providerReference: z.string().trim().min(1).optional(),
    assignedTo: idSchema.optional(),
    scheduledWindow: windowSchema.optional(),
    startedAt: instantSchema,
    completedAt: instantSchema.optional(),
    failureReason: z.string().trim().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.status === "COMPLETED" &&
      value.completedAt === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "A completed attempt requires a completion time.",
      });
    }
    if (
      value.status !== "FAILED" &&
      value.status !== "CANCELLED" &&
      value.failureReason !== undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failureReason"],
        message: "Only failed or cancelled attempts may have a failure reason.",
      });
    }
  });
export type LegAttempt = z.infer<typeof legAttemptSchema>;

export const assignmentSchema = z
  .object({
    id: idSchema,
    legAttemptId: idSchema,
    riderId: idSchema,
    version: expectedVersionSchema,
    assignedAt: instantSchema,
    releasedAt: instantSchema.optional(),
    reason: z.string().trim().min(1).optional(),
    acceptedAt: instantSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.releasedAt !== undefined &&
      value.releasedAt < value.assignedAt
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["releasedAt"],
        message: "Release time cannot precede assignment time.",
      });
    }
  });
export type Assignment = z.infer<typeof assignmentSchema>;

export const custodyEventKindSchema = z.enum([
  "PICKUP_STARTED",
  "PICKUP_COMPLETED",
  "FACILITY_RECEIVED",
  "CARE_STARTED",
  "CARE_COMPLETED",
  "RETURN_STARTED",
  "RETURN_COMPLETED",
  "DELIVERY_CONFIRMED",
]);
export type CustodyEventKind = z.infer<typeof custodyEventKindSchema>;

export const garmentConditionSchema = z.enum([
  "GOOD",
  "DAMAGED",
  "STAINTED",
  "MISSING",
]);
export type GarmentCondition = z.infer<typeof garmentConditionSchema>;

export const custodyEventSchema = z.object({
  id: idSchema,
  orderId: idSchema,
  leg: legSchema,
  kind: custodyEventKindSchema,
  containerIds: z.array(idSchema),
  garmentCount: z.number().int().nonnegative(),
  weightGrams: z.number().int().nonnegative().optional(),
  condition: garmentConditionSchema,
  occurredAt: instantSchema,
  actorId: idSchema,
  note: z.string().trim().min(1).optional(),
});
export type CustodyEvent = z.infer<typeof custodyEventSchema>;

export const handoverMethodSchema = z.enum([
  "CODE",
  "PROVIDER_PROOF",
  "OPERATOR_EXCEPTION",
]);
export type HandoverMethod = z.infer<typeof handoverMethodSchema>;

export const handoverProofSchema = z
  .object({
    legAttemptId: idSchema,
    method: handoverMethodSchema,
    code: z.string().trim().min(1).optional(),
    capturedAt: instantSchema,
    containerIds: z.array(idSchema),
    garmentCount: z.number().int().nonnegative(),
    condition: garmentConditionSchema,
    note: z.string().trim().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.method === "CODE" && value.code === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["code"],
        message: "Code-based handover requires a custody code.",
      });
    }
    if (value.method !== "CODE" && value.code !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["code"],
        message: "Only code-based handover accepts a custody code.",
      });
    }
    if (
      value.method === "OPERATOR_EXCEPTION" &&
      value.note === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["note"],
        message: "An operator exception requires a note.",
      });
    }
  });
export type HandoverProof = z.infer<typeof handoverProofSchema>;

export const handoverResultSchema = z.object({
  legAttemptId: idSchema,
  accepted: z.boolean(),
  reason: z.string().trim().min(1).optional(),
  custodyEventId: idSchema.optional(),
  attemptCount: z.number().int().nonnegative(),
  nextAttemptAllowed: z.boolean(),
  codeExpiresAt: instantSchema.optional(),
});
export type HandoverResult = z.infer<typeof handoverResultSchema>;

export const riderJobSchema = z.object({
  id: idSchema,
  orderId: idSchema,
  leg: legSchema,
  status: legAttemptStatusSchema,
  version: expectedVersionSchema,
  customerName: z.string().trim().min(1),
  addressLine1: z.string().trim().min(1),
  addressCity: z.string().trim().min(1),
  addressPostalCode: z.string().trim().min(1),
  window: windowSchema,
  containerIds: z.array(idSchema),
  containerCount: z.number().int().nonnegative(),
  pickupNotes: z.string().trim().min(1).optional(),
  contactPhone: z.string().trim().min(1).optional(),
  assignedTo: idSchema.optional(),
  assignmentActive: z.boolean(),
}).strict();
export type RiderJob = z.infer<typeof riderJobSchema>;

export const trackingStepSchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1),
  at: instantSchema.optional(),
  state: z.enum(["PENDING", "DONE", "CURRENT"]),
  detail: z.string().trim().min(1).optional(),
});
export type TrackingStep = z.infer<typeof trackingStepSchema>;

export const customerTrackingSchema = z.object({
  orderId: idSchema,
  status: orderStatusSchema,
  currentHandoff: z.string().trim().min(1).optional(),
  steps: z.array(trackingStepSchema),
  pickupWindow: windowSchema,
  promisedReturnWindow: windowSchema,
  riderName: z.string().trim().min(1).optional(),
  locationUpdatedAt: instantSchema.optional(),
  locationSource: z.enum(["PROVIDER", "RIDER_REPORTED"]).optional(),
});
export type CustomerTracking = z.infer<typeof customerTrackingSchema>;

export const locationReportSchema = z.object({
  orderId: idSchema,
  legAttemptId: idSchema,
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyMeters: z.number().nonnegative().optional(),
  source: z.enum(["DEVICE", "PROVIDER"]),
  reportedAt: instantSchema,
});
export type LocationReport = z.infer<typeof locationReportSchema>;

export const locationSchema = z.object({
  orderId: idSchema,
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  reportedAt: instantSchema,
  source: z.enum(["DEVICE", "PROVIDER"]),
  stale: z.boolean(),
});
export type Location = z.infer<typeof locationSchema>;
