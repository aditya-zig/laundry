import { describe, expect, it, vi } from "vitest";
import { ApiError, createClient } from "../src/index.js";
import { demoOrder, demoQuote, demoQuoteInput, demoServices } from "@laundry/test-fixtures";

type FetchMock = (url: string, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("api-client integration (mocked transport)", () => {
  it("lists services as a direct array from GET /services with no auth header", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(demoServices));
    const client = createClient({ fetchImpl: fetchImpl as typeof fetch });
    const services = await client.listServices();
    expect(services).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:4100/v1/services");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("creates a quote with QuoteInput body, bearer token, and idempotency key", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(demoQuote));
    const client = createClient({
      fetchImpl: fetchImpl as typeof fetch,
      getToken: () => "tok-123",
      generateKey: () => "fixed-key-1",
    });
    const quote = await client.createQuote(demoQuoteInput);
    expect(quote.id).toBe(demoQuote.id);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:4100/v1/quotes");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok-123");
    expect(headers["Idempotency-Key"]).toBe("fixed-key-1");
    expect(JSON.parse(init.body as string).addressId).toBe(demoQuoteInput.addressId);
  });

  it("parses error envelopes into ApiError with code and retryable flag", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ code: "VERSION_CONFLICT", message: "stale", traceId: "t-1", retryable: false }, 409)
    );
    const client = createClient({ fetchImpl: fetchImpl as typeof fetch });
    try {
      await client.getOrder(demoOrder.id);
      expect.unreachable("expected ApiError");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("VERSION_CONFLICT");
      expect((err as ApiError).status).toBe(409);
      expect((err as ApiError).retryable).toBe(false);
    }
  });

  it("confirms conversation drafts with revision-bound payloads", async () => {
    const checkout = { orderId: demoOrder.id, paymentId: "13131313-1313-4131-8131-131313131313", paymentUrl: "https://pay.example.com/c/1", expiresAt: "2026-10-11T16:00:00.000Z", status: "AWAITING_PAYMENT" };
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(checkout));
    const client = createClient({ fetchImpl: fetchImpl as typeof fetch });
    const draftId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const result = await client.confirmDraft(draftId, 2, demoQuote.id);
    expect(result.orderId).toBe(demoOrder.id);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://localhost:4100/v1/conversation-drafts/${draftId}/confirm`);
    expect(JSON.parse(init.body as string)).toMatchObject({ draftId, revision: 2, quoteId: demoQuote.id });
  });

  it("reuses a caller-supplied idempotency key so a failed checkout retries as one operation", async () => {
    const checkout = { orderId: demoOrder.id, paymentId: "13131313-1313-4131-8131-131313131313", paymentUrl: "https://pay.example.com/c/1", expiresAt: "2026-10-11T16:00:00.000Z", status: "AWAITING_PAYMENT" };
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(checkout));
    const client = createClient({
      fetchImpl: fetchImpl as typeof fetch,
      generateKey: () => "generated-should-not-win",
    });
    await client.createCheckout(demoQuote.id, { idempotencyKey: "retry-key-1" });
    await client.createCheckout(demoQuote.id, { idempotencyKey: "retry-key-1" });
    const keys = fetchImpl.mock.calls.map(
      ([, init]) => (init as RequestInit).headers as Record<string, string>,
    ).map((h) => h["Idempotency-Key"]);
    expect(keys).toEqual(["retry-key-1", "retry-key-1"]);
    const bodies = fetchImpl.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
    expect(bodies[0]).toEqual({ quoteId: demoQuote.id });
  });

  it("sends expectedVersion on handover instead of dropping it during validation", async () => {
    const job = demoOrder.deliveries[0];
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(job));
    const client = createClient({ fetchImpl: fetchImpl as typeof fetch });
    await client.handoverJob(job.id, {
      actionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      bagIds: ["bag-1"],
      method: "OTP",
      otp: "123456",
      capturedAt: "2026-10-11T11:00:00.000Z",
      expectedVersion: 3,
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ jobId: job.id, expectedVersion: 3, method: "OTP" });
  });

  it("parses conversation messages as typed drafts with an optional quote", async () => {
    const payload = {
      draft: {
        draftId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        revision: 2,
        state: "QUOTED",
        quoteId: demoQuote.id,
        expiresAt: "2026-10-12T10:00:00.000Z",
        missingFields: [],
      },
      reply: "Here is your quote.",
      missingFields: [],
      quote: demoQuote,
    };
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(payload));
    const client = createClient({ fetchImpl: fetchImpl as typeof fetch });
    const result = await client.postConversationMessage("five shirts tomorrow");
    expect(result.draft.revision).toBe(2);
    expect(result.draft.quoteId).toBe(demoQuote.id);
    expect(result.quote?.id).toBe(demoQuote.id);
  });

  it("reads customer-only demo handover codes without manufacturing a return code", async () => {
    const payload = { orderId: demoOrder.id, pickupOtp: "123456", note: "Demo only" };
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(payload));
    const client = createClient({ fetchImpl: fetchImpl as typeof fetch, getToken: () => "customer-token" });
    const codes = await client.getDemoHandoverCodes(demoOrder.id);
    expect(codes.pickupOtp).toBe("123456");
    expect(codes.returnOtp).toBeUndefined();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`http://localhost:4100/v1/orders/${demoOrder.id}/handover-code`);
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer customer-token");
  });

  it("sends explicit operator assignment and current version on dispatch", async () => {
    const job = demoOrder.deliveries[0];
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(job));
    const client = createClient({ fetchImpl: fetchImpl as typeof fetch });
    await client.dispatchDelivery(job.id, { assignedTo: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", expectedVersion: 3 });
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init!.body as string)).toEqual({ assignedTo: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", expectedVersion: 3 });
  });

  it("checks service-area eligibility against GET /service-areas/check", async () => {
    const payload = { serviceable: true, areaId: "demo-area-bengaluru", hours: "09:00-18:00 Asia/Kolkata" };
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(payload));
    const client = createClient({ fetchImpl: fetchImpl as typeof fetch });
    const result = await client.checkServiceArea();
    expect(result.serviceable).toBe(true);
    expect(result.areaId).toBe("demo-area-bengaluru");
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:4100/v1/service-areas/check");
  });
});
