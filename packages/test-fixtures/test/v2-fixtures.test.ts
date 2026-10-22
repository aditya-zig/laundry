import { describe, expect, it } from "vitest";
import { v2 } from "@laundry/contracts";
import { v2WireFixtures, v2OperationFixtures, v2EventFixtures, V2_FIXTURE_LABEL } from "../src/v2.js";

describe("deterministic synthetic v2 fixtures", () => {
  it("covers exactly the executable schema inventory without inferred fallback examples", () => {
    expect(Object.keys(v2WireFixtures).sort()).toEqual(Object.keys(v2.WIRE_SCHEMAS).sort());
  });

  for (const [name, fixture] of Object.entries(v2WireFixtures)) {
    it(`${name} validates against its published schema`, () => {
      const result = v2.getWireSchema(name).safeParse(fixture);
      expect(result.success, result.success ? name : `${name}: ${result.error.message}`).toBe(true);
    });
  }

  for (const route of v2.ROUTE_REGISTRY) {
    it(`${route.id} has a labeled request/response example`, () => {
      const fixture = v2OperationFixtures[route.id];
      expect(fixture.label).toBe(V2_FIXTURE_LABEL);
      expect(v2.getWireSchema(route.responseSchema).safeParse(fixture.response).success).toBe(true);
      if (route.requestSchema) expect(v2.getWireSchema(route.requestSchema).safeParse(fixture.request).success).toBe(true);
      else expect(fixture.request).toBeUndefined();
    });
  }

  for (const type of v2.eventTypeSchema.options) {
    it(`${type} has a valid payload-bound event envelope`, () => {
      expect(v2.domainEventSchema.safeParse(v2EventFixtures[type]).success).toBe(true);
      expect(v2.EVENT_PAYLOAD_SCHEMAS[type].safeParse(v2EventFixtures[type].payload).success).toBe(true);
    });
  }

  it("covers all four service codes with explicitly synthetic data", () => {
    expect(v2WireFixtures.ServiceList.map(service => service.code)).toEqual(["WASH_FOLD", "WASH_PRESS", "PRESS_ONLY", "DRY_CLEAN"]);
    expect(v2WireFixtures.RateCard.synthetic).toBe(true);
    for (const component of v2WireFixtures.RateCard.components) expect(component.synthetic).toBe(true);
  });

  it("keeps kilogram pricing, piece pricing and garment custody separate in the mixed quote", () => {
    const quote = v2.quoteSchema.parse(v2WireFixtures.Quote);
    expect(quote.lines.map(line => line.billingUnit)).toEqual(["KG", "PIECE"]);
    expect(quote.lines[0]).toMatchObject({ estimatedWeightGrams: 3000, declaredGarmentCount: 15, lineTotalMinor: 15000 });
    expect(quote.lines[1]).toMatchObject({ pieceQuantity: 2, declaredGarmentCount: 2, lineTotalMinor: 8000 });
    expect(quote.totalMinor).toBe(23000);
    expect(quote.currency).toBe("INR");
  });

  it("does not make schema validity depend on the machine clock", () => {
    expect(v2.otpChallengeSchema.safeParse({ ...v2WireFixtures.OtpChallenge, expiresAt: "2020-01-01T00:00:00Z" }).success).toBe(true);
    // Expiry is checked by trusted command guards with the server clock, not by a wire parser.
  });

  it("rejects reversed windows, mixed line quantities, unsafe money and forged production challenge codes", () => {
    const quote = v2WireFixtures.Quote;
    expect(v2.quoteSchema.safeParse({ ...quote, pickupWindow: { ...quote.pickupWindow, end: quote.pickupWindow.start } }).success).toBe(false);
    expect(v2.requestedLineSchema.safeParse({ ...v2WireFixtures.QuoteInput.lines[0], pieceQuantity: 1 }).success).toBe(false);
    expect(v2.moneySchema.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
    expect(v2.otpChallengeSchema.safeParse({ ...v2WireFixtures.OtpChallenge, demoCode: "123456" }).success).toBe(false);
  });

  it("rejects pickup completion and a void obligation masquerading as delivery/payment settlement", () => {
    const delivered = v2EventFixtures["order.delivered.v2"];
    expect(v2.domainEventSchema.safeParse({ ...delivered, payload: { ...delivered.payload, legAttempt: { ...delivered.payload.legAttempt, leg: "PICKUP" } } }).success).toBe(false);
    const settled = v2EventFixtures["payment.settled.v2"];
    expect(v2.domainEventSchema.safeParse({ ...settled, payload: { ...settled.payload, obligation: { ...settled.payload.obligation, status: "VOID", voidReason: "Synthetic agreed resolution" } } }).success).toBe(false);
  });

  it("does not accept unconsented public reviews or a rider-selected operator exception", () => {
    expect(v2.reviewSchema.safeParse({ ...v2WireFixtures.Review, publication: "PUBLISHED", publishConsent: false }).success).toBe(false);
    expect(v2.riderHandoverSchema.safeParse({ ...v2WireFixtures.RiderHandover, method: "OPERATOR_EXCEPTION" }).success).toBe(false);
  });

  it("keeps private media on reserved non-resolving fixture origins", () => {
    expect(new URL(v2WireFixtures.UploadIntentResult.uploadUrl).hostname).toBe("example.invalid");
    expect(new URL(v2WireFixtures.MediaDownload.url).hostname).toBe("example.invalid");
    expect(v2WireFixtures.MediaReference.visibility).toBe("PRIVATE");
    expect(v2.mediaReferenceSchema.safeParse({ ...v2WireFixtures.MediaReference, expiresAt: undefined }).success).toBe(false);
  });

  it.each(v2.errorCodeSchema.options)("encodes the documented %s error envelope", code => {
    expect(v2.errorEnvelopeSchema.safeParse({ ...v2WireFixtures.ErrorEnvelope, code, retryable: v2.errorRetryable[code] }).success).toBe(true);
    expect(v2.errorHttpStatus[code]).toBeGreaterThanOrEqual(400);
  });
});
