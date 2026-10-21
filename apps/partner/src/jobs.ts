import type { DeliveryJob } from "@laundry/contracts";

export type PartnerAction =
  | "ACCEPT"
  | "NAVIGATE"
  | "OTP_HANDOVER"
  | "REPORT_EXCEPTION";

/**
 * Pure evaluation of whether a rider can accept a delivery job.
 * - Provider-managed jobs cannot be accepted by partner app riders.
 * - Completed/failed/cancelled jobs cannot be accepted.
 * - Jobs already assigned to another rider cannot be accepted.
 * - Jobs in BOOKED or REQUESTED status can be accepted.
 */
export function canAccept(job: DeliveryJob, riderId?: string): boolean {
  if (job.dispatchMode === "PROVIDER") {
    return false;
  }

  if (
    job.status === "COMPLETED" ||
    job.status === "CANCELLED" ||
    job.status === "FAILED" ||
    job.status === "CANCEL_REQUESTED"
  ) {
    return false;
  }

  if (job.assignedTo && riderId && job.assignedTo !== riderId) {
    return false;
  }

  if (job.assignedTo && !riderId) {
    return false;
  }

  return job.status === "BOOKED" || job.status === "REQUESTED";
}

/**
 * Returns supported partner actions for a given job.
 * - Closed jobs support no actions.
 * - Provider-managed jobs disable unsupported actions.
 *   If the provider job lacks the 'OTP_HANDOVER' capability, actions are empty (read-only).
 * - Manual jobs support navigation, exception reporting, and handover depending on status.
 */
export function supportedActions(job: DeliveryJob): PartnerAction[] {
  if (
    job.status === "COMPLETED" ||
    job.status === "CANCELLED" ||
    job.status === "FAILED" ||
    job.status === "CANCEL_REQUESTED"
  ) {
    return [];
  }

  if (job.dispatchMode === "PROVIDER") {
    const actions: PartnerAction[] = [];
    if (job.capabilities && job.capabilities.includes("OTP_HANDOVER")) {
      actions.push("OTP_HANDOVER");
    }
    return actions;
  }

  // Manual dispatch mode
  const actions: PartnerAction[] = ["NAVIGATE", "REPORT_EXCEPTION"];
  if (job.status === "BOOKED" || job.status === "REQUESTED") {
    actions.push("ACCEPT");
  }
  if (
    job.status === "ASSIGNED" ||
    job.status === "AT_PICKUP" ||
    job.status === "IN_TRANSIT"
  ) {
    actions.push("OTP_HANDOVER");
  }

  return actions;
}

/**
 * Returns a human-readable description of the next action for the rider.
 */
export function nextAction(job: DeliveryJob): string {
  if (job.status === "COMPLETED") {
    return "Delivery completed";
  }
  if (job.status === "CANCELLED" || job.status === "CANCEL_REQUESTED") {
    return "Job cancelled";
  }
  if (job.status === "FAILED") {
    return "Delivery failed";
  }

  if (job.dispatchMode === "PROVIDER" && (!job.capabilities || !job.capabilities.includes("OTP_HANDOVER"))) {
    return "Provider-managed (actions handled in provider app)";
  }

  if (job.status === "BOOKED" || job.status === "REQUESTED") {
    return "Accept delivery task";
  }

  if (job.status === "ASSIGNED") {
    return job.leg === "PICKUP"
      ? "Navigate to customer pickup location"
      : "Navigate to laundry facility for pickup";
  }

  if (job.status === "AT_PICKUP") {
    return job.leg === "PICKUP"
      ? "Collect sealed bags & verify customer OTP"
      : "Collect sealed bags from laundry";
  }

  if (job.status === "IN_TRANSIT") {
    return job.leg === "PICKUP"
      ? "Transport bags to laundry facility"
      : "Deliver bags to customer & verify OTP";
  }

  return "Review job details";
}

/**
 * Checks whether a job is accessible by the current rider.
 * Returns { accessible: false, reason: 'Not assigned to you' } if unassigned or assigned to someone else.
 */
export function checkJobAccess(
  job: DeliveryJob,
  riderId?: string
): { accessible: boolean; reason?: string } {
  if (!job.assignedTo) {
    return { accessible: false, reason: "Not assigned to you" };
  }
  if (riderId && job.assignedTo !== riderId) {
    return { accessible: false, reason: "Not assigned to you" };
  }
  return { accessible: true };
}

/**
 * Notice displayed when a job is provider-managed without delegation.
 */
export function getProviderManagedNotice(job: DeliveryJob): string | null {
  if (
    job.dispatchMode === "PROVIDER" &&
    (!job.capabilities || !job.capabilities.includes("OTP_HANDOVER"))
  ) {
    return "Provider-managed delivery. Actions are handled in the provider app.";
  }
  return null;
}
