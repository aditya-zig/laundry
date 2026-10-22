import { expectedVersionSchema, idSchema, instantSchema, moneySchema, type ErrorCode } from "./common.js";
import type { OrderStatus, Adjustment, AdjustmentDecision } from "./orders.js";
import type { ObligationStatus, AttemptStatus, RefundStatus } from "./billing.js";
import type { LegAttemptStatus } from "./logistics.js";
import type { ConversationDraft, DraftConfirmation, DraftState } from "./conversations.js";

/** Pure guards consume evidence already verified by the owning module. They do
 * not authenticate actors, verify a custody code, or acquire database locks.
 * Never expose these evidence flags as request DTOs. */
export class TransitionError extends Error {
  constructor(readonly code: ErrorCode, message: string) { super(message); this.name = "TransitionError"; }
}
const requireFact = (condition: unknown, message: string, code: ErrorCode = "INVALID_INPUT"): void => {
  if (!condition) throw new TransitionError(code, message);
};
const hasReason = (reason: string | undefined) => typeof reason === "string" && reason.trim().length > 0;
export interface AuditedResolution { auditId: string; reason: string }
function audited(value: AuditedResolution | undefined): boolean {
  return !!value && idSchema.safeParse(value.auditId).success && hasReason(value.reason);
}

export const ORDER_TRANSITIONS = {
  CONFIRMED: ["PICKUP_PENDING", "CANCEL_REQUESTED", "ON_HOLD", "RESOLUTION_REQUIRED"],
  PICKUP_PENDING: ["AT_FACILITY", "CANCEL_REQUESTED", "ON_HOLD", "RESOLUTION_REQUIRED"],
  AT_FACILITY: ["IN_CARE", "AWAITING_ADJUSTMENT", "CANCEL_REQUESTED", "ON_HOLD", "RESOLUTION_REQUIRED"],
  IN_CARE: ["QUALITY_CHECK", "CANCEL_REQUESTED", "ON_HOLD", "RESOLUTION_REQUIRED"],
  QUALITY_CHECK: ["IN_CARE", "READY_FOR_RETURN", "CANCEL_REQUESTED", "ON_HOLD", "RESOLUTION_REQUIRED"],
  READY_FOR_RETURN: ["RETURNING", "CANCEL_REQUESTED", "ON_HOLD", "RESOLUTION_REQUIRED"],
  RETURNING: ["DELIVERED", "CANCEL_REQUESTED", "ON_HOLD", "RESOLUTION_REQUIRED"],
  DELIVERED: [], CANCELLED: [],
  AWAITING_ADJUSTMENT: ["AT_FACILITY", "ON_HOLD", "CANCEL_REQUESTED", "RESOLUTION_REQUIRED"],
  ON_HOLD: ["CONFIRMED", "PICKUP_PENDING", "AT_FACILITY", "IN_CARE", "QUALITY_CHECK", "READY_FOR_RETURN", "RETURNING", "AWAITING_ADJUSTMENT", "CANCEL_REQUESTED", "RESOLUTION_REQUIRED"],
  CANCEL_REQUESTED: ["CANCELLED", "ON_HOLD", "RESOLUTION_REQUIRED"],
  RESOLUTION_REQUIRED: ["CONFIRMED", "PICKUP_PENDING", "AT_FACILITY", "IN_CARE", "QUALITY_CHECK", "READY_FOR_RETURN", "RETURNING", "AWAITING_ADJUSTMENT", "CANCEL_REQUESTED", "ON_HOLD"],
} satisfies Record<OrderStatus, readonly OrderStatus[]>;

export interface OrderTransitionSnapshot {
  status: OrderStatus;
  version: number;
  resumeStatus?: OrderStatus;
  adjustmentState?: Adjustment["state"];
  adjustment?: Pick<Adjustment, "id" | "version" | "expiresAt">;
}
export type OrderCommand = { expectedVersion: number } & (
  | { type: "MARK_PICKUP_PENDING" | "RECORD_INTAKE" | "START_CARE" | "START_QUALITY_CHECK" | "PASS_QUALITY_CHECK" | "START_RETURN" | "COMPLETE_RETURN" }
  | { type: "HOLD" | "RESUME" | "REQUEST_CANCEL" | "CONFIRM_CANCEL" | "REQUIRE_RESOLUTION" | "REWORK"; reason: string }
  | { type: "PROPOSE_ADJUSTMENT"; previousTotalMinor: number; newTotalMinor: number; reason: string }
  | { type: "DECIDE_ADJUSTMENT"; decision: AdjustmentDecision; now: string }
);
export interface OrderTransitionEvidence {
  facilityIntakeAccepted?: boolean;
  qualityCheckPassed?: boolean;
  returnAssignmentActive?: boolean;
  leg?: "PICKUP" | "RETURN";
  custodyAccepted?: boolean;
  paymentSettled?: boolean;
  amountRemainingMinor?: number;
  zeroDueResolution?: AuditedResolution;
  logisticsCancelled?: boolean;
  capacityReleased?: boolean;
  careStopped?: boolean;
  custodyResolved?: boolean;
  financialResolutionRecorded?: boolean;
}
function authorizeCare(snapshot: OrderTransitionSnapshot, evidence: OrderTransitionEvidence): void {
  requireFact(evidence.facilityIntakeAccepted, "Accepted facility intake is required before care");
  requireFact(snapshot.adjustmentState === undefined || snapshot.adjustmentState === "ACCEPTED", "Current adjustment acceptance is required before care", "REQUIRES_APPROVAL");
}
function authorizeTarget(snapshot: OrderTransitionSnapshot, target: OrderStatus, evidence: OrderTransitionEvidence): void {
  if (["AT_FACILITY", "IN_CARE", "QUALITY_CHECK", "READY_FOR_RETURN", "RETURNING"].includes(target)) {
    requireFact(evidence.facilityIntakeAccepted, "Accepted facility intake is required");
  }
  if (["IN_CARE", "QUALITY_CHECK", "READY_FOR_RETURN", "RETURNING"].includes(target)) authorizeCare(snapshot, evidence);
  if (["READY_FOR_RETURN", "RETURNING"].includes(target)) requireFact(evidence.qualityCheckPassed, "A passed quality check is required");
  if (target === "RETURNING") requireFact(evidence.returnAssignmentActive, "An active return assignment is required");
}
export function guardOrderCommand(snapshot: OrderTransitionSnapshot, command: OrderCommand, evidence: OrderTransitionEvidence): { status: OrderStatus; resumeStatus?: OrderStatus } {
  expectedVersionSchema.parse(snapshot.version);
  expectedVersionSchema.parse(command.expectedVersion);
  requireFact(snapshot.version === command.expectedVersion, "Order version conflict", "VERSION_CONFLICT");
  requireFact(snapshot.status !== "DELIVERED" && snapshot.status !== "CANCELLED", "Terminal orders cannot change state");
  if ("reason" in command) requireFact(hasReason(command.reason), "An audited reason is required");
  let target: OrderStatus;
  let resumeStatus: OrderStatus | undefined;
  switch (command.type) {
    case "MARK_PICKUP_PENDING": requireFact(snapshot.status === "CONFIRMED", "Pickup requires a confirmed booking"); target = "PICKUP_PENDING"; break;
    case "RECORD_INTAKE": requireFact(snapshot.status === "PICKUP_PENDING", "Intake requires the pickup workflow"); target = "AT_FACILITY"; break;
    case "START_CARE": requireFact(snapshot.status === "AT_FACILITY", "Care requires facility receipt"); target = "IN_CARE"; break;
    case "START_QUALITY_CHECK": requireFact(snapshot.status === "IN_CARE", "Quality check requires completed care"); target = "QUALITY_CHECK"; break;
    case "PASS_QUALITY_CHECK": requireFact(snapshot.status === "QUALITY_CHECK", "Quality check is not active"); target = "READY_FOR_RETURN"; break;
    case "START_RETURN": requireFact(snapshot.status === "READY_FOR_RETURN", "Order is not ready for return"); target = "RETURNING"; break;
    case "COMPLETE_RETURN":
      requireFact(snapshot.status === "RETURNING" && evidence.leg === "RETURN", "Only the return leg can deliver an order");
      requireFact(evidence.custodyAccepted, "Accepted return custody is required");
      requireFact(evidence.paymentSettled || (evidence.amountRemainingMinor === 0 && audited(evidence.zeroDueResolution)), "Payment must be settled or an audited zero-due resolution recorded", "PAYMENT_PENDING");
      target = "DELIVERED"; break;
    case "PROPOSE_ADJUSTMENT":
      requireFact(snapshot.status === "AT_FACILITY", "Adjustments require facility intake");
      moneySchema.parse(command.previousTotalMinor); moneySchema.parse(command.newTotalMinor);
      requireFact(command.newTotalMinor > command.previousTotalMinor, "A higher measured total requires explicit consent");
      requireFact(evidence.facilityIntakeAccepted, "Accepted facility intake is required");
      target = "AWAITING_ADJUSTMENT"; break;
    case "DECIDE_ADJUSTMENT": {
      const adjustment = snapshot.adjustment;
      requireFact(snapshot.status === "AWAITING_ADJUSTMENT" && snapshot.adjustmentState === "PROPOSED" && adjustment, "No current proposed adjustment");
      requireFact(command.decision.expectedVersion === snapshot.version && adjustment?.id === command.decision.adjustmentId && adjustment.version === command.decision.adjustmentVersion, "Adjustment version conflict", "VERSION_CONFLICT");
      const now = instantSchema.parse(command.now);
      requireFact(now < instantSchema.parse(adjustment!.expiresAt), "Adjustment has expired", "QUOTE_EXPIRED");
      requireFact(command.decision.decision === "ACCEPT" || command.decision.decision === "DECLINE", "Invalid adjustment decision");
      target = command.decision.decision === "ACCEPT" ? "AT_FACILITY" : "ON_HOLD";
      if (target === "ON_HOLD") resumeStatus = "AT_FACILITY";
      break;
    }
    case "HOLD": requireFact(snapshot.status !== "ON_HOLD", "Order is already held"); target = "ON_HOLD"; resumeStatus = snapshot.resumeStatus ?? snapshot.status; break;
    case "REQUIRE_RESOLUTION": target = "RESOLUTION_REQUIRED"; resumeStatus = snapshot.resumeStatus ?? snapshot.status; break;
    case "RESUME":
      requireFact(["ON_HOLD", "RESOLUTION_REQUIRED"].includes(snapshot.status), "Only held or unresolved orders can resume");
      requireFact(snapshot.resumeStatus && !["ON_HOLD", "RESOLUTION_REQUIRED", "DELIVERED", "CANCELLED"].includes(snapshot.resumeStatus), "A valid recorded resume state is required");
      target = snapshot.resumeStatus!; break;
    case "REQUEST_CANCEL": target = "CANCEL_REQUESTED"; break;
    case "CONFIRM_CANCEL":
      requireFact(snapshot.status === "CANCEL_REQUESTED", "Cancellation was not requested");
      requireFact(evidence.logisticsCancelled && evidence.capacityReleased && evidence.careStopped && evidence.custodyResolved && evidence.financialResolutionRecorded, "Cancellation reconciliation is incomplete");
      target = "CANCELLED"; break;
    case "REWORK": requireFact(snapshot.status === "QUALITY_CHECK", "Rework requires an active quality check"); target = "IN_CARE"; break;
    default: throw new TransitionError("INVALID_INPUT", "Unknown order command");
  }
  const allowed: readonly OrderStatus[] = ORDER_TRANSITIONS[snapshot.status];
  requireFact(allowed.includes(target), `Illegal order transition ${snapshot.status} to ${target}`);
  authorizeTarget(snapshot, target, evidence);
  return { status: target, ...(resumeStatus ? { resumeStatus } : {}) };
}

export function deriveObligationStatus(input: { amountDueMinor: number; amountSettledMinor: number; voidResolution?: AuditedResolution }): ObligationStatus {
  const due = moneySchema.parse(input.amountDueMinor);
  const settled = moneySchema.parse(input.amountSettledMinor);
  requireFact(settled <= due, "Overpayments need reconciliation, not an invalid obligation balance");
  if (input.voidResolution) {
    requireFact(due === 0 && settled === 0 && audited(input.voidResolution), "Only an audited zero-due resolution can void an unpaid obligation");
    return "VOID";
  }
  if (settled === 0) return "OPEN";
  return settled === due ? "SETTLED" : "PARTIALLY_SETTLED";
}
export const PAYMENT_ATTEMPT_TRANSITIONS = {
  CREATED: ["PENDING", "SUCCEEDED", "FAILED", "EXPIRED", "OUTCOME_UNKNOWN"],
  PENDING: ["SUCCEEDED", "FAILED", "EXPIRED", "OUTCOME_UNKNOWN"],
  OUTCOME_UNKNOWN: ["PENDING", "SUCCEEDED", "FAILED", "EXPIRED"],
  FAILED: ["SUCCEEDED"], EXPIRED: ["SUCCEEDED"], SUCCEEDED: [],
} satisfies Record<AttemptStatus, readonly AttemptStatus[]>;
export function assertPaymentAttemptTransition(from: AttemptStatus, to: AttemptStatus, evidence: { authoritativeSuccess?: boolean }): void {
  if (from === to) return;
  const allowed: readonly AttemptStatus[] = PAYMENT_ATTEMPT_TRANSITIONS[from];
  requireFact(allowed?.includes(to), "Illegal payment attempt transition");
  if (to === "SUCCEEDED") requireFact(evidence.authoritativeSuccess, "Success requires an authoritative receipt or capture");
}
export const REFUND_TRANSITIONS = {
  REQUESTED: ["PROCESSING", "SUCCEEDED", "FAILED", "OUTCOME_UNKNOWN"],
  PROCESSING: ["SUCCEEDED", "FAILED", "OUTCOME_UNKNOWN"],
  OUTCOME_UNKNOWN: ["PROCESSING", "SUCCEEDED", "FAILED"],
  FAILED: ["PROCESSING", "SUCCEEDED"], SUCCEEDED: [],
} satisfies Record<RefundStatus, readonly RefundStatus[]>;
export function assertRefundTransition(from: RefundStatus, to: RefundStatus, evidence: { authoritativeSuccess?: boolean; reconciledBeforeRetry?: boolean }): void {
  if (from === to) return;
  const allowed: readonly RefundStatus[] = REFUND_TRANSITIONS[from];
  requireFact(allowed?.includes(to), "Illegal refund transition");
  if (to === "SUCCEEDED") requireFact(evidence.authoritativeSuccess, "Refund success requires provider or audited manual confirmation");
  if (to === "PROCESSING" && ["FAILED", "OUTCOME_UNKNOWN"].includes(from)) requireFact(evidence.reconciledBeforeRetry, "Reconcile the stable refund reference before retry", "PROVIDER_OUTCOME_UNKNOWN");
}
export function assertRefundAllowed(input: { capturedMinor: number; refundedMinor: number; pendingMinor: number; requestedMinor: number }): void {
  const captured = moneySchema.parse(input.capturedMinor);
  const refunded = moneySchema.parse(input.refundedMinor);
  const pending = moneySchema.parse(input.pendingMinor);
  const requested = moneySchema.parse(input.requestedMinor);
  requireFact(requested > 0 && refunded <= captured && pending <= captured - refunded && requested <= captured - refunded - pending, "Refund exceeds unreserved captured funds");
}
export const LEG_TRANSITIONS = {
  REQUESTED: ["BOOKING_UNKNOWN", "BOOKED", "FAILED", "CANCEL_REQUESTED"],
  BOOKING_UNKNOWN: ["BOOKED", "FAILED", "CANCEL_REQUESTED"],
  BOOKED: ["ASSIGNED", "FAILED", "CANCEL_REQUESTED"],
  ASSIGNED: ["AT_PICKUP", "FAILED", "CANCEL_REQUESTED"],
  AT_PICKUP: ["IN_TRANSIT", "FAILED", "CANCEL_REQUESTED"],
  IN_TRANSIT: ["COMPLETED", "FAILED", "CANCEL_REQUESTED"],
  CANCEL_REQUESTED: ["CANCELLED", "COMPLETED", "FAILED"],
  COMPLETED: [], FAILED: [], CANCELLED: [],
} satisfies Record<LegAttemptStatus, readonly LegAttemptStatus[]>;
export function assertLegTransition(from: LegAttemptStatus, to: LegAttemptStatus, evidence: { proofVerified?: boolean; bookingReconciled?: boolean; cancellationConfirmed?: boolean }): void {
  if (from === to) return;
  const allowed: readonly LegAttemptStatus[] = LEG_TRANSITIONS[from];
  requireFact(allowed?.includes(to), "Illegal delivery attempt transition; rebooking creates a new attempt");
  if (to === "COMPLETED") requireFact(evidence.proofVerified, "Completion requires verified custody proof");
  if (from === "BOOKING_UNKNOWN" && to === "BOOKED") requireFact(evidence.bookingReconciled, "Unknown booking must be reconciled by stable provider reference", "PROVIDER_OUTCOME_UNKNOWN");
  if (to === "CANCELLED") requireFact(evidence.cancellationConfirmed, "Cancellation requires an authoritative outcome");
}
export const DRAFT_TRANSITIONS = {
  COLLECTING: ["QUOTED", "EXPIRED", "HUMAN_HANDOFF"],
  QUOTED: ["COLLECTING", "CONFIRMED", "EXPIRED", "HUMAN_HANDOFF"],
  CONFIRMED: ["COLLECTING", "BOOKING_CREATED", "EXPIRED", "HUMAN_HANDOFF"],
  BOOKING_CREATED: [], EXPIRED: [], HUMAN_HANDOFF: ["COLLECTING", "EXPIRED"],
} satisfies Record<DraftState, readonly DraftState[]>;
export function assertDraftConfirmation(input: { draft: ConversationDraft; confirmation: DraftConfirmation; quote: { id: string; version: number; expiresAt: string }; now: string }): void {
  const { draft, confirmation, quote } = input;
  const now = instantSchema.parse(input.now);
  requireFact(["QUOTED", "CONFIRMED"].includes(draft.state) && draft.missingFields.length === 0, "Draft is not ready for confirmation");
  requireFact(draft.draftId === confirmation.draftId && draft.revision === confirmation.revision && draft.quoteId === confirmation.quoteId && draft.quoteVersion === confirmation.quoteVersion && quote.id === confirmation.quoteId && quote.version === confirmation.quoteVersion, "Draft or quote version conflict", "VERSION_CONFLICT");
  requireFact(now < instantSchema.parse(draft.expiresAt) && now < instantSchema.parse(quote.expiresAt), "Draft or quote has expired", "QUOTE_EXPIRED");
}
