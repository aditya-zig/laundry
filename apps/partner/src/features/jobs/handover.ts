// Custody handover feature logic (F03).
// Types/explicit states: CONFIRMED_ONLINE, OUTCOME_UNKNOWN, PENDING_SYNC,
// REJECTED. Receipt copy is derived only from the authoritative HandoverResult.
import { UnknownOutcomeError, V2ApiError } from "@laundry/api-client";
import { v2 } from "@laundry/contracts";
import type { QueuedMutationRecord } from "@laundry/app-foundation";
import { assignmentState } from "./access";

/** The approved wire mutation for rider custody handover. */
export type HandoverMutation = {
  routeId: "logistics.rider.handover";
  params: { jobId: string };
  body: Omit<v2.RiderHandover, "jobId">;
};

export type HandoverUiState =
  | { kind: "IDLE" }
  | { kind: "CONFIRMED_ONLINE"; receipt: v2.HandoverResult }
  | { kind: "OUTCOME_UNKNOWN"; actionId: string }
  | { kind: "PENDING_SYNC"; pending: HandoverPending }
  | { kind: "REJECTED"; actionId: string; message: string; canRetryWithSameDetails: boolean };

export interface HandoverPending {
  jobId: string;
  actionId: string;
  idempotencyKey: string;
  commandedExpectedVersion: number;
  createdAt: string;
}

export type HandoverCondition = v2.GarmentCondition;

export interface HandoverDraft {
  code: string;
  garmentCount: string;
  condition: HandoverCondition;
  note: string;
  actionId: string;
  capturedAt?: string;
}

const codePattern = /^\d{6}$/;

export function emptyHandoverDraft(): HandoverDraft {
  return {
    code: "",
    garmentCount: "",
    condition: "GOOD",
    note: "",
    actionId: crypto.randomUUID(),
  };
}

export interface HandoverValidationIssue {
  field: "code" | "garmentCount" | "containerIds";
  message: string;
}

export function validateHandoverDraft(args: {
  code: string;
  garmentCount?: number | string;
  containerIds?: string[];
}): HandoverValidationIssue | null {
  if (/\s/.test(args.code) || !codePattern.test(args.code)) {
    return { field: "code", message: "Enter exactly the six-digit custody code shown by the customer." };
  }
  if (args.garmentCount === undefined) return null;
  const raw = typeof args.garmentCount === "number" ? String(args.garmentCount) : args.garmentCount;
  if (raw.trim() === "") {
    return { field: "garmentCount", message: "Record the whole garment count being handed over (0 or more)." };
  }
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 0) {
    return { field: "garmentCount", message: "Record the whole garment count being handed over (0 or more)." };
  }
  if (Array.isArray(args.containerIds) && args.containerIds.length === 0) {
    return { field: "containerIds", message: "This task lists no custody containers." };
  }
  return null;
}

export function handoverEligible(job: v2.RiderJob, actorId: string | null): boolean {
  if (assignmentState(job, actorId) !== "MINE") return false;
  if (TERMINAL.has(job.status)) return false;
  return true;
}

const TERMINAL: ReadonlySet<v2.RiderJob["status"]> = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "CANCEL_REQUESTED",
  "BOOKING_UNKNOWN",
]);

/** Builds the exact typed DTO; never embeds the expected code server-side. */
export function buildHandoverBody(
  job: v2.RiderJob,
  args: { actionId: string; code: string; garmentCount: number; condition?: HandoverCondition; note?: string; capturedAt?: string },
): Omit<v2.RiderHandover, "jobId"> {
  return {
    legAttemptId: job.id,
    expectedVersion: job.version,
    actionId: args.actionId,
    method: "CODE",
    code: args.code,
    capturedAt: args.capturedAt ?? new Date().toISOString(),
    containerIds: [...job.containerIds],
    garmentCount: args.garmentCount,
    condition: args.condition ?? "GOOD",
    ...(args.note ? { note: args.note } : {}),
  };
}

export type HandoverFailure =
  | { kind: "OUTCOME_UNKNOWN"; actionId: string; canRetryWithSameDetails: false }
  | { kind: "REJECTED"; actionId: string; message: string; canRetryWithSameDetails: boolean };

/** Unknown outcomes are never reclassified as confirmations or failures. */
export function classifyHandoverFailure(error: unknown, actionId: string): HandoverFailure {
  if (
    error instanceof UnknownOutcomeError ||
    (error instanceof V2ApiError && error.status >= 500)
  ) {
    return { kind: "OUTCOME_UNKNOWN", actionId, canRetryWithSameDetails: false };
  }
  if (error instanceof V2ApiError) {
    return {
      kind: "REJECTED",
      actionId,
      message: `${error.code}: ${error.message}`,
      canRetryWithSameDetails: Boolean(error.retryable),
    };
  }
  if (error instanceof Error) {
    return { kind: "REJECTED", actionId, message: error.message, canRetryWithSameDetails: false };
  }
  return { kind: "REJECTED", actionId, message: "The handover could not be recorded.", canRetryWithSameDetails: false };
}

/** Pending truth comes from the queued records retained by the foundation. */
export function pendingHandoverForJob(records: QueuedMutationRecord[], jobId: string): HandoverPending | null {
  for (const record of records) {
    if (record.routeId !== "logistics.rider.handover") continue;
    if (record.params.jobId !== jobId) continue;
    const body = readQueuedHandoverBody(record.bodyJson);
    if (body === null) continue;
    return {
      jobId,
      actionId: body.actionId,
      idempotencyKey: record.idempotencyKey,
      commandedExpectedVersion: body.expectedVersion,
      createdAt: record.createdAt,
    };
  }
  return null;
}

function readQueuedHandoverBody(raw: string | null): { actionId: string; expectedVersion: number } | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const body = value as Partial<v2.RiderHandover>;
    if (typeof body.actionId !== "string" || typeof body.expectedVersion !== "number") return null;
    return { actionId: body.actionId, expectedVersion: body.expectedVersion };
  } catch {
    return null;
  }
}

export function describePendingHandover(pending: HandoverPending): string {
  return `Handover outcome unknown — pending sync, not confirmed. Queued at ${pending.createdAt} (action ${pending.actionId.slice(0, 8)}…). Sync to confirm; do not re-collect custody as success.`;
}

export interface CustodyReceiptCopy {
  accepted: boolean;
  headline: string;
  details: string[];
}

export function custodyReceiptCopy(result: v2.HandoverResult): CustodyReceiptCopy {
  const details: string[] = [];
  if (result.accepted) {
    details.push(result.custodyEventId ? `Custody event: ${result.custodyEventId}` : "Custody event pending server reconciliation.");
  } else if (result.reason) {
    details.push(`Server reason: ${result.reason}`);
  }
  details.push(`Attempt count: ${result.attemptCount}`);
  details.push(result.nextAttemptAllowed
    ? "A further code entry is allowed."
    : "No further code attempts allowed for this assignment.");
  return {
    accepted: result.accepted,
    headline: result.accepted
      ? "Custody recorded online — handover confirmed"
      : `Handover not accepted${result.reason ? "" : " (no server reason given)"}`,
    details,
  };
}
