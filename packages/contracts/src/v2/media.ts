import { z } from "zod";
import { idSchema, instantSchema } from "./common.js";

export const mediaKindSchema = z.enum([
  "CATALOG_ASSET",
  "PROOF_IMAGE",
  "VOICE_NOTE",
  "CUSTOMER_ATTACHMENT",
]);
export type MediaKind = z.infer<typeof mediaKindSchema>;

export const mediaVisibilitySchema = z.enum(["PUBLIC", "PRIVATE"]);
export type MediaVisibility = z.infer<typeof mediaVisibilitySchema>;

export const mediaStatusSchema = z.enum([
  "PENDING",
  "AVAILABLE",
  "FAILED",
  "DELETED",
]);
export type MediaStatus = z.infer<typeof mediaStatusSchema>;

export const mediaReferenceSchema = z
  .object({
    id: idSchema,
    kind: mediaKindSchema,
    visibility: mediaVisibilitySchema,
    mimeType: z.string().trim().min(1),
    sizeBytes: z.number().int().positive(),
    ownerId: idSchema,
    createdAt: instantSchema,
    expiresAt: instantSchema.optional(),
    checksum: z.string().trim().min(1).optional(),
    status: mediaStatusSchema,
  })
  .superRefine((value, ctx) => {
    if (value.kind === "CATALOG_ASSET" && value.visibility !== "PUBLIC") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visibility"],
        message: "Catalog assets must be public.",
      });
    }
    if (value.kind !== "CATALOG_ASSET" && value.visibility !== "PRIVATE") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visibility"],
        message: "Operational and customer media must be private.",
      });
    }
    if (
      value.kind !== "CATALOG_ASSET" &&
      value.expiresAt === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "Private media requires a retention expiry.",
      });
    }
    if (
      value.expiresAt !== undefined &&
      value.expiresAt <= value.createdAt
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "Expiry must be later than creation.",
      });
    }
  });
export type MediaReference = z.infer<typeof mediaReferenceSchema>;

export const uploadIntentSchema = z.object({
  kind: mediaKindSchema,
  mimeType: z.string().trim().min(1),
  sizeBytes: z.number().int().positive(),
  purpose: z.string().trim().min(1).optional(),
  orderId: idSchema.optional(),
  incidentId: idSchema.optional(),
});
export type UploadIntent = z.infer<typeof uploadIntentSchema>;

export const uploadIntentResultSchema = z.object({
  uploadId: idSchema,
  uploadUrl: z.string().url(),
  expiresAt: instantSchema,
  maxBytes: z.number().int().positive(),
  allowedMimeTypes: z.array(z.string().trim().min(1)).min(1),
});
export type UploadIntentResult = z.infer<typeof uploadIntentResultSchema>;

export const mediaDownloadSchema = z.object({
  url: z.string().url(),
  expiresAt: instantSchema,
});
export type MediaDownload = z.infer<typeof mediaDownloadSchema>;

export const retentionPolicySchema = z.object({
  kind: mediaKindSchema,
  retentionDays: z.number().int().positive(),
  deleteAfter: instantSchema.optional(),
});
export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;
