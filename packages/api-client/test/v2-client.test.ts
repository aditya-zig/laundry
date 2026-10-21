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
