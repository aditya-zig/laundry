// Ops journey behavior tests (A7). Pure helpers only, no DOM.
import { describe, expect, it } from "vitest";
import type { Order } from "@wandary/contracts";
import {
  careBlockedReason,
  catalogPublishBlocked,
  intakeDiscrepancy,
  overrideRequiresReason,
  refundStatusLabel,
  visibleOrders,
} from "../src/guards";

function orderOf(partial: Partial<Order>): Order {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    version: 1,
    status: "CONFIRMED",
    customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    facilityId: "facility-1",
    lines: [],
    totalMinor: 44900,
    currency: "INR",
    pickupWindow: { start: "2026-10-12T09:00:00.000Z", end: "2026-10-12T10:00:00.000Z", timezone: "Asia/Kolkata" },
    promisedReturnWindow: { start: "2026-10-14T09:00:00.000Z", end: "2026-10-14T18:00:00.000Z", timezone: "Asia/Kolkata" },
    createdAt: "2026-10-11T10:00:00.000Z",
    timeline: [],
    paymentStatus: "CAPTURED",
    deliveries: [],
    ...partial,
  };
}

describe("ops journey", () => {
  it("facility cannot see other facility orders", () => {
    const orders = [orderOf({ facilityId: "facility-1" }), orderOf({ facilityId: "facility-2" })];
    expect(visibleOrders(orders, "facility", "facility-1")).toHaveLength(1);
    expect(visibleOrders(orders, "operator")).toHaveLength(2);
  });

  it("care is disabled during unresolved price adjustment", () => {
    const pending = orderOf({
      status: "AWAITING_ADJUSTMENT",
      adjustment: { id: "adj-1", status: "PENDING", deltaMinor: 2000, reason: "Extra weight" },
    });
    expect(careBlockedReason(pending)).toMatch(/awaits the customer/);
    const clear = orderOf({ status: "AT_FACILITY" });
    expect(careBlockedReason(clear)).toBeNull();
  });

  it("overrides require a reason", () => {
    expect(overrideRequiresReason("   ")).toMatch(/reason is required/);
    expect(overrideRequiresReason("Counted 5 shirts")).toBeNull();
  });

  it("refund pending differs from refunded", () => {
    expect(refundStatusLabel("PROCESSING")).toBe("Refund pending");
    expect(refundStatusLabel("SUCCEEDED")).toBe("Refunded");
    expect(refundStatusLabel("SUCCEEDED")).not.toBe("Refund pending");
  });

  it("intake discrepancy remains visible until resolved", () => {
    const o = orderOf({
      adjustment: { id: "adj-1", status: "PENDING", deltaMinor: -1500, reason: "One shirt missing" },
    });
    expect(intakeDiscrepancy(o)).toMatch(/missing/);
    expect(intakeDiscrepancy(orderOf({}))).toBeNull();
  });

  it("draft catalog cannot publish without licensed images and rate data", () => {
    expect(catalogPublishBlocked({})).toMatch(/Licensed service photography/);
    expect(catalogPublishBlocked({ imageUrl: "https://x/y.jpg" })).toMatch(/Licensed service photography/);
    expect(
      catalogPublishBlocked({ imageUrl: "https://x/y.jpg", imageLicense: "lic-1", priceMinor: 7900 }),
    ).toBeNull();
  });
});
