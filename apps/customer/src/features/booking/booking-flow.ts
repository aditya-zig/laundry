import { isMutationOutcomePending } from "@laundry/app-foundation";
import { v2 } from "@laundry/contracts";

export type BookResult =
  | { phase: "booked"; order: v2.Order }
  | { phase: "unknown" }
  | { phase: "failed"; error: unknown };

export interface Booker {
  attempt(input?: v2.BookingInput): Promise<BookResult | null>;
  pendingInput(): v2.BookingInput | null;
}

export function createBooker(book: (input: v2.BookingInput) => Promise<v2.Order>, pending?: v2.BookingInput): Booker {
  let inFlight = false;
  let retained = pending ? v2.bookingInputSchema.parse(pending) : null;
  return {
    pendingInput: () => retained ? { ...retained } : null,
    async attempt(input) {
      if (inFlight) return null;
      let candidate: v2.BookingInput;
      try { candidate = v2.bookingInputSchema.parse(input ?? retained); }
      catch (error) { return { phase: "failed", error }; }
      // Changed terms cannot supersede an original command that might have committed.
      if (retained && (candidate.quoteId !== retained.quoteId || candidate.expectedVersion !== retained.expectedVersion)) return { phase: "unknown" };
      retained = candidate;
      inFlight = true;
      try {
        const order = await book({ ...retained });
        retained = null;
        return { phase: "booked", order };
      } catch (error) {
        if (isMutationOutcomePending(error)) return { phase: "unknown" };
        retained = null;
        return { phase: "failed", error };
      } finally {
        inFlight = false;
      }
    },
  };
}
