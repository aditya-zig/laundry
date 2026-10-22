import { describe, expect, it } from "vitest";
import {
  actorSchema,
  billingUnitSchema,
  errorEnvelopeSchema,
  errorHttpStatus,
  errorRetryable,
  instantSchema,
  localDateInZone,
  localDateInZoneSchema,
  rawInstantSchema,
  windowSchema,
} from "../src/v2/common.js";
import { effectiveRateSummarySchema, serviceCodeSchema } from "../src/v2/catalog.js";
import {
  adjustmentDecisionSchema,
  bookingInputSchema,
  custodyReceiptSchema,
  isMixedUnitBasket,
  quoteInputSchema,
  quoteLineSchema,
  requestedLineSchema,
} from "../src/v2/orders.js";

const ADDRESS_ID = "66666666-6666-4666-8666-666666666666";
const SERVICE_ID = "11111111-1111-4111-8111-111111111111";
const GARMENT_ID = "22222222-2222-4222-8222-222222222222";

describe("v2 instants", () => {
  it("accepts a Z instant and normalizes it to UTC", () => {
    expect(instantSchema.parse("2026-10-12T03:30:00.000Z")).toBe("2026-10-12T03:30:00.000Z");
  });

  it("accepts a +05:30 offset and normalizes it to the same instant", () => {
    const offset = instantSchema.parse("2026-10-12T09:00:00+05:30");
    const utc = instantSchema.parse("2026-10-12T03:30:00Z");
    expect(offset).toBe(utc);
    expect(offset).toBe("2026-10-12T03:30:00.000Z");
  });

  it("keeps the original offset available when a raw instant is parsed", () => {
    const raw = rawInstantSchema.parse("2026-10-12T09:00:00+05:30");
    expect(raw).toBe("2026-10-12T09:00:00+05:30");
  });

  it("rejects an instant without a zone", () => {
    expect(rawInstantSchema.safeParse("2026-10-12T09:00:00").success).toBe(false);
  });

  it("rejects an impossible calendar date", () => {
    expect(rawInstantSchema.safeParse("2026-02-30T09:00:00Z").success).toBe(false);
  });

  it("rejects an out of range offset", () => {
    expect(rawInstantSchema.safeParse("2026-10-12T09:00:00+25:00").success).toBe(false);
  });
});

describe("v2 local dates in Asia/Kolkata", () => {
  it("keeps the intended local date across a midnight rollover", () => {
    // 18:30 UTC on the 12th is 00:00 on the 13th in Kolkata.
    const instant = instantSchema.parse("2026-10-12T18:30:00Z");
    expect(localDateInZone(instant, "Asia/Kolkata")).toBe("2026-10-13");
  });

  it("keeps the intended local date before the rollover", () => {
    const instant = instantSchema.parse("2026-10-12T18:29:00Z");
    expect(localDateInZone(instant, "Asia/Kolkata")).toBe("2026-10-12");
  });

  it("exposes the same behavior through a schema", () => {
    expect(
      localDateInZoneSchema.parse({
        instant: "2026-10-12T18:30:00Z",
        timezone: "Asia/Kolkata",
      }),
    ).toBe("2026-10-13");
  });

  it("rejects an unknown timezone", () => {
    expect(() => localDateInZone("2026-10-12T18:30:00Z", "Mars/Olympus")).toThrow();
  });
});

describe("v2 schedule windows", () => {
  it("normalizes both ends of a window and keeps the timezone", () => {
    const window = windowSchema.parse({
      start: "2026-10-12T09:00:00+05:30",
      end: "2026-10-12T10:30:00+05:30",
      timezone: "Asia/Kolkata",
    });
    expect(window.start).toBe("2026-10-12T03:30:00.000Z");
    expect(window.end).toBe("2026-10-12T05:00:00.000Z");
    expect(window.timezone).toBe("Asia/Kolkata");
  });

  it("rejects a window whose end is not after its start", () => {
    expect(
      windowSchema.safeParse({
        start: "2026-10-12T09:00:00Z",
        end: "2026-10-12T09:00:00Z",
        timezone: "Asia/Kolkata",
      }).success,
    ).toBe(false);
  });
});

describe("v2 billing units", () => {
  it("accepts only KG and PIECE", () => {
    expect(billingUnitSchema.parse("KG")).toBe("KG");
    expect(billingUnitSchema.parse("PIECE")).toBe("PIECE");
    expect(billingUnitSchema.safeParse("LITRE").success).toBe(false);
  });

  it("requires a weight and forbids piece fields on a KG line", () => {
    const ok = requestedLineSchema.safeParse({
      serviceId: SERVICE_ID,
      billingUnit: "KG",
      estimatedWeightGrams: 5000,
    });
    expect(ok.success).toBe(true);

    const missingWeight = requestedLineSchema.safeParse({
      serviceId: SERVICE_ID,
      billingUnit: "KG",
    });
    expect(missingWeight.success).toBe(false);

    const mixed = requestedLineSchema.safeParse({
      serviceId: SERVICE_ID,
      billingUnit: "KG",
      estimatedWeightGrams: 5000,
      pieceQuantity: 2,
    });
    expect(mixed.success).toBe(false);
  });

  it("requires a piece count and a garment on a PIECE line", () => {
    const ok = requestedLineSchema.safeParse({
      serviceId: SERVICE_ID,
      billingUnit: "PIECE",
      garmentTypeId: GARMENT_ID,
      pieceQuantity: 3,
    });
    expect(ok.success).toBe(true);

    const missingGarment = requestedLineSchema.safeParse({
      serviceId: SERVICE_ID,
      billingUnit: "PIECE",
      pieceQuantity: 3,
    });
    expect(missingGarment.success).toBe(false);

    const withWeight = requestedLineSchema.safeParse({
      serviceId: SERVICE_ID,
      billingUnit: "PIECE",
      garmentTypeId: GARMENT_ID,
      pieceQuantity: 3,
      estimatedWeightGrams: 3000,
    });
    expect(withWeight.success).toBe(false);
  });

  it("keeps a declared garment count separate from the price quantity", () => {
    const line = requestedLineSchema.parse({
      serviceId: SERVICE_ID,
      billingUnit: "PIECE",
      garmentTypeId: GARMENT_ID,
      pieceQuantity: 3,
      declaredGarmentCount: 4,
    });
    expect(line.pieceQuantity).toBe(3);
    expect(line.declaredGarmentCount).toBe(4);
  });

  it("detects a mixed unit basket", () => {
    const lines = [
      { serviceId: SERVICE_ID, billingUnit: "KG" as const, estimatedWeightGrams: 4000 },
      {
        serviceId: SERVICE_ID,
        billingUnit: "PIECE" as const,
        garmentTypeId: GARMENT_ID,
        pieceQuantity: 2,
      },
    ];
    expect(isMixedUnitBasket(lines)).toBe(true);
    expect(isMixedUnitBasket([lines[0]])).toBe(false);
  });
});

describe("v2 quote input", () => {
  const base = {
    addressId: ADDRESS_ID,
    pickupWindow: {
      start: "2026-10-12T09:00:00+05:30",
      end: "2026-10-12T10:00:00+05:30",
      timezone: "Asia/Kolkata",
    },
    requestedReturnBy: "2026-10-14T18:00:00+05:30",
    timezone: "Asia/Kolkata",
  };

  it("round-trips a quote request that carries a +05:30 offset", () => {
    const parsed = quoteInputSchema.parse({
      ...base,
      lines: [
        { serviceId: SERVICE_ID, billingUnit: "KG", estimatedWeightGrams: 7500 },
        {
          serviceId: SERVICE_ID,
          billingUnit: "PIECE",
          garmentTypeId: GARMENT_ID,
          pieceQuantity: 4,
        },
      ],
    });
    expect(parsed.pickupWindow.start).toBe("2026-10-12T03:30:00.000Z");
    expect(parsed.requestedReturnBy).toBe("2026-10-14T12:30:00.000Z");
    expect(parsed.lines).toHaveLength(2);
  });

  it("rejects a quote request with no lines", () => {
    expect(quoteInputSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
  });

  it("rejects a line that mixes a weight with a piece count", () => {
    expect(
      quoteInputSchema.safeParse({
        ...base,
        lines: [
          {
            serviceId: SERVICE_ID,
            billingUnit: "KG",
            estimatedWeightGrams: 1000,
            pieceQuantity: 1,
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("v2 money and rates", () => {
  it("keeps amounts in integer minor units", () => {
    const line = quoteLineSchema.parse({
      serviceId: SERVICE_ID,
      billingUnit: "PIECE",
      garmentTypeId: GARMENT_ID,
      pieceQuantity: 2,
      unitPriceMinor: 4999,
      lineTotalMinor: 9998,
      provisional: false,
    });
    expect(line.unitPriceMinor).toBe(4999);
    expect(line.lineTotalMinor).toBe(9998);
    expect(Number.isInteger(line.lineTotalMinor)).toBe(true);
  });

  it("marks a synthetic rate summary as synthetic", () => {
    const summary = effectiveRateSummarySchema.parse({
      serviceCode: "WASH_FOLD",
      billingUnit: "KG",
      unitPriceMinor: 4500,
      unitLabel: "per kg",
      synthetic: true,
    });
    expect(summary.synthetic).toBe(true);
  });
});

describe("v2 catalog codes", () => {
  it("accepts exactly the four service codes", () => {
    expect(serviceCodeSchema.options).toEqual([
      "WASH_FOLD",
      "WASH_PRESS",
      "PRESS_ONLY",
      "DRY_CLEAN",
    ]);
  });
});

describe("v2 errors and actors", () => {
  it("maps every error code to a status and a retry flag", () => {
    for (const code of errorEnvelopeSchema.shape.code.options) {
      expect(errorHttpStatus[code]).toBeGreaterThanOrEqual(400);
      expect(typeof errorRetryable[code]).toBe("boolean");
    }
  });

  it("carries a current version on a version conflict", () => {
    const envelope = errorEnvelopeSchema.parse({
      code: "VERSION_CONFLICT",
      message: "stale order version",
      retryable: false,
      traceId: "trace-1",
      currentVersion: 4,
    });
    expect(envelope.currentVersion).toBe(4);
  });

  it("requires a server derived actor scope", () => {
    const actor = actorSchema.parse({
      id: "33333333-3333-4333-8333-333333333333",
      role: "RIDER",
      facilityIds: [],
      scope: { facilityIds: [] },
    });
    expect(actor.role).toBe("RIDER");
  });
});

describe("v2 booking, adjustment and custody", () => {
  it("records the payment model on a booking", () => {
    const booking = bookingInputSchema.parse({
      quoteId: "44444444-4444-4444-8444-444444444444",
      expectedVersion: 1,
      paymentModel: "DUE_AT_RETURN",
    });
    expect(booking.paymentModel).toBe("DUE_AT_RETURN");
  });

  it("binds an adjustment decision to the adjustment version", () => {
    const decision = adjustmentDecisionSchema.parse({
      adjustmentId: "55555555-5555-4555-8555-555555555555",
      adjustmentVersion: 2,
      expectedVersion: 4,
      decision: "ACCEPT",
    });
    expect(decision.adjustmentVersion).toBe(2);
  });

  it("surfaces estimated, measured, sealed and due amounts on one receipt", () => {
    const receipt = custodyReceiptSchema.parse({
      orderId: "66666666-6666-4666-8666-666666666666",
      estimatedQuantity: 10,
      declaredGarmentCount: 10,
      countedQuantity: 10,
      measuredWeightGrams: 7200,
      sealedContainerCount: 2,
      amountDueAtReturnMinor: 149900,
      currency: "INR",
      currentHandoff: "IN_CARE",
      updatedAt: "2026-10-13T04:00:00.000Z",
    });
    expect(receipt.estimatedQuantity).toBe(10);
    expect(receipt.measuredWeightGrams).toBe(7200);
    expect(receipt.sealedContainerCount).toBe(2);
    expect(receipt.amountDueAtReturnMinor).toBe(149900);
  });
});
