import type { HandoverInput } from "@laundry/contracts";

/**
 * Generates a stable client action UUID.
 */
export function newActionId(): string {
  return crypto.randomUUID();
}

export interface BuildHandoverParams {
  jobId: string;
  actionId: string;
  bagIds: string[];
  method?: "OTP" | "PROVIDER_PROOF" | "OPERATOR_EXCEPTION";
  otp?: string;
  proofReference?: string;
  capturedAt?: string;
}

/**
 * Pure builder for HandoverInput payload conforming to handoverInputSchema.
 * Validates non-empty jobId, actionId, and bagIds.
 * Never stores or displays customer handover codes to the rider.
 */
export function buildHandoverInput(params: BuildHandoverParams): HandoverInput {
  if (!params.jobId || typeof params.jobId !== "string") {
    throw new Error("jobId is required");
  }
  if (!params.actionId || typeof params.actionId !== "string") {
    throw new Error("actionId is required");
  }
  if (!Array.isArray(params.bagIds) || params.bagIds.length === 0) {
    throw new Error("At least one bagId is required for handover");
  }

  const method = params.method ?? "OTP";
  const capturedAt = params.capturedAt ?? new Date().toISOString();

  const input: HandoverInput = {
    jobId: params.jobId,
    actionId: params.actionId,
    bagIds: [...params.bagIds],
    method,
    capturedAt,
  };

  if (params.otp !== undefined && params.otp.trim().length > 0) {
    input.otp = params.otp.trim();
  }

  if (params.proofReference !== undefined && params.proofReference.trim().length > 0) {
    input.proofReference = params.proofReference.trim();
  }

  return input;
}

export interface BagVerificationMode {
  mode: "CAMERA_SCAN" | "MANUAL_COUNT";
  label: string;
  isAlternative: boolean;
}

/**
 * Evaluates custody verification mode.
 * Denied camera permission offers manual-count alternative.
 */
export function getBagVerificationMode(cameraPermissionGranted: boolean): BagVerificationMode {
  if (!cameraPermissionGranted) {
    return {
      mode: "MANUAL_COUNT",
      label: "Camera access unavailable. Use manual bag count verification.",
      isAlternative: true,
    };
  }
  return {
    mode: "CAMERA_SCAN",
    label: "Scan bag barcodes with camera.",
    isAlternative: false,
  };
}
