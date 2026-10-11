import { describe, expect, it, vi } from "vitest";
import { ApiError, createClient } from "../src/index.js";
import { demoOrder, demoQuote, demoQuoteInput, demoServices } from "@wandary/test-fixtures";

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
});
