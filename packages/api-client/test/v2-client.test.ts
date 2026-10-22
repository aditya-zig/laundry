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

const id = "11111111-1111-4111-8111-111111111111";
const challenge = { challengeId: id, expiresAt: "2026-10-22T09:00:00Z" };
const handover = { legAttemptId: id, expectedVersion: 1, actionId: id, method: "CODE" as const, code: "123456", capturedAt: "2026-10-22T09:00:00Z", containerIds: [id], garmentCount: 5, condition: "GOOD" as const };
const location = { expectedVersion: 1, lat: 12, lng: 77, reportedAt: "2026-10-22T09:00:00Z" };
const manualPayment = { expectedVersion: 1, amountMinor: 100, currency: "INR" as const, method: "CASH" as const, reason: "Synthetic cash received" };
const moderation = { expectedVersion: 1, decision: "PUBLISH" as const, reason: "Consent checked" };
const rewash = { expectedVersion: 1, reason: "Synthetic quality issue" };
const incidentInput = { orderId: id, category: "QUALITY" as const, summary: "Synthetic quality issue", mediaIds: [] };

describe("v2 client headers", () => {
  it("sends an idempotency key on a mutation", async () => {
    const calls: Call[] = [];
    const client = createV2Client({
      baseUrl: "http://api.test/v2",
      fetchImpl: stub(calls, () => json(challenge)),
    });

    await client.requestOtp("+919000000000");

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBeTruthy();
    expect(calls[0].url).toBe("http://api.test/v2/identity/otp");
  });

  it("reuses a caller supplied idempotency key", async () => {
    const calls: Call[] = [];
    const client = createV2Client({
      fetchImpl: stub(calls, () => json(challenge)),
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
        return json(challenge);
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
      expectedVersion: 1,
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

describe("v2 identity validation", () => {
  it.each([
    {},
    { challengeId: id },
    { ...challenge, demoCode: "123456" },
  ])("rejects an invalid production OTP response %j", async (body) => {
    const calls: Call[] = [];
    const client = createV2Client({ fetchImpl: stub(calls, () => json(body)) });
    await expect(client.requestOtp("+919000000000", { idempotencyKey: "otp-1" }))
      .rejects.toMatchObject({ name: "UnknownOutcomeError", idempotencyKey: "otp-1" });
    expect(calls).toHaveLength(1);
  });

  it("rejects an incomplete session after OTP verification", async () => {
    const calls: Call[] = [];
    const client = createV2Client({ fetchImpl: stub(calls, () => json({ token: "demo" })) });
    await expect(client.verifyOtp(id, "123456")).rejects.toBeInstanceOf(UnknownOutcomeError);
  });

  it("validates the authenticated actor and owned address responses", async () => {
    const calls: Call[] = [];
    const client = createV2Client({ fetchImpl: stub(calls, () => json({})) });
    await expect(client.me()).rejects.toBeTruthy();
    await expect(client.createAddress({
      label: "Home", line1: "Synthetic address", city: "Bengaluru",
      postalCode: "560038", coordinates: { lat: 12.97, lng: 77.64 },
    })).rejects.toBeInstanceOf(UnknownOutcomeError);
  });

  it("does not send an invalid phone number", async () => {
    const calls: Call[] = [];
    const client = createV2Client({ fetchImpl: stub(calls, () => json(challenge)) });
    await expect(async () => client.requestOtp("123")).rejects.toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});

describe("v2 canonical endpoints", () => {
  const cases: Array<{
    name: string;
    method: string;
    path: string;
    invoke: (client: ReturnType<typeof createV2Client>) => Promise<unknown>;
  }> = [
    { name: "logout", method: "POST", path: "/identity/logout", invoke: c => c.logout() },
    { name: "ops queue", method: "GET", path: "/ops/orders/queue", invoke: c => c.listOpsOrders() },
    { name: "finalize", method: "POST", path: `/media/${id}/finalize`, invoke: c => c.finalizeUpload(id) },
    { name: "download", method: "POST", path: `/media/${id}/download`, invoke: c => c.getDownloadUrl(id) },
    { name: "handover", method: "POST", path: "/rider/handovers", invoke: c => c.recordHandover(id, handover) },
    { name: "location", method: "POST", path: "/rider/location", invoke: c => c.reportLocation(id, location) },
    { name: "manual payment", method: "POST", path: `/ops/billing/obligations/${id}/confirm-manual`, invoke: c => c.confirmManualPayment(id, manualPayment) },
    { name: "reconciliation", method: "POST", path: "/ops/billing/reconciliation", invoke: c => c.reconciliation("2026-10") },
    { name: "moderation", method: "POST", path: `/ops/reviews/${id}/moderation`, invoke: c => c.moderateReview(id, moderation) },
    { name: "dead letters", method: "GET", path: "/ops/jobs/dead-letter", invoke: c => c.listDeadLetters() },
    { name: "exception", method: "POST", path: `/ops/orders/${id}/exceptions/resolve`, invoke: c => c.resolveException(id, { action: "RESUME", reason: "Issue resolved" }, 1) },
    { name: "rewash", method: "POST", path: `/incidents/${id}/rewash-requests`, invoke: c => c.requestRewash(id, rewash) },
    { name: "incident", method: "POST", path: `/orders/${id}/incidents`, invoke: c => c.createIncident(incidentInput) },
    { name: "public reviews", method: "GET", path: `/reviews?serviceId=${id}`, invoke: c => c.listPublicReviews(id) },
  ];

  it.each(cases)("uses the canonical $name endpoint", async ({ method, path, invoke }) => {
    const calls: Call[] = [];
    const client = createV2Client({
      baseUrl: "https://api.test/v2/",
      fetchImpl: stub(calls, () => json(errorEnvelope, 409)),
    });
    await expect(invoke(client)).rejects.toBeInstanceOf(V2ApiError);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://api.test/v2${path}`);
    expect(calls[0].init.method).toBe(method);
  });
});

describe("v2 request and response boundaries", () => {
  const actor = { id, role: "CUSTOMER", facilityIds: [], scope: { facilityIds: [] } };
  const session = {
    sessionId: id, accessToken: "test-access", refreshToken: "test-refresh",
    expiresAt: "2026-10-22T09:00:00.000Z", actor,
  };

  it("returns validated sessions and sends the refresh credential explicitly", async () => {
    const calls: Call[] = [];
    const client = createV2Client({ fetchImpl: stub(calls, () => json(session)) });
    expect(await client.verifyOtp(id, "123456")).toMatchObject(session);
    expect(await client.refreshSession("test-refresh")).toMatchObject(session);
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ refreshToken: "test-refresh" });
    expect(calls[1].url.endsWith("/identity/session/refresh")).toBe(true);
  });

  it("sends the expected address version on deletion", async () => {
    const calls: Call[] = [];
    const client = createV2Client({ fetchImpl: stub(calls, () => json({ id, deleted: true })) });
    expect(await client.deleteAddress(id, 3)).toEqual({ id, deleted: true });
    expect(calls[0].init.method).toBe("DELETE");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ expectedVersion: 3 });
  });

  it("sends one flat adjustment decision", async () => {
    const calls: Call[] = [];
    const client = createV2Client({ fetchImpl: stub(calls, () => json(errorEnvelope, 409)) });
    await expect(client.decideAdjustment(id, id, 2, "ACCEPT", 4)).rejects.toBeInstanceOf(V2ApiError);
    expect(calls[0].url.endsWith(`/orders/${id}/adjustments/decision`)).toBe(true);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      adjustmentId: id, adjustmentVersion: 2, decision: "ACCEPT", expectedVersion: 4,
    });
  });

  it("sends a review intent without requiring server-owned fields", async () => {
    const calls: Call[] = [];
    const client = createV2Client({ fetchImpl: stub(calls, () => json(errorEnvelope, 409)) });
    const input = { orderId: id, expectedVersion: 4, overall: 5, mediaIds: [], publishConsent: true };
    await expect(client.createReview(input)).rejects.toBeInstanceOf(V2ApiError);
    expect(calls[0].url.endsWith(`/orders/${id}/reviews`)).toBe(true);
    expect(JSON.parse(String(calls[0].init.body))).toEqual(input);
    const forgedInput = { ...input, publication: "PUBLISHED" };
    await expect(async () => client.createReview(forgedInput))
      .rejects.toBeTruthy();
    expect(calls).toHaveLength(1);
  });

  it("keeps rider job IDs in commands whose paths no longer contain them", async () => {
    const calls: Call[] = [];
    const client = createV2Client({ fetchImpl: stub(calls, () => json(errorEnvelope, 409)) });
    await expect(client.recordHandover(id, handover)).rejects.toBeInstanceOf(V2ApiError);
    await expect(client.reportLocation(id, location)).rejects.toBeInstanceOf(V2ApiError);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ ...handover, jobId: id, capturedAt: "2026-10-22T09:00:00.000Z" });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ ...location, jobId: id, reportedAt: "2026-10-22T09:00:00.000Z" });
  });

  it("sends reconciliation as an explicit keyed command", async () => {
    const calls: Call[] = [];
    const client = createV2Client({ fetchImpl: stub(calls, () => json(errorEnvelope, 409)) });
    await expect(client.reconciliation("2026-10", { idempotencyKey: "reconcile-oct" })).rejects.toBeInstanceOf(V2ApiError);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ period: "2026-10" });
    expect(calls[0].init.headers).toMatchObject({ "Idempotency-Key": "reconcile-oct" });
  });

  it("preserves cursor metadata on paginated lists", async () => {
    const calls: Call[] = [];
    const page = { items: [], pageInfo: { hasMore: true, nextCursor: "next-test-page" } };
    const client = createV2Client({ fetchImpl: stub(calls, () => json(page)) });
    for (const read of [
      () => client.listOrders(), () => client.listObligations(),
      () => client.listReceipts(id), () => client.listRefunds(),
      () => client.listIncidents(), () => client.listIncidentMessages(id),
      () => client.listPublicReviews(id), () => client.listOpsOrders(),
    ]) {
      expect(await read()).toEqual(page);
    }
  });

  it("reads a billing summary instead of parsing it as an obligation", async () => {
    const calls: Call[] = [];
    const summary = {
      orderId: id, obligationStatus: "OPEN", amountDueMinor: 15000,
      amountSettledMinor: 0, currency: "INR", receipts: [], refunds: [],
      dueAt: "2026-10-22T09:00:00.000Z",
    };
    const client = createV2Client({ fetchImpl: stub(calls, () => json(summary)) });
    expect(await client.getObligation(id)).toMatchObject(summary);
  });
});
