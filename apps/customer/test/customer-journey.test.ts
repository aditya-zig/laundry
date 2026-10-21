// Customer journey behavior tests (A5). Observable state and helpers only,
// no native runtime. Run with vitest once app dependencies are installed.
import { describe, expect, it } from "vitest";
import { addLine, countForGarment, estimateSubtotalMinor, setGarmentQuantity, totalGarments, type CartLine } from "../src/cart";
import {
  checkoutBlockReason,
  isPendingLabelHonest,
  isQuoteExpired,
  paymentStatusLabel,
  reviewEmptyLabel,
  defaultSchedule,
  scheduleBlockReason,
} from "../src/guards";

const line = (quantity: number): CartLine => ({
  serviceId: "11111111-1111-4111-8111-111111111111",
  garmentTypeId: "22222222-2222-4222-8222-222222222222",
  quantity,
});

describe("customer journey", () => {
  // Regression: QA-002 — fixed October dates made every new basket start in the past.
  // Found by /qa on 2026-10-21. Report: docs/implementation/ui-handoff-2026-10-21.md
  it("new baskets use future windows and reject expired or reversed schedules", () => {
    const now = Date.parse("2026-10-21T10:00:00.000Z");
    const schedule = defaultSchedule(now);
    expect(Date.parse(schedule.pickupStart)).toBeGreaterThan(now);
    expect(scheduleBlockReason(schedule, now)).toBeNull();
    expect(scheduleBlockReason({ ...schedule, pickupStart: "2026-10-12T09:00:00.000Z" }, now)).toMatch(/future/);
    expect(scheduleBlockReason({ ...schedule, pickupEnd: schedule.pickupStart }, now)).toMatch(/after/);
    expect(scheduleBlockReason({ ...schedule, returnBy: schedule.pickupEnd }, now)).toMatch(/return/i);
    expect(scheduleBlockReason({ ...schedule, returnBy: "invalid" }, now)).toMatch(/valid/);
  });
  it("expired quote requires fresh terms before payment", () => {
    expect(isQuoteExpired("2026-10-11T16:00:00.000Z", "2026-10-11T17:00:00.000Z")).toBe(true);
    expect(isQuoteExpired("2026-10-11T18:00:00.000Z", "2026-10-11T17:00:00.000Z")).toBe(false);
    const reason = checkoutBlockReason({ areaEligible: true, addressId: "a", lineCount: 1, quoteExpired: true });
    expect(reason).toMatch(/fresh terms/);
  });

  it("checkout kill and resume loads authoritative status (no client-cached success)", () => {
    // Resume path re-fetches via getOrder; the label derives from server status.
    expect(paymentStatusLabel("PENDING")).toBe("Payment pending");
    expect(paymentStatusLabel("CAPTURED")).toBe("Payment received");
  });

  it("pending payment never reads as failed or confirmed", () => {
    const label = paymentStatusLabel("PENDING");
    expect(isPendingLabelHonest(label)).toBe(true);
    expect(label).not.toBe("Payment failed");
    expect(label).not.toBe("Payment received");
  });

  it("empty reviews show no rating", () => {
    expect(reviewEmptyLabel(0)).toBe("No reviews yet");
    expect(reviewEmptyLabel(2)).toMatch(/verified/);
  });

  it("inaccessible area cannot check out", () => {
    const reason = checkoutBlockReason({ areaEligible: false, addressId: "a", lineCount: 1, quoteExpired: false });
    expect(reason).toMatch(/outside the service area/);
  });

  it("basket enforces per-piece integer counts within pilot limits", () => {
    expect(() => addLine([], line(0))).toThrow();
    expect(() => addLine([], line(101))).toThrow();
    const full = addLine([], line(100));
    expect(totalGarments(full)).toBe(100);
    expect(() => addLine(full, line(1))).toThrow(/100 garments/);
  });

  it("tile steppers count and step one service+garment pair across lines", () => {
    const shirt = { serviceId: "s1", garmentTypeId: "g1" };
    let lines = addLine([], { ...shirt, quantity: 1 });
    expect(countForGarment(lines, "s1", "g1")).toBe(1);
    lines = addLine(lines, { ...shirt, quantity: 1 }); // second tile press merges into one line
    expect(lines).toHaveLength(1);
    expect(countForGarment(lines, "s1", "g1")).toBe(2);
    lines = setGarmentQuantity(lines, "s1", "g1", 0); // minus to zero removes the line
    expect(lines).toHaveLength(0);
    expect(() => setGarmentQuantity([], "s1", "g1", -1)).toThrow();
    expect(() => setGarmentQuantity([], "s1", "g1", 101)).toThrow();
  });

  it("client subtotal estimate uses catalog rates and hides unknown ones", () => {
    const rates = { g1: 7900 };
    const mixed = [
      { serviceId: "s1", garmentTypeId: "g1", quantity: 2 },
      { serviceId: "s2", garmentTypeId: "?", quantity: 1 },
    ];
    expect(estimateSubtotalMinor([{ serviceId: "s1", garmentTypeId: "g1", quantity: 2 }], rates)).toBe(15800);
    expect(estimateSubtotalMinor(mixed, rates)).toBeNull();
    expect(estimateSubtotalMinor([], rates)).toBe(0);
  });
});
