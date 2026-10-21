import { z } from "zod";
import { idSchema, instantSchema } from "./common.js";
import { quoteSchema } from "./orders.js";

export const draftStateSchema = z.enum([
  "COLLECTING",
  "QUOTED",
  "CONFIRMED",
  "BOOKING_CREATED",
  "EXPIRED",
  "HUMAN_HANDOFF",
]);
export type DraftState = z.infer<typeof draftStateSchema>;

export const draftFieldSchema = z.object({
  name: z.enum([
    "SERVICE",
    "QUANTITY",
    "ADDRESS",
    "PICKUP_WINDOW",
    "RETURN_BY",
    "CARE_NOTES",
  ]),
  value: z.string().trim().min(1).optional(),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW", "MISSING"]),
  source: z.enum(["TEXT", "SPEECH"]),
});
export type DraftField = z.infer<typeof draftFieldSchema>;

export const conversationDraftSchema = z
  .object({
    draftId: idSchema,
    revision: z.number().int().nonnegative(),
    state: draftStateSchema,
    fields: z.array(draftFieldSchema),
    quoteId: idSchema.optional(),
    quoteVersion: z.number().int().nonnegative().optional(),
    expiresAt: instantSchema,
    missingFields: z.array(z.string().trim().min(1)),
    handoffTo: idSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.state === "QUOTED" ||
      value.state === "CONFIRMED" ||
      value.state === "BOOKING_CREATED"
    ) {
      if (value.quoteId === undefined || value.quoteVersion === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["quoteId"],
          message: "A quoted or confirmed draft requires a quote ID and version.",
        });
      }
    }
    if (value.state === "HUMAN_HANDOFF" && value.handoffTo === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["handoffTo"],
        message: "A human handoff requires an assigned recipient.",
      });
    }
  });
export type ConversationDraft = z.infer<typeof conversationDraftSchema>;

export const inboundMessageSchema = z
  .object({
    providerMessageId: z.string().trim().min(1),
    fromPhone: z.string().trim().min(1).optional(),
    text: z.string().optional(),
    audioMediaId: idSchema.optional(),
    receivedAt: instantSchema,
    verification: z.enum(["VERIFIED", "UNVERIFIED", "REJECTED"]),
  })
  .superRefine((value, ctx) => {
    if (
      (value.text === undefined || value.text.trim().length === 0) &&
      value.audioMediaId === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["text"],
        message: "A message must contain text or an audio attachment.",
      });
    }
  });
export type InboundMessage = z.infer<typeof inboundMessageSchema>;

export const draftConfirmationSchema = z.object({
  draftId: idSchema,
  revision: z.number().int().nonnegative(),
  quoteId: idSchema,
  quoteVersion: z.number().int().nonnegative(),
});
export type DraftConfirmation = z.infer<typeof draftConfirmationSchema>;

export const conversationReplySchema = z.object({
  draft: conversationDraftSchema,
  reply: z.string(),
  missingFields: z.array(z.string()),
  quote: quoteSchema.optional(),
  handoff: z.boolean(),
});
export type ConversationReply = z.infer<typeof conversationReplySchema>;
