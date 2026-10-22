import { describe, expect, it } from "vitest";
import { v2 } from "../src/index.js";
const id = "11111111-1111-4111-8111-111111111111";

describe("v2 command intent", () => {
  it("requires the current quote version and refuses native callers selecting the historical prepaid model", () => {
    expect(v2.bookingInputSchema.safeParse({ quoteId: id, paymentModel: "DUE_AT_RETURN" }).success).toBe(false);
    expect(v2.bookingInputSchema.safeParse({ quoteId: id, expectedVersion: 1, paymentModel: "PREPAID_V1" }).success).toBe(false);
    expect(v2.bookingInputSchema.parse({ quoteId: id, expectedVersion: 1, paymentModel: "DUE_AT_RETURN" })).toHaveProperty("expectedVersion", 1);
  });

  it("binds adjustment consent to both the order and adjustment versions", () => {
    const decision = { adjustmentId: id, adjustmentVersion: 2, decision: "ACCEPT" };
    expect(v2.adjustmentDecisionSchema.safeParse(decision).success).toBe(false);
    expect(v2.adjustmentDecisionSchema.safeParse({ ...decision, expectedVersion: 4 }).success).toBe(true);
  });

  it("rejects monetary values that cannot be represented exactly as integer minor units", () => {
    expect(v2.moneySchema.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
  });

  it("cannot advance care by submitting DELIVERED as a target", () => {
    expect(v2.careUpdateSchema.safeParse({ expectedVersion: 1, target: "DELIVERED" }).success).toBe(false);
  });

  it("keeps manual payment actor, gateway capture and ledger IDs server-owned", () => {
    const input = { expectedVersion: 1, method: "CASH", amountMinor: 100, currency: "INR", reason: "Cash counted" };
    expect(v2.manualPaymentConfirmationSchema.safeParse(input).success).toBe(true);
    for (const forged of [{ confirmedBy: id }, { confirmedVia: "GATEWAY_CAPTURE" }, { id }]) {
      expect(v2.manualPaymentConfirmationSchema.safeParse({ ...input, ...forged }).success).toBe(false);
    }
    expect(v2.manualPaymentConfirmationSchema.safeParse({ ...input, amountMinor: 0 }).success).toBe(false);
    expect(v2.manualPaymentConfirmationSchema.safeParse({ ...input, method: "UPI" }).success).toBe(false);
  });

  it("does not let riders select provider proof or an operator exception", () => {
    const proof = { jobId: id, legAttemptId: id, expectedVersion: 1, actionId: id, method: "CODE", code: "123456", capturedAt: "2026-10-22T10:00:00+05:30", containerIds: [id], garmentCount: 5, condition: "GOOD" };
    expect(v2.riderHandoverSchema.parse(proof).capturedAt).toBe("2026-10-22T04:30:00.000Z");
    for (const method of ["PROVIDER_PROOF", "OPERATOR_EXCEPTION"]) {
      expect(v2.riderHandoverSchema.safeParse({ ...proof, method }).success).toBe(false);
    }
  });

  it("requires an audited explanation when a quality check fails", () => {
    const input = { expectedVersion: 1, passed: false, containers: [{ id, sealed: true, condition: "GOOD", garmentCount: 5 }], mediaIds: [] };
    expect(v2.qualityCheckSchema.safeParse(input).success).toBe(false);
    expect(v2.qualityCheckSchema.safeParse({ ...input, note: "Stain remains" }).success).toBe(true);
  });

  it("rejects duplicate intake inventory and empty measured facts", () => {
    const line = { orderLineId: id, condition: "GOOD" };
    const input = { expectedVersion: 1, lines: [line], containers: [{ id, sealed: true, condition: "GOOD", garmentCount: 5 }], mediaIds: [] };
    expect(v2.intakeRecordSchema.safeParse(input).success).toBe(false);
    const measured = { ...line, countedQuantity: 5 };
    expect(v2.intakeRecordSchema.safeParse({ ...input, lines: [measured, measured] }).success).toBe(false);
  });

  it("requires refund amounts only for refund incident resolutions and refuses client audit actors", () => {
    const input = { expectedVersion: 1, outcome: "REFUND", reason: "Approved missing garment resolution" };
    expect(v2.incidentResolutionInputSchema.safeParse(input).success).toBe(false);
    expect(v2.incidentResolutionInputSchema.safeParse({ ...input, refundAmountMinor: 100 }).success).toBe(true);
    expect(v2.incidentResolutionInputSchema.safeParse({ ...input, refundAmountMinor: 100, decidedBy: id }).success).toBe(false);
  });
});
