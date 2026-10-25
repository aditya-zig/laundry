import { z } from "zod";
import { actorSchema, expectedVersionSchema, idSchema, instantSchema } from "./common.js";

export const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/);
export const otpRequestSchema = z.object({ phone: phoneSchema }).strict();
export type OtpRequest = z.infer<typeof otpRequestSchema>;

// Production challenge responses never include a fixture OTP or a demo code.
export const otpChallengeSchema = z.object({
  challengeId: idSchema,
  expiresAt: instantSchema,
  retryAfterSeconds: z.number().int().nonnegative().optional(),
}).strict();
export type OtpChallenge = z.infer<typeof otpChallengeSchema>;

export const otpVerifySchema = z.object({
  challengeId: idSchema,
  code: z.string().regex(/^\d{6}$/),
  // Customer verification remains compatible. Provisioned staff additionally
  // prove their enrolled second factor before a privileged session is issued.
  mfaCode: z.string().regex(/^\d{6}$/).optional(),
}).strict();
export type OtpVerify = z.infer<typeof otpVerifySchema>;

export const sessionSchema = z.object({
  sessionId: idSchema,
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: instantSchema,
  actor: actorSchema,
}).strict();
export type Session = z.infer<typeof sessionSchema>;

export const sessionRefreshSchema = z.object({ refreshToken: z.string().min(1) }).strict();
export type SessionRefresh = z.infer<typeof sessionRefreshSchema>;
export const logoutResultSchema = z.object({ revoked: z.literal(true) }).strict();
export type LogoutResult = z.infer<typeof logoutResultSchema>;
export const sessionRevocationSchema = z.object({
  sessionId: idSchema,
  revoked: z.literal(true),
}).strict();
export type SessionRevocation = z.infer<typeof sessionRevocationSchema>;

export const coordinatesSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
}).strict();
export const addressInputSchema = z.object({
  label: z.string().trim().min(1).max(80),
  line1: z.string().trim().min(1).max(500),
  city: z.string().trim().min(1).max(100),
  postalCode: z.string().regex(/^\d{6}$/),
  coordinates: coordinatesSchema,
}).strict();
export type AddressInput = z.infer<typeof addressInputSchema>;
export const addressSchema = addressInputSchema.extend({
  id: idSchema,
  ownerId: idSchema,
  version: expectedVersionSchema,
});
export type Address = z.infer<typeof addressSchema>;
export const addressUpdateSchema = addressInputSchema.extend({
  expectedVersion: expectedVersionSchema,
});
export type AddressUpdate = z.infer<typeof addressUpdateSchema>;
export const addressDeleteSchema = z.object({ expectedVersion: expectedVersionSchema }).strict();
export const deleteResultSchema = z.object({ id: idSchema, deleted: z.literal(true) }).strict();
export type DeleteResult = z.infer<typeof deleteResultSchema>;
