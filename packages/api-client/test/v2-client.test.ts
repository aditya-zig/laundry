import { describe, expect, it, vi } from "vitest";
import { createV2Client, UnknownOutcomeError, V2ApiError } from "../src/v2.js";

interface Call {
  url: string;
  init: RequestInit;
}

function stub(calls: Call[], respond: (call: Call) => Response | Promise<Response>) {
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  });
  return fetchImpl as unknown as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const errorEnvelope = {
  code: "VERSION_CONFLICT",
  message: "stale version",
  traceId: "trace-1",
  retryable: false,
  currentVersion: 4,
};

describe("v2 client headers", () => {
  it("sends an idempotency key on a mutation", async () => {
    const calls: Call[] = [];
    const client = createV2Client({
      baseUrl: "http://api.test/v2",
      fetchImpl: stub(calls, () => json({ challengeId: "c1" })),
    });

    await client.requestOtp("+919000000000");

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBeTruthy();
    expect(calls[0].url).toBe("http://api.test/v2/identity/otp");
  });

  it("reuses a caller supplied idempotency key", async () => {
    const calls: Call[] = [];
    const client = createV2Client({
      fetchImpl: stub(calls, () => json({ challengeId: "c1" })),
    });

    await client.requestOtp("+919000000000", { idempotencyKey: "key-42" });

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("key-42");
  });

  it("never sends an idempotency key on a read", async () => {
    const calls: Call[] = [];
    const client = createV2Client({
      fetchImpl: stub(calls, () => json([])),
    });

    await client.listServices();

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBeUndefined();
    expect(calls[0].init.method).toBe("GET");
  });

  it("sends the bearer token when one is available", async () => {
    const calls: Call[] = [];
    const client = createV2Client({
      getToken: () => "session-token",
      fetchImpl: stub(calls, () => json([])),
    });

    await client.listServices();

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer session-token");
  });
});

describe("v2 client errors", () => {
  it("raises a typed error that carries the envelope", async () => {
    const calls: Call[] = [];
    const client = createV2Client({
      fetchImpl: stub(calls, () => json(errorEnvelope, 409)),
    });

    const error = await client.listServices().catch((e) => e);
    expect(error).toBeInstanceOf(V2ApiError);
    expect((error as V2ApiError).code).toBe("VERSION_CONFLICT");
    expect((error as V2ApiError).status).toBe(409);
    expect((error as V2ApiError).traceId).toBe("trace-1");
    expect((error as V2ApiError).currentVersion).toBe(4);
  });

  it("raises an unknown outcome error when the network fails", async () => {
    const calls: Call[] = [];
    const client = createV2Client({
      fetchImpl: stub(calls, () => {
        throw new Error("socket hang up");
      }),
    });

    const error = await client.requestOtp("+919000000000").catch((e) => e);
    expect(error).toBeInstanceOf(UnknownOutcomeError);
    expect((error as UnknownOutcomeError).outcome).toBe("UNKNOWN");
  });

  it("does not retry on its own", async () => {
    const calls: Call[] = [];
    const client = createV2Client({
      fetchImpl: stub(calls, () => {
        throw new Error("socket hang up");
      }),
    });

    await client.requestOtp("+919000000000").catch(() => undefined);
    expect(calls).toHaveLength(1);
  });

  it("rejects a response that does not match its schema", async () => {
    const calls: Call[] = [];
    const client = createV2Client({
      fetchImpl: stub(calls, () => json({ nonsense: true })),
    });

    await expect(client.listServices()).rejects.toBeTruthy();
  });
});

describe("v2 mutation recovery", () => {
  it("returns the generated key after a lost response so an explicit retry reuses it", async () => {
    const calls: Call[] = [];
    const generateKey = vi.fn(() => "booking-intent-1");
    const client = createV2Client({
      generateKey,
      fetchImpl: stub(calls, () => {
        if (calls.length === 1) throw new Error("response lost after commit");
        return json({ challengeId: "c1" });
      }),
    });

    let failure: unknown;
    try {
      await client.requestOtp("+919000000000");
    } catch (error) {
      failure = error;
    }
    expect(calls).toHaveLength(1);
    expect(failure).toBeInstanceOf(UnknownOutcomeError);
    if (!(failure instanceof UnknownOutcomeError)) throw failure;
    expect(failure).toHaveProperty("idempotencyKey", "booking-intent-1");
    const key = failure.idempotencyKey;
    if (typeof key !== "string") throw new Error("The recovery key is missing");

    await client.requestOtp("+919000000000", { idempotencyKey: key });
    expect(generateKey).toHaveBeenCalledTimes(1);
    expect(calls[1].init.headers).toMatchObject({ "Idempotency-Key": key });
    expect(calls[1].init.body).toBe(calls[0].init.body);
  });

  it("retains the key on a retryable server error without retrying", async () => {
    const calls: Call[] = [];
    const client = createV2Client({
      generateKey: () => "intent-503",
      fetchImpl: stub(calls, () => json({
        code: "PROVIDER_UNAVAILABLE",
        message: "temporarily unavailable",
        traceId: "trace-503",
        retryable: true,
      }, 503)),
    });
    await expect(client.requestOtp("+919000000000")).rejects.toMatchObject({
      name: "V2ApiError",
      idempotencyKey: "intent-503",
      status: 503,
      retryable: true,
    });
    expect(calls).toHaveLength(1);
  });

  it("treats an unreadable successful mutation response as unknown", async () => {
    const calls: Call[] = [];
    const client = createV2Client({
      generateKey: () => "intent-invalid-json",
      fetchImpl: stub(calls, () => new Response("truncated {", { status: 201 })),
    });
    await expect(client.requestOtp("+919000000000")).rejects.toMatchObject({
      name: "UnknownOutcomeError",
      idempotencyKey: "intent-invalid-json",
      outcome: "UNKNOWN",
    });
    expect(calls).toHaveLength(1);
  });

  it("retains the key when the successful response violates the schema", async () => {
    const calls: Call[] = [];
    const client = createV2Client({
      generateKey: () => "intent-invalid-order",
      fetchImpl: stub(calls, () => json({ unexpected: true }, 201)),
    });
    await expect(client.bookOrder({
      quoteId: "44444444-4444-4444-8444-444444444444",
      paymentModel: "DUE_AT_RETURN",
    })).rejects.toMatchObject({
      name: "UnknownOutcomeError",
      idempotencyKey: "intent-invalid-order",
    });
    expect(calls).toHaveLength(1);
  });

  it("rejects an invalid explicit key before sending a request", async () => {
    const calls: Call[] = [];
    const client = createV2Client({ fetchImpl: stub(calls, () => json({})) });
    await expect(client.requestOtp("+919000000000", {
      idempotencyKey: "",
    })).rejects.toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("retains the explicit key if the response body stream disconnects", async () => {
    const cause = new Error("response stream disconnected");
    const calls: Call[] = [];
    const generateKey = vi.fn(() => "unused");
    const client = createV2Client({
      generateKey,
      fetchImpl: stub(calls, () => new Response(new ReadableStream({
        start(controller) { controller.error(cause); },
      }), { status: 200 })),
    });
    await expect(client.requestOtp("+919000000000", {
      idempotencyKey: "intent-stream",
    })).rejects.toMatchObject({
      name: "UnknownOutcomeError",
      idempotencyKey: "intent-stream",
      cause,
    });
    expect(generateKey).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it("keeps the key on an unstructured server error", async () => {
    const calls: Call[] = [];
    const client = createV2Client({
      generateKey: () => "intent-unstructured",
      fetchImpl: stub(calls, () => json({ proxy: "upstream lost" }, 502)),
    });
    await expect(client.requestOtp("+919000000000")).rejects.toMatchObject({
      name: "UnknownOutcomeError",
      idempotencyKey: "intent-unstructured",
    });
    expect(calls).toHaveLength(1);
  });

  it("does not classify a failed read as an unknown business mutation", async () => {
    const failure = new Error("connection refused");
    const calls: Call[] = [];
    const client = createV2Client({
      fetchImpl: stub(calls, () => { throw failure; }),
    });
    await expect(client.listServices()).rejects.toBe(failure);
    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers).not.toHaveProperty("Idempotency-Key");
  });
});
