import { describe, expect, it } from "vitest";
import { UnknownOutcomeError, V2ApiError } from "@laundry/api-client";
import type { v2 } from "@laundry/contracts";
import { describeError, dueAtReturnCopy, bagHeadline, rateHeadline, unitHeadline } from "./presenters";

const WASH = "11111111-1111-4111-8111-111111111111";

const service = (billingUnit: v2.Service["billingUnit"]): v2.Service => ({
  id: WASH,
  version: 3,
  code: "WASH_FOLD",
  name: "Wash & fold",
  description: "Washed, dried and folded.",
  imageUrl: "https://example.com/wash-fold.png",
  billingUnit,
  turnaroundHours: 24,
  garments: [],
  features: [],
  careExclusions: [],
  active: true,
});

describe("F01-05 presenters", () => {
  it("presents the server rate summary without inventing prices", () => {
    const headline = rateHeadline({
      serviceCode: "WASH_FOLD",
      billingUnit: "KG",
      unitPriceMinor: 7900,
      unitLabel: "per kg",
      weightIncrementGrams: 500,
      minimumBillableGrams: 2000,
      synthetic: false,
    });
    expect(headline.title).toContain("INR 79.00");
    expect(headline.title).toContain("per kg");
    expect(headline.sub).toContain("500 g");
    expect(headline.sub).toContain("2000 g");
    expect(headline.sub).not.toMatch(/indicative/i);
  });

  it("marks synthetic rates as indicative", () => {
    const headline = rateHeadline({
      serviceCode: "DRY_CLEAN",
      billingUnit: "PIECE",
      unitPriceMinor: 30000,
      unitLabel: "per piece",
      synthetic: true,
    });
    expect(headline.title).toContain("INR 300.00");
    expect(headline.sub).toMatch(/indicative/i);
  });

  it("hides billing notes for piece rates", () => {
    const headline = rateHeadline({
      serviceCode: "WASH_FOLD",
      billingUnit: "PIECE",
      unitPriceMinor: 9900,
      unitLabel: "per piece",
      weightIncrementGrams: 500,
      minimumBillableGrams: 2000,
      synthetic: false,
    });
    expect(headline.title).toContain("INR 99.00");
    expect(headline.sub).toBeNull();
  });

  it("names the unit for services without a published rate", () => {
    expect(unitHeadline(service("KG"))).toMatch(/weight/i);
    expect(unitHeadline(service("PIECE"))).toMatch(/piece/i);
    expect(unitHeadline(service("BOTH"))).toMatch(/piece/);
  });

  it("counts bag units honestly", () => {
    expect(bagHeadline(0)).toMatch(/empty/i);
    expect(bagHeadline(1)).toMatch(/1 item/);
    expect(bagHeadline(4)).toMatch(/4 items/);
  });

  it("derives pay-at-return copy from the server payment model", () => {
    const order = {
      id: WASH,
      version: 1,
      status: "CONFIRMED",
      customerId: WASH,
      lines: [],
      totalMinor: 15800,
      currency: "INR",
      paymentModel: "DUE_AT_RETURN",
      pickupWindow: { start: "2026-10-30T03:30:00.000Z", end: "2026-10-30T05:30:00.000Z", timezone: "Asia/Kolkata" },
      promisedReturnWindow: { start: "2026-10-31T04:00:00.000Z", end: "2026-10-31T06:00:00.000Z", timezone: "Asia/Kolkata" },
      createdAt: "2026-10-29T10:00:00.000Z",
      timeline: [],
      containers: [],
      permittedActions: [],
      deliveryLegs: [],
    } as unknown as v2.Order;
    expect(dueAtReturnCopy(order)).toContain("INR 158.00");
    expect(dueAtReturnCopy(order)).toMatch(/returned/i);
  });

  it("maps server error codes to honest copy", () => {
    const envelope = (code: string, message: string, extra: Record<string, unknown> = {}) =>
      new V2ApiError(400, { code: code as never, message, traceId: "t", retryable: false, ...extra }, "key");

    expect(describeError(envelope("QUOTE_EXPIRED", "expired")).body).toMatch(/fresh terms/i);
    const conflict = describeError(envelope("VERSION_CONFLICT", "conflict", { currentVersion: 7 }));
    expect(conflict.body).toContain("7");
    expect(describeError(envelope("RATE_LIMITED", "slow down")).body).toMatch(/wait/i);
    expect(describeError(envelope("UNAUTHENTICATED", "sign in")).body).toMatch(/sign in/i);
    expect(describeError(envelope("NOT_FOUND", "gone")).body).toMatch(/no longer/i);
    expect(describeError(envelope("OUT_OF_AREA", "area")).body).toMatch(/postal code/i);
    expect(describeError(envelope("PROVIDER_UNAVAILABLE", "provider")).body).toMatch(/not set up/i);
    expect(describeError(envelope("INVALID_INPUT", "Check the entered details")).body).toContain("Check the entered details");
  });

  it("keeps unknown booking outcomes honest and safe to retry", () => {
    const copy = describeError(new UnknownOutcomeError("lost", undefined, "key"));
    expect(copy.title).toMatch(/confirm/i);
    expect(copy.body).toMatch(/retry/i);
    expect(copy.body).toMatch(/duplicate/i);
  });

  it("passes through plain error messages", () => {
    expect(describeError(new Error("Network down")).body).toBe("Network down");
    expect(describeError("boom").body).toMatch(/try again/i);
  });
});
