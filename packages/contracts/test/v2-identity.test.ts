import { describe, expect, it } from "vitest";
import {
  addressInputSchema,
  addressSchema,
  addressDeleteSchema,
  addressUpdateSchema,
  otpChallengeSchema,
  otpRequestSchema,
  sessionSchema,
} from "../src/v2/identity.js";
import { reviewInputSchema } from "../src/v2/reviews.js";

const id = "11111111-1111-4111-8111-111111111111";
const expiresAt = "2026-10-22T09:00:00+05:30";

describe("v2 identity boundary", () => {
  it("accepts a challenge without exposing the OTP", () => {
    expect(otpChallengeSchema.parse({ challengeId: id, expiresAt })).toEqual({
      challengeId: id,
      expiresAt: "2026-10-22T03:30:00.000Z",
    });
    expect(otpChallengeSchema.safeParse({ challengeId: id }).success).toBe(false);
  });

  it("rejects a demo code on the production challenge", () => {
    expect(otpChallengeSchema.safeParse({
      challengeId: id, expiresAt, demoCode: "123456",
    }).success).toBe(false);
  });

  it("requires an international phone number and rejects client-selected roles", () => {
    expect(otpRequestSchema.safeParse({ phone: "+919000000000" }).success).toBe(true);
    expect(otpRequestSchema.safeParse({ phone: "123" }).success).toBe(false);
    expect(otpRequestSchema.safeParse({
      phone: "+919000000000", role: "ADMIN",
    }).success).toBe(false);
  });

  it("requires a versioned owned address and confirmed coordinates", () => {
    const input = {
      label: "Home", line1: "Synthetic address", city: "Bengaluru",
      postalCode: "560038", coordinates: { lat: 12.97, lng: 77.64 },
    };
    expect(addressInputSchema.safeParse(input).success).toBe(true);
    expect(addressSchema.safeParse(input).success).toBe(false);
    expect(addressSchema.safeParse({ ...input, id, ownerId: id, version: 1 }).success).toBe(true);
    expect(addressInputSchema.safeParse({ ...input, ownerId: id }).success).toBe(false);
    expect(addressInputSchema.safeParse({
      ...input, coordinates: { lat: 91, lng: 77.64 },
    }).success).toBe(false);
  });

  it("rejects an incomplete session and a missing expiry", () => {
    expect(sessionSchema.safeParse({ token: "demo-token" }).success).toBe(false);
    const session = {
      sessionId: id, accessToken: "opaque-access", refreshToken: "opaque-refresh",
      expiresAt,
      actor: { id, role: "CUSTOMER", facilityIds: [], scope: { facilityIds: [] } },
    };
    expect(sessionSchema.safeParse(session).success).toBe(true);
    expect(sessionSchema.safeParse({ ...session, expiresAt: undefined }).success).toBe(false);
  });

  it("requires a current version on address updates and deletions", () => {
    expect(addressDeleteSchema.safeParse({}).success).toBe(false);
    expect(addressDeleteSchema.safeParse({ expectedVersion: -1 }).success).toBe(false);
    expect(addressDeleteSchema.safeParse({ expectedVersion: 1 }).success).toBe(true);
    expect(addressUpdateSchema.safeParse({
      label: "Home", line1: "Synthetic address", city: "Bengaluru",
      postalCode: "560038", coordinates: { lat: 12.97, lng: 77.64 },
    }).success).toBe(false);
  });

  it("accepts review intent but rejects client-selected publication and owner", () => {
    const input = { orderId: id, expectedVersion: 2, overall: 5, mediaIds: [], publishConsent: true };
    expect(reviewInputSchema.safeParse(input).success).toBe(true);
    expect(reviewInputSchema.safeParse({ ...input, publication: "PUBLISHED" }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ ...input, customerId: id }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ ...input, expectedVersion: undefined }).success).toBe(false);
  });
});
