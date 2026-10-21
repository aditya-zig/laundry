import type { DeliveryJob, HandoverInput } from "@laundry/contracts";
import { buildHandoverInput, newActionId } from "./handover";

export type OfflineSyncStatus = "Pending sync" | "Synced" | "Failed";

export interface OfflineQueueItem {
  id: string;
  actionId: string;
  jobId: string;
  expectedVersion: number;
  riderId: string;
  input: HandoverInput;
  status: OfflineSyncStatus;
  enqueuedAt: string;
  syncedAt?: string;
  error?: string;
}

/**
 * Creates an offline handover queue item.
 * Preserves existing actionId or generates a new stable UUID.
 * Status is initialized to 'Pending sync'.
 */
export function createOfflineQueueItem(params: {
  jobId: string;
  expectedVersion: number;
  riderId: string;
  bagIds: string[];
  actionId?: string;
  otp?: string;
  proofReference?: string;
  method?: "OTP" | "PROVIDER_PROOF" | "OPERATOR_EXCEPTION";
  capturedAt?: string;
}): OfflineQueueItem {
  const actionId = params.actionId ?? newActionId();
  const input = buildHandoverInput({
    jobId: params.jobId,
    actionId,
    bagIds: params.bagIds,
    method: params.method ?? "OTP",
    otp: params.otp,
    proofReference: params.proofReference,
    capturedAt: params.capturedAt,
  });

  return {
    id: `queue-${actionId}`,
    actionId,
    jobId: params.jobId,
    expectedVersion: params.expectedVersion,
    riderId: params.riderId,
    input,
    status: "Pending sync",
    enqueuedAt: new Date().toISOString(),
  };
}

/**
 * Enqueues an offline handover item, replacing any existing item with the same actionId.
 */
export function enqueueOfflineItem(
  queue: OfflineQueueItem[],
  item: OfflineQueueItem
): OfflineQueueItem[] {
  const existingIndex = queue.findIndex((q) => q.actionId === item.actionId);
  if (existingIndex >= 0) {
    const updated = [...queue];
    updated[existingIndex] = item;
    return updated;
  }
  return [...queue, item];
}

/**
 * Returns all items awaiting sync.
 */
export function getPendingItems(queue: OfflineQueueItem[]): OfflineQueueItem[] {
  return queue.filter((item) => item.status === "Pending sync");
}

/**
 * Prepares the payload for replaying an offline item.
 * CRITICAL: Reuses the exact same actionId and expectedVersion to guarantee idempotency.
 */
export function prepareReplayPayload(item: OfflineQueueItem): {
  jobId: string;
  input: Omit<HandoverInput, "jobId"> & { expectedVersion: number };
} {
  return {
    jobId: item.jobId,
    input: {
      actionId: item.actionId, // STABLE ACTION ID
      bagIds: [...item.input.bagIds],
      method: item.input.method,
      otp: item.input.otp,
      proofReference: item.input.proofReference,
      capturedAt: item.input.capturedAt,
      expectedVersion: item.expectedVersion,
    },
  };
}

/**
 * Validates whether an offline handover item can still be applied to the server job.
 * If the job was reassigned to another rider or its version was bumped,
 * the stale completion is rejected.
 */
export function validateSyncEligibility(
  serverJob: DeliveryJob,
  queuedItem: OfflineQueueItem,
  riderId: string
): { eligible: boolean; reason?: string } {
  if (serverJob.assignedTo !== riderId) {
    return {
      eligible: false,
      reason: "Job has been reassigned to another rider. Rider write access revoked.",
    };
  }

  if (serverJob.version !== queuedItem.expectedVersion) {
    return {
      eligible: false,
      reason: `Stale completion rejected: expected version ${queuedItem.expectedVersion} but job is at version ${serverJob.version}.`,
    };
  }

  if (serverJob.status === "COMPLETED") {
    return {
      eligible: false,
      reason: "Job is already completed.",
    };
  }

  return { eligible: true };
}

/**
 * Replays offline queue items against a handover caller.
 * Retries reuse the same actionId.
 */
export async function replayOfflineQueue(
  queue: OfflineQueueItem[],
  caller: (
    jobId: string,
    payload: Omit<HandoverInput, "jobId"> & { expectedVersion: number }
  ) => Promise<DeliveryJob>
): Promise<{
  queue: OfflineQueueItem[];
  succeeded: string[];
  failed: { actionId: string; error: string }[];
}> {
  const updatedQueue = [...queue];
  const succeeded: string[] = [];
  const failed: { actionId: string; error: string }[] = [];

  for (let i = 0; i < updatedQueue.length; i++) {
    const item = updatedQueue[i];
    if (item.status !== "Pending sync") continue;

    const { jobId, input } = prepareReplayPayload(item);
    try {
      await caller(jobId, input);
      updatedQueue[i] = {
        ...item,
        status: "Synced",
        syncedAt: new Date().toISOString(),
        error: undefined,
      };
      succeeded.push(item.actionId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      updatedQueue[i] = {
        ...item,
        status: "Failed",
        error: message,
      };
      failed.push({ actionId: item.actionId, error: message });
    }
  }

  return { queue: updatedQueue, succeeded, failed };
}
