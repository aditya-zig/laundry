import { z } from "zod";
import { expectedVersionSchema, idSchema, instantSchema, windowSchema } from "./common.js";

export const slotPairSchema = z.object({
  id: idSchema,
  pickupWindow: windowSchema,
  returnWindow: windowSchema,
  available: z.boolean(),
  unavailableReason: z.enum(["NO_CAPACITY", "DEADLINE_UNAVAILABLE", "CLOSED"]).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.returnWindow.start < value.pickupWindow.end) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["returnWindow"], message: "Return cannot precede pickup completion." });
  }
  if (value.available === (value.unavailableReason !== undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["unavailableReason"], message: "Unavailable pairs require a reason; available pairs cannot have one." });
  }
});
export type SlotPair = z.infer<typeof slotPairSchema>;
export const slotPairListSchema = z.array(slotPairSchema);
export const slotQuerySchema = z.object({
  areaId: idSchema,
  from: instantSchema,
  to: instantSchema,
  serviceIds: z.array(idSchema).min(1).max(20),
  requestedReturnBy: instantSchema.optional(),
}).strict().refine(v => v.to > v.from, { path: ["to"], message: "Slot search must have positive duration." });
export type SlotQuery = z.infer<typeof slotQuerySchema>;

export const capacityBucketSchema = z.object({
  id: idSchema,
  facilityId: idSchema,
  areaId: idSchema,
  window: windowSchema,
  capacity: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  version: expectedVersionSchema,
}).strict().refine(v => v.reserved <= v.capacity, { path: ["reserved"], message: "Reserved capacity cannot exceed capacity." });
export type CapacityBucket = z.infer<typeof capacityBucketSchema>;
export const capacityUpdateSchema = z.object({
  bucketId: idSchema,
  capacity: z.number().int().nonnegative(),
  expectedVersion: expectedVersionSchema,
  reason: z.string().trim().min(1).max(2000),
}).strict();
export type CapacityUpdate = z.infer<typeof capacityUpdateSchema>;
export const operationsCalendarSchema = z.object({
  buckets: z.array(capacityBucketSchema),
  generatedAt: instantSchema,
}).strict();
