import { z } from "zod";

export const pilotPointSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict();
export const pilotServiceCodeSchema = z.enum(["WASH_FOLD", "WASH_PRESS"]);
/** Every window is an absolute instant plus the display zone. The instant is
 * what the scheduler compares; Asia/Kolkata is what the customer reads. */
export const PILOT_TIME_ZONE = "Asia/Kolkata" as const;
export const pilotTimeZoneSchema = z.literal(PILOT_TIME_ZONE);
const pilotInstantSchema = z.string().datetime({ offset: true });

export const pilotSlotSchema = z.object({
  id: z.string().uuid(),
  timeZone: pilotTimeZoneSchema,
  pickupStart: pilotInstantSchema,
  pickupEnd: pilotInstantSchema,
  returnStart: pilotInstantSchema,
  returnEnd: pilotInstantSchema,
  capacity: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
}).strict();
export type PilotSlot = z.infer<typeof pilotSlotSchema>;

export const pilotConfigSchema = z.object({
  demo: z.literal(true), ratesApproved: z.literal(false),
  timeZone: pilotTimeZoneSchema,
  services: z.array(z.object({ code: pilotServiceCodeSchema, name: z.string(), rateMinorPerKg: z.number().int().positive() })),
  slots: z.array(pilotSlotSchema),
  facility: pilotPointSchema.extend({ name: z.string() }),
  demoBoundary: z.object({ south: z.number(), north: z.number(), west: z.number(), east: z.number() }),
});
export type PilotConfig = z.infer<typeof pilotConfigSchema>;

export const pilotBookingSchema = z.object({
  serviceCode: pilotServiceCodeSchema,
  estimatedWeightGrams: z.number().int().min(1).max(50_000),
  slotId: z.string().uuid(),
  address: pilotPointSchema.extend({ line: z.string().trim().min(5).max(240) }),
}).strict();

/** Where a reported position came from. Provenance travels with the point so
 * nobody reads a hand-typed coordinate as a GPS fix. */
export const pilotLocationSourceSchema = z.enum(["BROWSER_GEOLOCATION", "MANUAL"]);
export type PilotLocationSource = z.infer<typeof pilotLocationSourceSchema>;

export const pilotLocationReportSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  capturedAt: z.string().datetime(),
  source: pilotLocationSourceSchema,
}).strict();
export type PilotLocationReport = z.infer<typeof pilotLocationReportSchema>;

/** A position as read by the customer, operations or the rider. `ageSeconds`
 * and `stale` let the UI refuse to present an old point as live tracking. */
export const pilotLocationSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  capturedAt: z.string(),
  reportedAt: z.string(),
  source: pilotLocationSourceSchema,
  ageSeconds: z.number().int().nonnegative(),
  stale: z.boolean(),
  staleAfterSeconds: z.number().int().positive(),
}).strict();
export type PilotLocation = z.infer<typeof pilotLocationSchema>;

export const pilotRiderSchema = z.object({ id: z.string().uuid(), name: z.string() }).strict();
export type PilotRider = z.infer<typeof pilotRiderSchema>;

export const pilotOrderSchema = z.object({
  id: z.string().uuid(), version: z.number().int().positive(), customerId: z.string().uuid(),
  riderId: z.string().uuid().nullable(), slotId: z.string().uuid(), serviceCode: pilotServiceCodeSchema,
  status: z.enum(["BOOKED", "PICKED_UP", "AWAITING_APPROVAL", "INTAKE_COMPLETE", "IN_CARE", "QUALITY_CHECK", "READY_FOR_RETURN", "RETURNING", "DELIVERED", "ON_HOLD", "CANCELLED"]),
  pickupStatus: z.enum(["PENDING", "ASSIGNED", "COMPLETED"]),
  returnStatus: z.enum(["PENDING", "READY", "ASSIGNED", "COMPLETED"]),
  paymentStatus: z.enum(["UNPAID", "UNRESOLVED", "PAID"]),
  estimatedWeightGrams: z.number().int(), measuredWeightGrams: z.number().int().nullable(),
  rateMinorPerKg: z.number().int(), totalMinor: z.number().int(), proposedTotalMinor: z.number().int().nullable(),
  currency: z.literal("INR"), address: pilotPointSchema.extend({ line: z.string() }),
  timeZone: pilotTimeZoneSchema,
  pickupStart: pilotInstantSchema, pickupEnd: pilotInstantSchema,
  returnStart: pilotInstantSchema, returnEnd: pilotInstantSchema,
  pickupCodeExpiresAt: pilotInstantSchema.nullable().optional(),
  returnCodeExpiresAt: pilotInstantSchema.nullable().optional(),
  createdAt: z.string(),
  pickupCode: z.string().optional(), returnCode: z.string().optional(),
  holdReason: z.string().nullable(),
  events: z.array(z.object({ action: z.string(), label: z.string(), at: z.string() })).default([]),
});
export type PilotBooking = z.infer<typeof pilotBookingSchema>;
export type PilotOrder = z.infer<typeof pilotOrderSchema>;

const command = z.object({ expectedVersion: z.number().int().positive() });
export const pilotActionSchema = z.discriminatedUnion("action", [
  command.extend({ action: z.literal("ASSIGN"), riderId: z.string().uuid() }).strict(),
  command.extend({ action: z.literal("PICKUP"), code: z.string().regex(/^\d{6}$/) }).strict(),
  command.extend({ action: z.literal("INTAKE"), measuredWeightGrams: z.number().int().min(1).max(50_000), bagCount: z.number().int().min(1).max(20) }).strict(),
  command.extend({ action: z.literal("APPROVE_PRICE") }).strict(),
  command.extend({ action: z.literal("DECLINE_PRICE") }).strict(),
  command.extend({ action: z.literal("START_CARE") }).strict(),
  command.extend({ action: z.literal("QUALITY_CHECK") }).strict(),
  command.extend({ action: z.literal("READY_FOR_RETURN") }).strict(),
  command.extend({ action: z.literal("START_RETURN") }).strict(),
  command.extend({ action: z.literal("CONFIRM_PAYMENT"), method: z.enum(["CASH", "UPI"]), amountMinor: z.number().int().positive(), reference: z.string().trim().min(6).max(100) }).strict(),
  command.extend({ action: z.literal("DELIVER"), code: z.string().regex(/^\d{6}$/) }).strict(),
  command.extend({ action: z.literal("CANCEL") }).strict(),
  command.extend({ action: z.literal("PAYMENT_ISSUE"), reason: z.string().trim().min(3).max(240) }).strict(),
  /** The customer can rotate an expired or locked code without staff SQL. The
   * old code stops working and the reissue is written to the order history. */
  command.extend({ action: z.literal("REISSUE_HANDOVER_CODE"), leg: z.enum(["PICKUP", "RETURN"]) }).strict(),
  /** Founder release for a held order. Only an agreed unprocessed return is
   * modelled: no fee is invented and the payment state stays truthful. */
  command.extend({
    action: z.literal("RESOLVE_HOLD"),
    resolution: z.literal("RETURN_UNPROCESSED"),
    customerAgreed: z.literal(true),
    note: z.string().trim().min(10).max(500),
  }).strict(),
]);
export type PilotAction = z.infer<typeof pilotActionSchema>;
