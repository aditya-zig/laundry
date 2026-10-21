// Pure customer display rules. Names the exact user-visible state so screens
// cannot invent wording for money, pending payment, or empty reviews.
export function formatINR(amountMinor: number): string {
  return `INR ${(amountMinor / 100).toFixed(2)}`;
}

export function isQuoteExpired(expiresAt: string, now: string = new Date().toISOString()): boolean {
  return Date.parse(expiresAt) <= Date.parse(now);
}

export type PaymentLabel = "Payment received" | "Payment pending" | "Payment failed" | "No payment yet";

export function paymentStatusLabel(status: string | undefined): PaymentLabel {
  switch (status) {
    case "CAPTURED":
      return "Payment received";
    case "PENDING":
    case "AWAITING_PAYMENT":
      return "Payment pending";
    case "FAILED":
    case "EXPIRED":
      return "Payment failed";
    default:
      return "No payment yet";
  }
}

/** Pending must never read as failed or confirmed. Enforced by test. */
export function isPendingLabelHonest(label: PaymentLabel): boolean {
  return label === "Payment pending";
}

export function reviewEmptyLabel(count: number): string {
  return count === 0 ? "No reviews yet" : `${count} verified review${count === 1 ? "" : "s"}`;
}

export interface CheckoutGate {
  areaEligible: boolean;
  addressId: string | null;
  lineCount: number;
  quoteExpired: boolean;
}

export function checkoutBlockReason(gate: CheckoutGate): string | null {
  if (!gate.areaEligible) return "This address is outside the service area. Checkout is unavailable.";
  if (!gate.addressId) return "Add a delivery address before checkout.";
  if (gate.lineCount === 0) return "Your basket is empty.";
  if (gate.quoteExpired) return "This quote expired. Request fresh terms to continue.";
  return null;
}

interface Schedule {
  pickupStart: string;
  pickupEnd: string;
  returnBy: string;
}

// Editable requests only. Availability and promised return remain server decisions.
export function defaultSchedule(now = Date.now()): Schedule {
  const pickup = now + 24 * 60 * 60 * 1000;
  return {
    pickupStart: new Date(pickup).toISOString(),
    pickupEnd: new Date(pickup + 60 * 60 * 1000).toISOString(),
    returnBy: new Date(pickup + 5 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

export function scheduleBlockReason(schedule: Schedule, now = Date.now()): string | null {
  const start = Date.parse(schedule.pickupStart);
  const end = Date.parse(schedule.pickupEnd);
  const deadline = Date.parse(schedule.returnBy);
  if (![start, end, deadline].every(Number.isFinite)) return "Enter valid ISO dates with a timezone, for example 2026-10-22T09:00:00+05:30.";
  if (![schedule.pickupStart, schedule.pickupEnd, schedule.returnBy].every(value => /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))) return "Include a timezone on every date (Z or +05:30).";
  if (start <= now) return "Choose a pickup window in the future.";
  if (end <= start) return "Pickup end must be after pickup start.";
  if (deadline <= end) return "Requested return must be after the pickup window.";
  return null;
}
