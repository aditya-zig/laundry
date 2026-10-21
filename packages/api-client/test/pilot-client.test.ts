import { describe, expect, it, vi } from "vitest";
import { ApiError, createClient } from "../src/index.js";

type FetchMock = (url: string, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const order = {
  id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  version: 3,
  customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  riderId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  slotId: "5f2b0a10-1111-4111-8111-111111111111",
  serviceCode: "WASH_FOLD",
  status: "AWAITING_APPROVAL",
  pickupStatus: "COMPLETED",
  returnStatus: "PENDING",
  paymentStatus: "UNPAID",
  estimatedWeightGrams: 5000,
  measuredWeightGrams: 6000,
  rateMinorPerKg: 6000,
  totalMinor: 30000,
  proposedTotalMinor: 36000,
  currency: "INR",
  address: { line: "14 Demo Lane", lat: 12.975, lng: 77.642 },
  timeZone: "Asia/Kolkata",
  pickupStart: "2026-10-22T14:30:00.000Z",
  pickupEnd: "2026-10-22T15:30:00.000Z",
  returnStart: "2026-10-23T02:30:00.000Z",
  returnEnd: "2026-10-23T03:30:00.000Z",
  pickupCodeExpiresAt: "2026-10-23T03:30:00.000Z",
  returnCodeExpiresAt: "2026-10-24T03:30:00.000Z",
  createdAt: "2026-10-21T10:00:00.000Z",
  pickupCode: "123456",
  holdReason: null,
  events: [{ action: "BOOKED", label: "Slot reserved", at: "2026-10-21T10:00:00.000Z" }],
};

const config = {
  demo: true,
  ratesApproved: false,
  timeZone: "Asia/Kolkata",
  services: [{ code: "WASH_FOLD", name: "Wash and fold", rateMinorPerKg: 6000 }],
  slots: [
    {
      id: "5f2b0a10-1111-4111-8111-111111111111",
      timeZone: "Asia/Kolkata",
      pickupStart: "2026-10-22T14:30:00.000Z",
      pickupEnd: "2026-10-22T15:30:00.000Z",
      returnStart: "2026-10-23T02:30:00.000Z",
      returnEnd: "2026-10-23T03:30:00.000Z",
      capacity: 3,
      reserved: 1,
    },
  ],
  facility: { name: "Demo laundry", lat: 12.9784, lng: 77.6408 },
  demoBoundary: { south: 12.96, north: 12.99, west: 77.625, east: 77.66 },
};

const location = {
  lat: 12.9784,
  lng: 77.6408,
  capturedAt: "2026-10-21T10:05:00.000Z",
  reportedAt: "2026-10-21T10:05:01.000Z",
  source: "BROWSER_GEOLOCATION",
  ageSeconds: 42,
  stale: false,
  staleAfterSeconds: 120,
};

describe("pilot client methods", () => {
  it("reads the pilot configuration from GET /pilot/config", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(config));
    const client = createClient({ fetchImpl: fetchImpl as typeof fetch });
    const result = await client.pilotConfig();
    expect(result.demo).toBe(true);
    expect(result.ratesApproved).toBe(false);
    expect(result.slots[0].capacity).toBe(3);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:4100/v1/pilot/config");
    expect(init.method).toBe("GET");
  });

  it("books an order with an idempotency key and the kg estimate", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(order));
    const client = createClient({
      fetchImpl: fetchImpl as typeof fetch,
      getToken: () => "tok-customer",
      generateKey: () => "fixed-key-2",
    });
    const booked = await client.pilotCreateOrder({
      serviceCode: "WASH_FOLD",
      estimatedWeightGrams: 5000,
      slotId: config.slots[0].id,
      address: { line: "14 Demo Lane", lat: 12.975, lng: 77.642 },
    });
    expect(booked.id).toBe(order.id);
    expect(booked.proposedTotalMinor).toBe(36000);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:4100/v1/pilot/orders");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok-customer");
    expect(headers["Idempotency-Key"]).toBe("fixed-key-2");
    expect(JSON.parse(init.body as string).estimatedWeightGrams).toBe(5000);
  });

  it("sends an action with its expected version", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(order));
    const client = createClient({ fetchImpl: fetchImpl as typeof fetch });
    await client.pilotAction(order.id, { action: "APPROVE_PRICE", expectedVersion: 3 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://localhost:4100/v1/pilot/orders/${order.id}/actions`);
    expect(JSON.parse(init.body as string)).toEqual({ action: "APPROVE_PRICE", expectedVersion: 3 });
  });

  it("updates slot capacity with PUT", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ...config.slots[0], capacity: 6 }));
    const client = createClient({ fetchImpl: fetchImpl as typeof fetch });
    const slot = await client.pilotSetSlotCapacity(config.slots[0].id, 6);
    expect(slot.capacity).toBe(6);
    expect(slot.reserved).toBe(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://localhost:4100/v1/pilot/slots/${config.slots[0].id}`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ capacity: 6 });
  });

  it("reports a position with its provenance and reads it back", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(location));
    const client = createClient({ fetchImpl: fetchImpl as typeof fetch });
    const reported = await client.pilotReportLocation(order.id, {
      lat: 12.9784,
      lng: 77.6408,
      capturedAt: "2026-10-21T10:05:00.000Z",
      source: "BROWSER_GEOLOCATION",
    });
    expect(reported.source).toBe("BROWSER_GEOLOCATION");
    expect(reported.stale).toBe(false);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://localhost:4100/v1/pilot/orders/${order.id}/location`);
    expect(JSON.parse(init.body as string).source).toBe("BROWSER_GEOLOCATION");
  });

  it("turns a pilot error envelope into an ApiError", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ code: "VERSION_CONFLICT", message: "stale", traceId: "t-2", retryable: false }, 409),
    );
    const client = createClient({ fetchImpl: fetchImpl as typeof fetch });
    try {
      await client.pilotAction(order.id, { action: "START_CARE", expectedVersion: 1 });
      expect.unreachable("expected ApiError");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("VERSION_CONFLICT");
      expect((error as ApiError).status).toBe(409);
    }
  });
});
