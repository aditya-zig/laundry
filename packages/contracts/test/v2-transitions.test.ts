import { describe, expect, it } from "vitest";
import { orderStatusSchema } from "../src/v2/orders.js";
import { attemptStatusSchema, refundStatusSchema } from "../src/v2/billing.js";
import { legAttemptStatusSchema } from "../src/v2/logistics.js";
import { draftStateSchema } from "../src/v2/conversations.js";
import { deriveObligationStatus, guardOrderCommand, assertPaymentAttemptTransition, assertRefundAllowed, assertRefundTransition, assertLegTransition, assertDraftConfirmation, ORDER_TRANSITIONS, PAYMENT_ATTEMPT_TRANSITIONS, REFUND_TRANSITIONS, LEG_TRANSITIONS, DRAFT_TRANSITIONS } from "../src/v2/transitions.js";
const id = "00000000-0000-4000-8000-000000000001";
const quoteId = "00000000-0000-4000-8000-000000000002";

describe("order commands with trusted operational evidence", () => {
  it("rejects stale versions before care changes", () => {
    expect(() => guardOrderCommand({ status: "AT_FACILITY", version: 2 }, { type: "START_CARE", expectedVersion: 1 }, { facilityIntakeAccepted: true })).toThrow(/version/i);
  });
  it("requires facility intake rather than a courier's pickup completion", () => {
    expect(() => guardOrderCommand({ status: "PICKUP_PENDING", version: 1 }, { type: "RECORD_INTAKE", expectedVersion: 1 }, {})).toThrow(/intake/i);
    expect(guardOrderCommand({ status: "PICKUP_PENDING", version: 1 }, { type: "RECORD_INTAKE", expectedVersion: 1 }, { facilityIntakeAccepted: true }).status).toBe("AT_FACILITY");
  });
  it("holds higher measured totals until exact adjustment consent", () => {
    const order = { status: "AT_FACILITY" as const, version: 1, adjustmentState: "PROPOSED" as const };
    expect(() => guardOrderCommand(order, { type: "START_CARE", expectedVersion: 1 }, { facilityIntakeAccepted: true })).toThrow(/adjustment/i);
    expect(guardOrderCommand({ ...order, adjustmentState: "ACCEPTED" }, { type: "START_CARE", expectedVersion: 1 }, { facilityIntakeAccepted: true }).status).toBe("IN_CARE");
  });
  it("does not allow RESUME to bypass a declined adjustment", () => {
    expect(() => guardOrderCommand({ status: "ON_HOLD", version: 1, resumeStatus: "IN_CARE", adjustmentState: "DECLINED" }, { type: "RESUME", expectedVersion: 1, reason: "Synthetic override" }, { facilityIntakeAccepted: true })).toThrow(/adjustment/i);
  });
  it("requires a passed quality check before return readiness", () => {
    expect(() => guardOrderCommand({ status: "QUALITY_CHECK", version: 1 }, { type: "PASS_QUALITY_CHECK", expectedVersion: 1 }, { facilityIntakeAccepted: true })).toThrow(/quality/i);
  });
  it("never turns pickup proof or unpaid return into delivery", () => {
    const order = { status: "RETURNING" as const, version: 1 };
    const command = { type: "COMPLETE_RETURN" as const, expectedVersion: 1 };
    expect(() => guardOrderCommand(order, command, { leg: "PICKUP", custodyAccepted: true, paymentSettled: true })).toThrow(/return/i);
    expect(() => guardOrderCommand(order, command, { leg: "RETURN", custodyAccepted: true })).toThrow(/payment/i);
    expect(guardOrderCommand(order, command, { leg: "RETURN", custodyAccepted: true, paymentSettled: true }).status).toBe("DELIVERED");
  });
  it("accepts an audited zero-due return without inventing a payment", () => {
    const order = { status: "RETURNING" as const, version: 1 };
    const command = { type: "COMPLETE_RETURN" as const, expectedVersion: 1 };
    expect(guardOrderCommand(order, command, { leg: "RETURN", custodyAccepted: true, amountRemainingMinor: 0, zeroDueResolution: { auditId: id, reason: "Founder agreed unprocessed return" } }).status).toBe("DELIVERED");
    expect(() => guardOrderCommand(order, command, { leg: "RETURN", custodyAccepted: true, amountRemainingMinor: 100, zeroDueResolution: { auditId: id, reason: "Override" } })).toThrow(/payment/i);
  });
  it("follows the ordinary care and return path with all trusted evidence", () => {
    const evidence = { facilityIntakeAccepted: true, qualityCheckPassed: true, returnAssignmentActive: true };
    expect(guardOrderCommand({ status: "CONFIRMED", version: 1 }, { type: "MARK_PICKUP_PENDING", expectedVersion: 1 }, {}).status).toBe("PICKUP_PENDING");
    expect(guardOrderCommand({ status: "IN_CARE", version: 1 }, { type: "START_QUALITY_CHECK", expectedVersion: 1 }, evidence).status).toBe("QUALITY_CHECK");
    expect(guardOrderCommand({ status: "QUALITY_CHECK", version: 1 }, { type: "PASS_QUALITY_CHECK", expectedVersion: 1 }, evidence).status).toBe("READY_FOR_RETURN");
    expect(guardOrderCommand({ status: "READY_FOR_RETURN", version: 1 }, { type: "START_RETURN", expectedVersion: 1 }, evidence).status).toBe("RETURNING");
  });
  it("requires higher measured totals and exact live adjustment versions", () => {
    expect(guardOrderCommand({ status: "AT_FACILITY", version: 1 }, { type: "PROPOSE_ADJUSTMENT", expectedVersion: 1, previousTotalMinor: 100, newTotalMinor: 110, reason: "Measured increase" }, { facilityIntakeAccepted: true }).status).toBe("AWAITING_ADJUSTMENT");
    const order = { status: "AWAITING_ADJUSTMENT" as const, version: 2, adjustmentState: "PROPOSED" as const, adjustment: { id, version: 3, expiresAt: "2026-10-22T06:00:00Z" } };
    const command = { type: "DECIDE_ADJUSTMENT" as const, expectedVersion: 2, now: "2026-10-22T05:00:00Z", decision: { adjustmentId: id, adjustmentVersion: 3, expectedVersion: 2, decision: "ACCEPT" as const } };
    expect(guardOrderCommand(order, command, { facilityIntakeAccepted: true }).status).toBe("AT_FACILITY");
    expect(() => guardOrderCommand(order, { ...command, decision: { ...command.decision, adjustmentVersion: 2 } }, {})).toThrow(/version/i);
    expect(() => guardOrderCommand(order, { ...command, now: order.adjustment.expiresAt }, {})).toThrow(/expired/i);
    expect(guardOrderCommand(order, { ...command, decision: { ...command.decision, decision: "DECLINE" } }, {})).toEqual({ status: "ON_HOLD", resumeStatus: "AT_FACILITY" });
  });
  it("records and rechecks the original resume state and prohibits terminal reopening", () => {
    expect(guardOrderCommand({ status: "IN_CARE", version: 1 }, { type: "HOLD", expectedVersion: 1, reason: "Machine unavailable" }, {})).toEqual({ status: "ON_HOLD", resumeStatus: "IN_CARE" });
    expect(() => guardOrderCommand({ status: "ON_HOLD", version: 1, resumeStatus: "DELIVERED" }, { type: "RESUME", expectedVersion: 1, reason: "Override" }, {})).toThrow();
    expect(() => guardOrderCommand({ status: "DELIVERED", version: 1 }, { type: "HOLD", expectedVersion: 1, reason: "Override" }, {})).toThrow(/terminal/i);
    expect(guardOrderCommand({ status: "QUALITY_CHECK", version: 1 }, { type: "REWORK", expectedVersion: 1, reason: "Failed inspection" }, { facilityIntakeAccepted: true }).status).toBe("IN_CARE");
  });
  it("does not cancel before logistics, capacity, care, custody and money are resolved", () => {
    expect(() => guardOrderCommand({ status: "CANCEL_REQUESTED", version: 1 }, { type: "CONFIRM_CANCEL", expectedVersion: 1, reason: "Customer request" }, { logisticsCancelled: true })).toThrow(/reconcil/i);
    expect(guardOrderCommand({ status: "CANCEL_REQUESTED", version: 1 }, { type: "CONFIRM_CANCEL", expectedVersion: 1, reason: "Agreed cancellation" }, { logisticsCancelled: true, capacityReleased: true, careStopped: true, custodyResolved: true, financialResolutionRecorded: true }).status).toBe("CANCELLED");
  });
});

describe("independent money and delivery state", () => {
  it("derives balances without labeling an unprocessed zero-due obligation captured", () => {
    expect(deriveObligationStatus({ amountDueMinor: 100, amountSettledMinor: 0 })).toBe("OPEN");
    expect(deriveObligationStatus({ amountDueMinor: 100, amountSettledMinor: 50 })).toBe("PARTIALLY_SETTLED");
    expect(deriveObligationStatus({ amountDueMinor: 100, amountSettledMinor: 100 })).toBe("SETTLED");
    expect(deriveObligationStatus({ amountDueMinor: 0, amountSettledMinor: 0 })).toBe("OPEN");
    expect(deriveObligationStatus({ amountDueMinor: 0, amountSettledMinor: 0, voidResolution: { auditId: id, reason: "Agreed zero due" } })).toBe("VOID");
  });
  it("keeps late authoritative success without regressing received money", () => {
    expect(() => assertPaymentAttemptTransition("FAILED", "SUCCEEDED", { authoritativeSuccess: true })).not.toThrow();
    expect(() => assertPaymentAttemptTransition("EXPIRED", "SUCCEEDED", {})).toThrow();
    expect(() => assertPaymentAttemptTransition("SUCCEEDED", "FAILED", {})).toThrow();
  });
  it("reserves concurrent refund attempts within captured money", () => {
    expect(() => assertRefundAllowed({ capturedMinor: 100, refundedMinor: 40, pendingMinor: 30, requestedMinor: 31 })).toThrow();
    expect(() => assertRefundAllowed({ capturedMinor: 100, refundedMinor: 40, pendingMinor: 30, requestedMinor: 30 })).not.toThrow();
    expect(() => assertRefundAllowed({ capturedMinor: Number.MAX_SAFE_INTEGER + 1, refundedMinor: 0, pendingMinor: 0, requestedMinor: 1 })).toThrow();
  });
  it("reconciles uncertain refunds and bookings before retry or reassignment", () => {
    expect(() => assertRefundTransition("OUTCOME_UNKNOWN", "PROCESSING", {})).toThrow(/reconcile/i);
    expect(() => assertRefundTransition("OUTCOME_UNKNOWN", "PROCESSING", { reconciledBeforeRetry: true })).not.toThrow();
    expect(() => assertRefundTransition("PROCESSING", "SUCCEEDED", {})).toThrow();
    expect(() => assertRefundTransition("FAILED", "SUCCEEDED", { authoritativeSuccess: true })).not.toThrow();
    expect(() => assertLegTransition("BOOKING_UNKNOWN", "BOOKED", {})).toThrow(/reconcil/i);
    expect(() => assertLegTransition("BOOKING_UNKNOWN", "BOOKED", { bookingReconciled: true })).not.toThrow();
    expect(() => assertLegTransition("CANCEL_REQUESTED", "CANCELLED", {})).toThrow();
    expect(() => assertLegTransition("CANCEL_REQUESTED", "CANCELLED", { cancellationConfirmed: true })).not.toThrow();
  });
  it("requires verified custody on either completed leg and prevents terminal regression", () => {
    expect(() => assertLegTransition("IN_TRANSIT", "COMPLETED", { proofVerified: false })).toThrow();
    expect(() => assertLegTransition("IN_TRANSIT", "COMPLETED", { proofVerified: true })).not.toThrow();
    expect(() => assertLegTransition("COMPLETED", "BOOKED", { proofVerified: true })).toThrow();
  });
});

describe("complete independent transition vocabularies", () => {
  it("covers each schema state and keeps terminal graphs closed", () => {
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...orderStatusSchema.options].sort());
    expect(Object.keys(PAYMENT_ATTEMPT_TRANSITIONS).sort()).toEqual([...attemptStatusSchema.options].sort());
    expect(Object.keys(REFUND_TRANSITIONS).sort()).toEqual([...refundStatusSchema.options].sort());
    expect(Object.keys(LEG_TRANSITIONS).sort()).toEqual([...legAttemptStatusSchema.options].sort());
    expect(Object.keys(DRAFT_TRANSITIONS).sort()).toEqual([...draftStateSchema.options].sort());
    expect(ORDER_TRANSITIONS.DELIVERED).toEqual([]);
    expect(PAYMENT_ATTEMPT_TRANSITIONS.SUCCEEDED).toEqual([]);
    expect(REFUND_TRANSITIONS.SUCCEEDED).toEqual([]);
    expect(LEG_TRANSITIONS.COMPLETED).toEqual([]);
    expect(DRAFT_TRANSITIONS.BOOKING_CREATED).toEqual([]);
  });
});

describe("conversation confirmation", () => {
  const draft = { draftId: id, revision: 2, state: "QUOTED" as const, fields: [], quoteId, quoteVersion: 3, expiresAt: "2026-10-22T06:00:00Z", missingFields: [] };
  const confirmation = { draftId: id, revision: 2, quoteId, quoteVersion: 3 };
  const quote = { id: quoteId, version: 3, expiresAt: "2026-10-22T05:10:00Z" };
  it("binds confirmation to current draft revision and quote version", () => {
    expect(() => assertDraftConfirmation({ draft, confirmation, quote, now: "2026-10-22T05:00:00Z" })).not.toThrow();
    expect(() => assertDraftConfirmation({ draft, confirmation: { ...confirmation, revision: 1 }, quote, now: "2026-10-22T05:00:00Z" })).toThrow();
    expect(() => assertDraftConfirmation({ draft, confirmation: { ...confirmation, quoteVersion: 2 }, quote, now: "2026-10-22T05:00:00Z" })).toThrow();
  });
  it("checks quote expiry even when the draft is not expired", () => {
    expect(() => assertDraftConfirmation({ draft, confirmation, quote, now: "2026-10-22T05:10:00Z" })).toThrow(/expired/i);
  });
});
