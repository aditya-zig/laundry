// Partner journey behavior tests (A6).
// Tests exercise observable state, API results and pure helpers from src/.
import { describe, expect, it } from "vitest";
import type { DeliveryJob, HandoverInput } from "@wandary/contracts";
import {
  canAccept,
  checkJobAccess,
  getProviderManagedNotice,
  nextAction,
  supportedActions,
} from "../src/jobs";
import { getBagVerificationMode, newActionId } from "../src/handover";
import {
  createOfflineQueueItem,
  getPendingItems,
  prepareReplayPayload,
  replayOfflineQueue,
  validateSyncEligibility,
} from "../src/offline";

function createMockJob(overrides: Partial<DeliveryJob> = {}): DeliveryJob {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    orderId: "22222222-2222-4222-8222-222222222222",
    leg: "PICKUP",
    status: "ASSIGNED",
    version: 1,
    customerName: "Rohan Verma",
    address: "42 Indiranagar, 100ft Road, Bengaluru",
    window: {
      start: "2026-10-12T09:00:00.000Z",
      end: "2026-10-12T11:00:00.000Z",
      timezone: "Asia/Kolkata",
    },
    bagIds: ["bag-101", "bag-102"],
    provider: "manual",
    dispatchMode: "MANUAL",
    capabilities: ["OTP_HANDOVER"],
    assignedTo: "rider-111",
    ...overrides,
  };
}

describe("partner journey", () => {
  it("unassigned job is inaccessible", () => {
    const riderId = "rider-111";

    // 1. Completely unassigned job (assignedTo is undefined)
    const unassignedJob = createMockJob({ assignedTo: undefined });
    const accessUnassigned = checkJobAccess(unassignedJob, riderId);
    expect(accessUnassigned.accessible).toBe(false);
    expect(accessUnassigned.reason).toBe("Not assigned to you");

    // 2. Job assigned to a different rider
    const otherRiderJob = createMockJob({ assignedTo: "rider-999" });
    const accessOther = checkJobAccess(otherRiderJob, riderId);
    expect(accessOther.accessible).toBe(false);
    expect(accessOther.reason).toBe("Not assigned to you");
    expect(canAccept(otherRiderJob, riderId)).toBe(false);

    // 3. Assigned to current rider is accessible
    const ownJob = createMockJob({ assignedTo: riderId });
    const accessOwn = checkJobAccess(ownJob, riderId);
    expect(accessOwn.accessible).toBe(true);
    expect(accessOwn.reason).toBeUndefined();
  });

  it("provider-managed task disables unsupported actions", () => {
    // Provider-managed delivery with no delegated capabilities
    const providerJob = createMockJob({
      dispatchMode: "PROVIDER",
      provider: "shadowfax",
      capabilities: [],
    });

    const actions = supportedActions(providerJob);
    // Unsupported partner actions are disabled (empty list)
    expect(actions).toEqual([]);

    const notice = getProviderManagedNotice(providerJob);
    expect(notice).toMatch(/Provider-managed/);
    expect(notice).toMatch(/handled in the provider app/);

    const actionText = nextAction(providerJob);
    expect(actionText).toMatch(/Provider-managed/);

    // When provider delegates OTP_HANDOVER capability, that specific action is supported
    const providerJobWithDelegation = createMockJob({
      dispatchMode: "PROVIDER",
      provider: "shadowfax",
      capabilities: ["OTP_HANDOVER"],
    });
    expect(supportedActions(providerJobWithDelegation)).toContain("OTP_HANDOVER");
  });

  it("offline evidence says pending", () => {
    const job = createMockJob();
    const offlineItem = createOfflineQueueItem({
      jobId: job.id,
      expectedVersion: job.version,
      riderId: "rider-111",
      bagIds: job.bagIds,
      otp: "1234",
    });

    // Observable status must explicitly say "Pending sync"
    expect(offlineItem.status).toBe("Pending sync");
    // Never falsely advertise as completed or delivered
    expect(offlineItem.status).not.toBe("Synced");
    expect(offlineItem.status).not.toBe("COMPLETED");

    const pending = getPendingItems([offlineItem]);
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("Pending sync");
  });

  it("repeated sync uses same action ID", async () => {
    const initialActionId = newActionId();
    const offlineItem = createOfflineQueueItem({
      jobId: "11111111-1111-4111-8111-111111111111",
      expectedVersion: 1,
      riderId: "rider-111",
      bagIds: ["bag-101"],
      actionId: initialActionId,
      otp: "5678",
    });

    expect(offlineItem.actionId).toBe(initialActionId);

    // First replay preparation
    const firstPayload = prepareReplayPayload(offlineItem);
    expect(firstPayload.input.actionId).toBe(initialActionId);

    // Second replay preparation (retry)
    const secondPayload = prepareReplayPayload(offlineItem);
    expect(secondPayload.input.actionId).toBe(initialActionId);
    expect(secondPayload.input.actionId).toBe(firstPayload.input.actionId);

    // End-to-end replay simulation: ensures callers receive the exact stable actionId
    const dispatchedActionIds: string[] = [];
    const mockSyncCaller: (
      jobId: string,
      payload: Omit<HandoverInput, "jobId"> & { expectedVersion: number }
    ) => Promise<DeliveryJob> = async (_id, payload) => {
      dispatchedActionIds.push(payload.actionId);
      return createMockJob();
    };

    const result = await replayOfflineQueue([offlineItem], mockSyncCaller);
    expect(result.succeeded).toContain(initialActionId);
    expect(dispatchedActionIds).toEqual([initialActionId]);
  });

  it("reassignment rejects stale completion", () => {
    const offlineItem = createOfflineQueueItem({
      jobId: "11111111-1111-4111-8111-111111111111",
      expectedVersion: 1,
      riderId: "rider-111",
      bagIds: ["bag-101"],
    });

    // Case 1: Job was reassigned to another rider
    const reassignedJob = createMockJob({
      version: 2,
      assignedTo: "rider-222",
    });

    const reassignedCheck = validateSyncEligibility(reassignedJob, offlineItem, "rider-111");
    expect(reassignedCheck.eligible).toBe(false);
    expect(reassignedCheck.reason).toMatch(/reassigned|revoked/i);

    // Case 2: Version conflict (stale version)
    const updatedVersionJob = createMockJob({
      version: 2,
      assignedTo: "rider-111",
    });
    const versionCheck = validateSyncEligibility(updatedVersionJob, offlineItem, "rider-111");
    expect(versionCheck.eligible).toBe(false);
    expect(versionCheck.reason).toMatch(/Stale completion rejected/i);

    // Case 3: Matching version and assignment allows completion
    const matchingJob = createMockJob({
      version: 1,
      assignedTo: "rider-111",
    });
    const matchingCheck = validateSyncEligibility(matchingJob, offlineItem, "rider-111");
    expect(matchingCheck.eligible).toBe(true);
  });

  it("denied camera permission offers supported alternative", () => {
    // When camera permission is granted
    const cameraGranted = getBagVerificationMode(true);
    expect(cameraGranted.mode).toBe("CAMERA_SCAN");
    expect(cameraGranted.isAlternative).toBe(false);

    // When camera permission is denied
    const cameraDenied = getBagVerificationMode(false);
    expect(cameraDenied.mode).toBe("MANUAL_COUNT");
    expect(cameraDenied.isAlternative).toBe(true);
    expect(cameraDenied.label).toMatch(/manual bag count/i);
  });
});
