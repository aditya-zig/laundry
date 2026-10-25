import { describe, expect, it } from "vitest";
import { v2 } from "@laundry/contracts";
import { buildBookingInput, buildQuoteInput, buildSlotQuery, nextSignInPrompt } from "./checkout-flow";

const pair: v2.SlotPair = {
  id: "11111111-1111-4111-8111-111111111111",
  pickupWindow: {
    start: "2026-10-28T03:30:00.000Z",
    end: "2026-10-28T05:30:00.000Z",
    timezone: "Asia/Kolkata",
  },
  returnWindow: {
    start: "2026-10-30T09:30:00.000Z",
    end: "2026-10-30T12:30:00.000Z",
    timezone: "Asia/Kolkata",
  },
  available: true,
};

describe("buildSlotQuery", () => {
  it("searches one week of server slot pairs and keeps one entry per service", () => {
    const now = new Date("2026-10-25T10:00:00.000Z");
    const query = buildSlotQuery({ areaId: "22222222-2222-4222-8222-222222222222", now, serviceIds: ["a", "a", "b"] });
    expect(query).toEqual({
      areaId: "22222222-2222-4222-8222-222222222222",
      from: now.toISOString(),
      to: new Date("2026-11-01T10:00:00.000Z").toISOString(),
      serviceIds: ["a", "b"],
    });
  });

  it("refuses to ask the server about an empty bag", () => {
    expect(() => buildSlotQuery({ areaId: "x", now: new Date(), serviceIds: [] })).toThrow();
  });
});

describe("buildQuoteInput", () => {
  it("uses the server slot pair windows and never a typed schedule", () => {
    const input = buildQuoteInput({
      addressId: "33333333-3333-4333-8333-333333333333",
      pair,
      lines: [
        {
          serviceId: "44444444-4444-4444-8444-444444444444",
          billingUnit: "PIECE",
          garmentTypeId: "55555555-5555-4555-8555-555555555555",
          pieceQuantity: 3,
        },
      ],
      timezone: "Asia/Kolkata",
    });
    expect(input).toEqual({
      addressId: "33333333-3333-4333-8333-333333333333",
      lines: [
        {
          serviceId: "44444444-4444-4444-8444-444444444444",
          billingUnit: "PIECE",
          garmentTypeId: "55555555-5555-4555-8555-555555555555",
          pieceQuantity: 3,
        },
      ],
      pickupWindow: pair.pickupWindow,
      requestedReturnBy: "2026-10-30T12:30:00.000Z",
      timezone: "Asia/Kolkata",
    });
  });

  it("rejects an empty bag rather than sending a degenerate quote", () => {
    expect(() =>
      buildQuoteInput({ addressId: "x", pair, lines: [], timezone: "Asia/Kolkata" }),
    ).toThrow();
  });
});

describe("buildBookingInput", () => {
  it("retains the quoted version and pins due-at-return payment", () => {
    const quote = {
      id: "66666666-6666-4666-8666-666666666666",
      version: 4,
    } as unknown as v2.Quote;
    expect(buildBookingInput(quote)).toEqual({
      quoteId: "66666666-6666-4666-8666-666666666666",
      expectedVersion: 4,
      paymentModel: "DUE_AT_RETURN",
    });
  });
});

describe("nextSignInPrompt", () => {
  it("asks for the code only for valid E.164 phones", () => {
    expect(nextSignInPrompt("+919876543210")).toEqual({ step: "CODE" });
    const invalid = nextSignInPrompt("98765");
    if (invalid.step !== "PHONE") throw new Error("expected the phone step for an invalid number");
    expect(invalid.reason).toContain("+");
  });
});
