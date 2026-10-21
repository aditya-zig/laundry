import { z } from "zod";
import {
  idSchema,
  instantSchema,
  ianaTimezoneSchema,
  type Instant,
} from "./common.js";

export const serviceCodeSchema = z.enum([
  "WASH_FOLD",
  "WASH_PRESS",
  "PRESS_ONLY",
  "DRY_CLEAN",
]);
export type ServiceCode = z.infer<typeof serviceCodeSchema>;

export const garmentEligibilitySchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  eligibleServiceCodes: z.array(serviceCodeSchema),
  priceMinor: z.number().int().nonnegative().optional(),
  active: z.boolean(),
});
export type GarmentEligibility = z.infer<typeof garmentEligibilitySchema>;

export const rateCardComponentSchema = z.object({
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
  synthetic: z.boolean(),
});
export type RateCardComponent = z.infer<typeof rateCardComponentSchema>;

export const rateCardSchema = z.object({
  id: idSchema,
  version: z.number().int().min(1),
  serviceCodes: z.array(serviceCodeSchema).min(1),
  components: z.array(rateCardComponentSchema),
  weightIncrementGrams: z.number().int().positive().optional(),
  minimumBillableGrams: z.number().int().positive().optional(),
  rounding: z.enum(["NONE", "CEIL", "FLOOR"]),
  effectiveFrom: instantSchema,
  approvedAt: instantSchema.optional(),
  activatedAt: instantSchema.optional(),
  synthetic: z.boolean(),
});
export type RateCard = z.infer<typeof rateCardSchema>;

export const serviceSchema = z.object({
  id: idSchema,
  code: serviceCodeSchema,
  name: z.string().min(1),
  description: z.string(),
  imageUrl: z.string().url(),
  billingUnit: z.enum(["KG", "PIECE", "BOTH"]),
  turnaroundHours: z.number().int().positive(),
  garments: z.array(garmentEligibilitySchema),
  features: z.array(z.string()),
  careExclusions: z.array(z.string()),
  active: z.boolean(),
});
export type Service = z.infer<typeof serviceSchema>;

export const serviceAreaPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type ServiceAreaPoint = z.infer<typeof serviceAreaPointSchema>;

export const serviceAreaHoursSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
});
export type ServiceAreaHours = z.infer<typeof serviceAreaHoursSchema>;

export const serviceAreaSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  timezone: ianaTimezoneSchema,
  polygon: z.array(serviceAreaPointSchema).min(3),
  hours: z.array(serviceAreaHoursSchema),
  active: z.boolean(),
});
export type ServiceArea = z.infer<typeof serviceAreaSchema>;

export const effectiveRateSummarySchema = z.object({
  serviceCode: serviceCodeSchema,
  billingUnit: z.enum(["KG", "PIECE", "BOTH"]),
  unitPriceMinor: z.number().int().nonnegative(),
  unitLabel: z.string().min(1),
  weightIncrementGrams: z.number().int().positive().optional(),
  minimumBillableGrams: z.number().int().positive().optional(),
  rateCardVersion: z.number().int().min(1).optional(),
  synthetic: z.boolean(),
});
export type EffectiveRateSummary = z.infer<
  typeof effectiveRateSummarySchema
>;
