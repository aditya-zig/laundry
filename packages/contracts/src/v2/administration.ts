import { z } from "zod";
import { expectedVersionSchema, idSchema, instantSchema } from "./common.js";
import { phoneSchema } from "./identity.js";
import { rateCardSchema, serviceSchema } from "./catalog.js";
import { orderCancellationSchema } from "./commands.js";

export const staffInvitationSchema = z.object({
  phone: phoneSchema,
  role: z.enum(["OPERATOR", "SUPPORT", "FACILITY", "RIDER"]),
  facilityIds: z.array(idSchema).min(1),
  reason: z.string().trim().min(1).max(2000),
}).strict();
export type StaffInvitation = z.infer<typeof staffInvitationSchema>;
export const staffInvitationResultSchema = z.object({ invitationId: idSchema, expiresAt: instantSchema }).strict();
export type StaffInvitationResult = z.infer<typeof staffInvitationResultSchema>;
export const staffMfaSetupSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ENROLL") }).strict(),
  z.object({ action: z.literal("VERIFY"), challengeId: idSchema, code: z.string().regex(/^\d{6}$/) }).strict(),
  z.object({ action: z.literal("DISABLE"), challengeId: idSchema, code: z.string().regex(/^\d{6}$/), expectedVersion: expectedVersionSchema }).strict(),
]);
export type StaffMfaSetup = z.infer<typeof staffMfaSetupSchema>;
export const staffMfaResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("CHALLENGE"), challengeId: idSchema, expiresAt: instantSchema }).strict(),
  z.object({ status: z.literal("ENABLED"), version: expectedVersionSchema }).strict(),
  z.object({ status: z.literal("DISABLED"), version: expectedVersionSchema }).strict(),
]);
export type StaffMfaResult = z.infer<typeof staffMfaResultSchema>;
export const whatsAppLinkSchema = z.object({ challengeId: idSchema, code: z.string().regex(/^\d{6}$/) }).strict();
export type WhatsAppLink = z.infer<typeof whatsAppLinkSchema>;
export const whatsAppLinkResultSchema = z.object({ linked: z.literal(true), linkedAt: instantSchema }).strict();
export type WhatsAppLinkResult = z.infer<typeof whatsAppLinkResultSchema>;
export const serviceUpdateSchema = serviceSchema.omit({ id: true, version: true }).partial().extend({ expectedVersion: expectedVersionSchema, reason: z.string().trim().min(1).max(2000) }).strict();
export type ServiceUpdate = z.infer<typeof serviceUpdateSchema>;
export const rateCardInputSchema = rateCardSchema.omit({ id: true, version: true, approvedAt: true, activatedAt: true }).strict();
export type RateCardInput = z.infer<typeof rateCardInputSchema>;
export const versionedReasonSchema = orderCancellationSchema;
export type VersionedReason = z.infer<typeof versionedReasonSchema>;
export const conversationOptOutSchema = z.object({ channel: z.literal("WHATSAPP") }).strict();
export type ConversationOptOut = z.infer<typeof conversationOptOutSchema>;
export const optOutResultSchema = z.object({ optedOut: z.literal(true) }).strict();
export type OptOutResult = z.infer<typeof optOutResultSchema>;
export const conversationHandoffSchema = z.object({ expectedRevision: z.number().int().nonnegative(), assignedTo: idSchema, reason: z.string().trim().min(1).max(2000) }).strict();
export type ConversationHandoff = z.infer<typeof conversationHandoffSchema>;

// These are normalized adapter payloads after raw-body provider authentication,
// not a promise that all vendors share a JSON webhook format.
export const paymentWebhookSchema = z.object({
  eventId: z.string().trim().min(1),
  paymentId: idSchema,
  outcome: z.enum(["SUCCEEDED", "FAILED", "EXPIRED", "PENDING"]),
  amountMinor: z.number().int().nonnegative(),
  currency: z.literal("INR"),
  occurredAt: instantSchema,
  providerReference: z.string().trim().min(1),
}).strict();
export const logisticsWebhookSchema = z.object({
  eventId: z.string().trim().min(1),
  providerReference: z.string().trim().min(1),
  status: z.enum(["BOOKED", "ASSIGNED", "AT_PICKUP", "IN_TRANSIT", "COMPLETED", "FAILED", "CANCELLED"]),
  occurredAt: instantSchema,
  proofReference: z.string().trim().min(1).optional(),
}).strict();
export const webhookResultSchema = z.object({ accepted: z.boolean(), duplicate: z.boolean() }).strict();
export type WebhookResult = z.infer<typeof webhookResultSchema>;
