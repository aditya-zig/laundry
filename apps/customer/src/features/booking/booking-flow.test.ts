import { describe, expect, it, vi } from "vitest";
import { UnknownOutcomeError, V2ApiError } from "@laundry/api-client";
import { v2 } from "@laundry/contracts";
import { createBooker } from "./booking-flow";

const QUOTE = "66666666-6666-4666-8666-666666666666";

const input: v2.BookingInput = { quoteId: QUOTE, expectedVersion: 2, paymentModel: "DUE_AT_RETURN" };

const order = { id: "77777777-7777-4777-8777-777777777777", status: "CONFIRMED" } as unknown as v2.Order;

describe("F01-04 booking guard", () => {
  it("sends the wire-validated booking input once per tap", async () => {
    let resolve!: (value: v2.Order) => void;
    const book = vi.fn(() => new Promise<v2.Order>((r) => { resolve = r; }));
    const booker = createBooker(book);

    const inFlight = booker.attempt(input);
    expect(book).toHaveBeenCalledTimes(1);
    expect(await booker.attempt(input)).toBeNull();

    resolve(order);
    const result = await inFlight;
    expect(result).toEqual({ phase: "booked", order });
    expect(book).toHaveBeenCalledWith(input);
    expect(v2.bookingInputSchema.parse(input)).toEqual(input);

    const retry = booker.attempt(input);
    expect(book).toHaveBeenCalledTimes(2);
    resolve(order);
    expect(await retry).toEqual({ phase: "booked", order });
  });

  it("keeps unknown outcomes retryable with the identical booking input", async () => {
    const calls: v2.BookingInput[] = [];
    const book = async (attempt: v2.BookingInput) => {
      calls.push(attempt);
      throw new UnknownOutcomeError("lost", undefined, "key-1");
    };
    const booker = createBooker(book);

    const first = await booker.attempt(input);
    expect(first).toEqual({ phase: "unknown" });
    const second = await booker.attempt(input);
    expect(second).toEqual({ phase: "unknown" });
    expect(calls[1]).toEqual(input);
  });

  it("reports definitive server rejections as failed", async () => {
    const book = async () => {
      throw new V2ApiError(409, { code: "VERSION_CONFLICT", message: "quote changed", traceId: "t", retryable: true, currentVersion: 5 }, "key-2");
    };
    const booker = createBooker(book);
    const result = await booker.attempt(input);
    expect(result).toMatchObject({ phase: "failed" });
    if (result && result.phase === "failed") {
      expect((result.error as V2ApiError).code).toBe("VERSION_CONFLICT");
    }
  });

  it("clears the in-flight guard after a failure", async () => {
    let calls = 0;
    const book = async () => {
      calls++;
      if (calls === 1) throw new V2ApiError(409, { code: "QUOTE_EXPIRED", message: "expired", traceId: "t", retryable: false }, "key-3");
      return order;
    };
    const booker = createBooker(book);
    await booker.attempt(input);
    const second = await booker.attempt(input);
    expect(second).toEqual({ phase: "booked", order });
  });
});
