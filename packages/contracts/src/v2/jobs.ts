import { z } from "zod";
import { expectedVersionSchema, idSchema, instantSchema } from "./common.js";

export const jobStatusSchema = z.enum(["QUEUED", "CLAIMED", "COMPLETED", "FAILED", "DEAD_LETTER"]);
// Public operations views deliberately omit payloads, which may contain private references.
export const jobSchema = z.object({
  id: idSchema,
  kind: z.string().trim().min(1),
  status: jobStatusSchema,
  version: expectedVersionSchema,
  attempts: z.number().int().nonnegative(),
  runAt: instantSchema,
  lastErrorCode: z.string().trim().min(1).optional(),
  leaseExpiresAt: instantSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.status === "CLAIMED" && !value.leaseExpiresAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["leaseExpiresAt"], message: "Claimed jobs require a lease expiry." });
  }
});
export type Job = z.infer<typeof jobSchema>;
export const jobReplaySchema = z.object({
  expectedVersion: expectedVersionSchema,
  reason: z.string().trim().min(1).max(2000),
}).strict();
export type JobReplay = z.infer<typeof jobReplaySchema>;
export const jobHealthSchema = z.object({
  queued: z.number().int().nonnegative(),
  claimed: z.number().int().nonnegative(),
  deadLetter: z.number().int().nonnegative(),
  oldestDueAt: instantSchema.nullable(),
  observedAt: instantSchema,
}).strict();
export type JobHealth = z.infer<typeof jobHealthSchema>;
