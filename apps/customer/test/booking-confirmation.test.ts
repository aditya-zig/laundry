import { describe, expect, it } from "vitest";
import { canConfirmBooking, isQuoteExpired } from "../src/guards";

const now = "2026-10-25T10:00:00.000Z";
describe("booking confirmation after expiry", () => {
  it("allows only a retained unknown original outcome to reconcile expired terms", () => {
    const expiry = "2026-10-25T09:59:59.000Z";
    expect(canConfirmBooking(expiry, false, now)).toBe(false);
    expect(canConfirmBooking(expiry, true, now)).toBe(true);
    expect(canConfirmBooking("2026-10-25T10:00:01.000Z", false, now)).toBe(true);
  });
  it("fails closed for invalid timestamps", () => {
    expect(isQuoteExpired("not a date", now)).toBe(true);
    expect(canConfirmBooking("not a date", true, now)).toBe(false);
    expect(canConfirmBooking(now, false, "invalid")).toBe(false);
  });
});
