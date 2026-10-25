import { UnknownOutcomeError, V2ApiError } from "@laundry/api-client";
import type { v2 } from "@laundry/contracts";
import { formatINR } from "../../guards";

export function rateHeadline(rate: v2.EffectiveRateSummary): { title: string; sub: string | null } {
  const title = `${formatINR(rate.unitPriceMinor)} ${rate.unitLabel}`;
  const notes: string[] = [];
  if (rate.billingUnit === "KG") {
    if (rate.weightIncrementGrams) notes.push(`Billed per ${rate.weightIncrementGrams} g`);
    if (rate.minimumBillableGrams) notes.push(`Minimum billed ${rate.minimumBillableGrams} g`);
  }
  if (rate.synthetic) notes.push("Indicative demo rate");
  return { title, sub: notes.length > 0 ? notes.join(" · ") : null };
}

export function unitHeadline(service: v2.Service): string {
  switch (service.billingUnit) {
    case "KG":
      return "Priced by weight";
    case "PIECE":
      return "Priced per piece";
    case "BOTH":
      return "Priced by weight or per piece";
  }
}

export function rateMissingCopy(): string {
  return "Price not published yet. The server quote at checkout confirms the price.";
}

export function bagHeadline(units: number): string {
  if (units === 0) return "Your bag is empty";
  return `${units} ${units === 1 ? "item" : "items"} · priced at checkout`;
}

export function dueAtReturnCopy(order: v2.Order): string {
  if (order.paymentModel === "DUE_AT_RETURN") {
    return `You pay ${formatINR(order.totalMinor)} when your clothes are returned`;
  }
  return `Total ${formatINR(order.totalMinor)}`;
}

export interface ErrorCopy {
  title: string;
  body: string;
}

export function describeError(error: unknown): ErrorCopy {
  if (error instanceof UnknownOutcomeError) {
    return {
      title: "We could not confirm what happened",
      body: "The server may have received your request. Retrying with the same details is safe; the server ignores duplicates.",
    };
  }
  if (error instanceof V2ApiError) {
    switch (error.code) {
      case "UNAUTHENTICATED":
        return { title: "Sign in to continue", body: "Your session ended. Sign in again to continue." };
      case "FORBIDDEN":
        return { title: "Not available for this account", body: "This action is not available for your account." };
      case "NOT_FOUND":
        return { title: "Not available", body: "This is no longer available. Refresh and try again." };
      case "INVALID_INPUT":
        return { title: "Check the entered details", body: error.message };
      case "OUT_OF_AREA":
        return { title: "Outside the service area", body: "We do not serve this postal code yet." };
      case "NO_CAPACITY":
        return { title: "That slot is full", body: "Pick another pickup time." };
      case "DEADLINE_UNAVAILABLE":
        return { title: "That return time is not available", body: "Pick another pickup time." };
      case "QUOTE_EXPIRED":
        return { title: "Quote expired", body: "Request fresh terms to continue." };
      case "VERSION_CONFLICT":
        return {
          title: "Terms changed",
          body: error.currentVersion
            ? `The server now holds version ${error.currentVersion}. Request fresh terms to continue.`
            : "The terms changed on the server. Request fresh terms to continue.",
        };
      case "IDEMPOTENCY_CONFLICT":
        return { title: "Already processed", body: "This request was already processed with different details. Start again with fresh terms." };
      case "RATE_LIMITED":
        return { title: "Too many attempts", body: "Wait a moment and try again." };
      case "PROVIDER_UNAVAILABLE":
        return { title: "Not configured in this environment", body: "This step needs a provider that is not set up here yet." };
      default:
        return { title: "Something went wrong", body: error.message };
    }
  }
  if (error instanceof Error && error.message) {
    return { title: "Something went wrong", body: error.message };
  }
  return { title: "Something went wrong", body: "Try again." };
}
