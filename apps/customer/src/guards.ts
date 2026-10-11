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
