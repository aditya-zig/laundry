import { UnknownOutcomeError } from "@laundry/api-client";
import type { v2 } from "@laundry/contracts";

export type BookResult =
  | { phase: "booked"; order: v2.Order }
  | { phase: "unknown" }
  | { phase: "failed"; error: unknown };

export interface Booker {
  attempt(input: v2.BookingInput): Promise<BookResult | null>;
}

export function createBooker(book: (input: v2.BookingInput) => Promise<v2.Order>): Booker {
  let inFlight = false;
  return {
    async attempt(input) {
      if (inFlight) return null;
      inFlight = true;
      try {
        const order = await book(input);
        return { phase: "booked", order };
      } catch (error) {
        if (error instanceof UnknownOutcomeError) return { phase: "unknown" };
        return { phase: "failed", error };
      } finally {
        inFlight = false;
      }
    },
  };
}
