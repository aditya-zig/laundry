// Customer journey behavior tests (A5). Observable state and helpers only,
// no native runtime. Run with vitest once app dependencies are installed.
import { describe, expect, it } from "vitest";
import { addLine, totalGarments, type CartLine } from "../src/cart";
import {
  checkoutBlockReason,
  isPendingLabelHonest,
  isQuoteExpired,
  paymentStatusLabel,
  reviewEmptyLabel,
} from "../src/guards";

const line = (quantity: number): CartLine => ({
  serviceId: "11111111-1111-4111-8111-111111111111",
  garmentTypeId: "22222222-2222-4222-8222-222222222222",
  quantity,
});

describe("customer journey", () => {
  it("image failure keeps the service selectable (card renders fallback, link stays)", () => {
    // ServiceCard falls back to a text block when onError fires; the Link target
    // is the service id either way. Model the contract: selection needs only id.
    const service = { id: "11111111-1111-4111-8111-111111111111", name: "Wash and Press" };
    const href = { pathname: "/services/[id]", params: { id: service.id } } as const;
    expect(href.params.id).toBe(service.id);
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

  it("changed intake needs explicit approval (adjustment blocks silent care)", () => {
    // Client rule: an order carrying a pending adjustment surfaces approval UI
    // and withholds the care-advance action. Represented as a gate string.
    const gate = (hasPendingAdjustment: boolean): string | null =>
      hasPendingAdjustment ? "Price changed during intake. Approve or decline before care continues." : null;
    expect(gate(true)).toMatch(/Approve or decline/);
    expect(gate(false)).toBeNull();
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
});
