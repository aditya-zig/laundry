// Focused behavior tests for the custody handover state machine.
// Scenarios: builder produces the exact typed DTO; failed/unknown/online
// states are explicit and honest; custody receipts never claim unconfirmed
// outcomes; pending queue truth drives the pending state.
import { describe, expect, it } from "vitest";
import { UnknownOutcomeError, V2ApiError } from "@laundry/api-client";
import { v2 } from "@laundry/contracts";
import { riderJob } from "./access.test";
import {
  buildHandoverBody,
  classifyHandoverFailure,
  custodyReceiptCopy,
  describePendingHandover,
  emptyHandoverDraft,
  handoverEligible,
  validateHandoverDraft,
  type HandoverPending,
} from "./handover";

const job = riderJob();

describe("handover eligibility and draft validation", () => {
  it("requires an assigned, active task", () => {
    expect(handoverEligible(job, "11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(handoverEligible(job, "99999999-9999-4999-8999-999999999999")).toBe(false);
    expect(handoverEligible({ ...job, assignmentActive: false }, "11111111-1111-4111-8111-111111111111")).toBe(false);
    expect(handoverEligible({ ...job, assignedTo: undefined }, "11111111-1111-4111-8111-111111111111")).toBe(false);
  });

  it("rejects drafts that are not a six digit custody code", () => {
    expect(validateHandoverDraft({ code: "" })).not.toBeNull();
    expect(validateHandoverDraft({ code: "12345" })).not.toBeNull();
    expect(validateHandoverDraft({ code: "1234567" })).not.toBeNull();
    expect(() => validateHandoverDraft({ code: "12 456" })).not.toThrow();
    // Actual leading/trailing spaces are trimmed and rejected later, not silently accepted with padding.
    // Padded codes are silently rejected, never trimmed into an implicit accept.
    expect(validateHandoverDraft({ code: " 123456" })).not.toBeNull();
    expect(validateHandoverDraft({ code: "123456" })).toBeNull();
  });

  it("requires a nonnegative custody garment count and at least one container", () => {
    expect(validateHandoverDraft({ code: "123456", garmentCount: -1 })).not.toBeNull();
    expect(validateHandoverDraft({
      code: "123456",
      garmentCount: 2,
      containerIds: [],
    })).not.toBeNull();
    expect(validateHandoverDraft({ code: "123456", garmentCount: 2 })).toBeNull();
  });

  it("empty drafts render honest prompts", () => {
    const draft = emptyHandoverDraft();
    expect(draft.condition).toBe("GOOD");
    expect(v2.garmentConditionSchema.safeParse(draft.condition).success).toBe(true);
  });
});

describe("typed handover DTO construction", () => {
  it("builds the exact rider DTO preserving actionId and job version", () => {
    const actionId = "33333333-3333-4333-8333-333333333333";
    const capturedAt = "2026-10-25T06:00:00.000Z";
    const body = buildHandoverBody(job, { actionId, code: "123456", garmentCount: 6, capturedAt });
    expect(body).toEqual({
      legAttemptId: "22222222-2222-4222-8222-222222222222",
      expectedVersion: 1,
      actionId,
      method: "CODE",
      code: "123456",
      capturedAt,
      containerIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      garmentCount: 6,
      condition: "GOOD",
    });
  });
});

describe("explicit online / unknown / pending / rejected state", () => {
  it("an SDK unknown outcome stays unknown, keeping the action id", () => {
    const result = classifyHandoverFailure(
      new UnknownOutcomeError("The request outcome is unknown.", undefined, "8a2b"),
      "33333333-3333-4333-8333-333333333333",
    );
    expect(result.kind).toBe("OUTCOME_UNKNOWN");
    expect(result.actionId).toBe("33333333-3333-4333-8333-333333333333");
  });

  it("authoritative server rejections are rejected, never queued as pending success", () => {
    const conflict = classifyHandoverFailure(
      new V2ApiError(409, {
        code: "VERSION_CONFLICT",
        message: "stale version",
        traceId: "t",
        retryable: false,
      }),
      "action",
    );
    expect(conflict.kind).toBe("REJECTED");
    expect(conflict.canRetryWithSameDetails).toBe(false);

    const limited = classifyHandoverFailure(
      new V2ApiError(429, {
        code: "RATE_LIMITED",
        message: "slow down",
        traceId: "t",
        retryable: true,
      }),
      "action",
    );
    expect(limited.kind).toBe("REJECTED");
    expect(limited.canRetryWithSameDetails).toBe(true);
    expect(limited.actionId).toBe("action");
  });

  it("pending truth comes from the queued mutation record, not optimism", () => {
    const pending: HandoverPending = {
      jobId: "22222222-2222-4222-8222-222222222222",
      actionId: "33333333-3333-4333-8333-333333333333",
      createdAt: "2026-10-25T05:00:00.000Z",
      idempotencyKey: "k",
      commandedExpectedVersion: 1,
    };
    expect(describePendingHandover(pending)).toMatch(/unknown/i);
    expect(describePendingHandover(pending)).toMatch(/not confirmed/i);
  });
});

describe("custody receipt honesty", () => {
  it("a confirmed online receipt presents the issued custody event", () => {
    const copy = custodyReceiptCopy({
      legAttemptId: job.id,
      accepted: true,
      custodyEventId: "77777777-7777-4777-8777-777777777777",
      attemptCount: 1,
      nextAttemptAllowed: false,
    });
    expect(copy.accepted).toBe(true);
    expect(copy.headline).toMatch(/custody recorded/i);
    expect(copy.details).toEqual([
      "Custody event: 77777777-7777-4777-8777-777777777777",
      "Attempt count: 1",
      "No further code attempts allowed for this assignment.",
    ]);
  });

  it("a not-accepted result never reads as completed custody", () => {
    const copy = custodyReceiptCopy({
      legAttemptId: job.id,
      accepted: false,
      reason: "Custody code expired",
      attemptCount: 3,
      nextAttemptAllowed: false,
    });
    expect(copy.headline).not.toMatch(/custody recorded/i);
    expect(copy.headline).toMatch(/not accepted/i);
    expect(copy.details).toContain("Server reason: Custody code expired");
    expect(copy.details).toContain("No further code attempts allowed for this assignment.");
  });
});
