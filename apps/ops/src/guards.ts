// Pure ops rules. Every override needs a reason; refund pending differs from
// refunded; intake discrepancies stay visible until resolved.
import type { DeliveryJob, Order } from "@wandary/contracts";

export function formatINR(amountMinor: number): string {
  return `INR ${(amountMinor / 100).toFixed(2)}`;
}

/** Facility staff see only their facility's orders. Admin/operator see all. */
export function visibleOrders(orders: Order[], role: string, facilityId?: string): Order[] {
  if (role === "operator" || role === "admin" || role === "system") return orders;
  if (role === "facility" && facilityId) return orders.filter((o) => o.facilityId === facilityId);
  return [];
}

/** Care advance is disabled while a price adjustment awaits customer approval. */
export function careBlockedReason(order: Order): string | null {
  if (order.adjustment && order.adjustment.status !== "RESOLVED" && order.adjustment.status !== "DECLINED") {
    return "Care is disabled while a price adjustment awaits the customer decision.";
  }
  if (order.status === "AWAITING_ADJUSTMENT") {
    return "Care is disabled while a price adjustment awaits the customer decision.";
  }
  return null;
}

export function overrideRequiresReason(reason: string): string | null {
  return reason.trim().length === 0 ? "A reason is required for every override." : null;
}

export type RefundLabel = "Refund pending" | "Refunded" | "Refund failed" | "No refund";

export function refundStatusLabel(status: string | undefined): RefundLabel {
  switch (status) {
    case "REQUESTED":
    case "PROCESSING":
      return "Refund pending";
    case "SUCCEEDED":
      return "Refunded";
    case "FAILED":
      return "Refund failed";
    default:
      return "No refund";
  }
}

/** Intake discrepancy stays visible until the adjustment round-trips. */
export function intakeDiscrepancy(order: Order): string | null {
  if (!order.adjustment) return null;
  if (order.adjustment.status === "RESOLVED" || order.adjustment.status === "DECLINED") return null;
  const delta = order.adjustment.deltaMinor;
  const direction = delta > 0 ? "increase" : "decrease";
  return `Intake found a ${direction} of ${formatINR(Math.abs(delta))}: ${order.adjustment.reason}`;
}

/** Draft catalog rows need licensed images and rate data before publishing. */
export function catalogPublishBlocked(input: { imageUrl?: string; imageLicense?: string; priceMinor?: number }): string | null {
  if (!input.imageUrl || !input.imageLicense) return "Licensed service photography is required before publish.";
  if (input.priceMinor === undefined || input.priceMinor < 0) return "Rate data is required before publish.";
  return null;
}

/** Dispatch board groups legs; provider-unknown outcomes stay flagged. */
export function dispatchFlag(job: DeliveryJob): string | null {
  if (job.status === "BOOKING_UNKNOWN") return "Provider outcome unknown. Reconcile before retry.";
  if (job.status === "FAILED") return "Booking failed. Rebook creates a new attempt under the same leg.";
  return null;
}
