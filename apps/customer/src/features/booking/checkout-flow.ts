import { v2 } from "@laundry/contracts";
import { requestedReturnFor, searchRange } from "./schedule";

/** Server slot-pair queries only — the client never types a schedule or invents capacity. */
export function buildSlotQuery(args: { areaId: string; now: Date; serviceIds: string[] }): v2.SlotQuery {
  const serviceIds = [...new Set(args.serviceIds)];
  if (serviceIds.length === 0) throw new Error("Add at least one service to your bag first");
  const range = searchRange(args.now);
  return { areaId: args.areaId, from: range.from, to: range.to, serviceIds };
}

export function buildQuoteInput(args: {
  addressId: string;
  pair: v2.SlotPair;
  lines: v2.RequestedLine[];
  timezone: string;
}): v2.QuoteInput {
  if (args.lines.length === 0) throw new Error("Your bag is empty");
  return {
    addressId: args.addressId,
    lines: args.lines,
    pickupWindow: args.pair.pickupWindow,
    requestedReturnBy: requestedReturnFor(args.pair),
    timezone: args.timezone,
  };
}

/** Retains the quoted version; payment is due at return per product policy. */
export function buildBookingInput(quote: Pick<v2.Quote, "id" | "version">): v2.BookingInput {
  return { quoteId: quote.id, expectedVersion: quote.version, paymentModel: "DUE_AT_RETURN" };
}

export type SignInPrompt = { step: "PHONE"; reason: string } | { step: "CODE" };

/** Public sign-in needs no session; phones must be dialable before an OTP is spent. */
export function nextSignInPrompt(phone: string): SignInPrompt {
  if (v2.phoneSchema.safeParse(phone.trim()).success) return { step: "CODE" };
  return { step: "PHONE", reason: "Enter a phone number with country code, for example +919876543210." };
}

export function otpValid(code: string): boolean {
  return /^\d{6}$/.test(code.trim());
}
