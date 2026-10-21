import { z } from "zod";
import { idSchema, instantSchema } from "./common.js";

export const reviewPublicationSchema = z.enum([
  "PENDING",
  "PUBLISHED",
  "REJECTED",
]);
export type ReviewPublication = z.infer<typeof reviewPublicationSchema>;

export const reviewSchema = z
  .object({
    id: idSchema,
    orderId: idSchema,
    customerId: idSchema,
    overall: z.number().int().min(1).max(5),
    serviceScore: z.number().int().min(1).max(5).optional(),
    deliveryScore: z.number().int().min(1).max(5).optional(),
    comment: z.string().trim().max(5000).optional(),
    mediaIds: z.array(idSchema),
    publishConsent: z.boolean(),
    publication: reviewPublicationSchema,
    createdAt: instantSchema,
    updatedAt: instantSchema,
    version: z.number().int().nonnegative(),
    moderationReason: z.string().trim().min(1).optional(),
    moderatedBy: idSchema.optional(),
    moderatedAt: instantSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.updatedAt < value.createdAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["updatedAt"],
        message: "Updated time cannot precede creation.",
      });
    }
    if (value.publication === "PUBLISHED" && !value.publishConsent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publishConsent"],
        message: "Publication requires customer consent.",
      });
    }
    if (
      value.publication !== "PENDING" &&
      (!value.moderatedBy || !value.moderatedAt || !value.moderationReason)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["moderationReason"],
        message: "A moderation decision requires an actor, time, and reason.",
      });
    }
  });
export type Review = z.infer<typeof reviewSchema>;

export const publicReviewSchema = z.object({
  id: idSchema,
  orderId: idSchema,
  displayName: z.string().trim().min(1),
  overall: z.number().int().min(1).max(5),
  serviceScore: z.number().int().min(1).max(5).optional(),
  deliveryScore: z.number().int().min(1).max(5).optional(),
  comment: z.string().trim().max(5000).optional(),
  mediaIds: z.array(idSchema),
  createdAt: instantSchema,
});
export type PublicReview = z.infer<typeof publicReviewSchema>;

export const reviewModerationSchema = z.object({
  reviewId: idSchema,
  decision: z.enum(["PUBLISH", "REJECT", "HIDE"]),
  reason: z.string().trim().min(1),
  moderatedBy: idSchema,
  moderatedAt: instantSchema,
});
export type ReviewModeration = z.infer<typeof reviewModerationSchema>;

export const reviewEligibilitySchema = z.object({
  orderId: idSchema,
  eligible: z.boolean(),
  reason: z.string().trim().min(1).optional(),
  existingReviewId: idSchema.optional(),
});
export type ReviewEligibility = z.infer<typeof reviewEligibilitySchema>;
