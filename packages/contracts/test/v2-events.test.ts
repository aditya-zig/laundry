import { describe, expect, it } from "vitest";
import { v2 } from "../src/index.js";
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const at = "2026-10-22T05:00:00Z";
const attempt = { id, legId: other, orderId: id, leg: "PICKUP", version: 1, status: "COMPLETED", attemptNumber: 1, startedAt: at, completedAt: at };

describe("v2 event semantics", () => {
  it("refuses pickup completion as evidence of order delivery", () => {
    expect(v2.orderDeliveredPayloadSchema.safeParse({ orderId: id, deliveredAt: at, legAttempt: attempt }).success).toBe(false);
    expect(v2.orderDeliveredPayloadSchema.safeParse({ orderId: id, deliveredAt: at, legAttempt: { ...attempt, leg: "RETURN" } }).success).toBe(true);
  });

  it("requires a completed return for the same order", () => {
    for (const legAttempt of [{ ...attempt, leg: "RETURN", status: "IN_TRANSIT", completedAt: undefined }, { ...attempt, leg: "RETURN", orderId: other }]) {
      expect(v2.orderDeliveredPayloadSchema.safeParse({ orderId: id, deliveredAt: at, legAttempt }).success).toBe(false);
    }
  });

  it("does not announce settlement for an open or void obligation", () => {
    const obligation = { id, orderId: id, status: "OPEN", amountDueMinor: 100, amountSettledMinor: 0, currency: "INR", paymentModel: "DUE_AT_RETURN", dueAt: at, version: 1 };
    const receipt = { id: other, obligationId: id, amountMinor: 100, currency: "INR", method: "CASH", confirmedBy: id, confirmedVia: "MANUAL_CASH", issuedAt: at };
    expect(v2.paymentSettledPayloadSchema.safeParse({ obligation, receipt }).success).toBe(false);
    expect(v2.paymentSettledPayloadSchema.safeParse({ obligation: { ...obligation, status: "SETTLED", amountSettledMinor: 100 }, receipt }).success).toBe(true);
    expect(v2.paymentSettledPayloadSchema.safeParse({ obligation: { ...obligation, status: "VOID", amountDueMinor: 0, voidReason: "Agreed zero-due return" }, receipt }).success).toBe(false);
    expect(v2.paymentSettledPayloadSchema.safeParse({ obligation: { ...obligation, status: "SETTLED", amountSettledMinor: 100 }, receipt: { ...receipt, obligationId: other } }).success).toBe(false);
  });

  it("matches event discriminators to their payload and aggregate identity", () => {
    const event = { eventId: other, eventType: "delivery.updated.v2", schemaVersion: 2, aggregateId: id, aggregateVersion: 1, occurredAt: at, traceId: other, payload: { legAttempt: attempt } };
    expect(v2.domainEventSchema.safeParse(event).success).toBe(true);
    expect(v2.domainEventSchema.safeParse({ ...event, aggregateId: other }).success).toBe(false);
    expect(v2.domainEventSchema.safeParse({ ...event, eventType: "media.uploaded.v2" }).success).toBe(false);
  });
});
