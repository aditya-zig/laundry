// Owned F04 behavior tests: real SDK client + real session foundation over a
// scripted fetch transport. Fixtures exist only to drive API-level behavior.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createMemoryPendingMutationStore,
  createMemorySecureTokenStore,
  createSessionFoundation,
  type SessionFoundation,
} from "@laundry/app-foundation";
import { createV2Client, type V2Client } from "@laundry/api-client";
import type { v2 } from "@laundry/contracts";
import { SignInController } from "../features/signIn";
import { createQueueController, prioritiseQueue } from "../features/opsQueue";
import { createOrderDetailController } from "../features/orderDetail";
import {
  createCareActionController,
  nextStaffCareAction,
} from "../features/careActions";
import { formatWindow, formatInrMinor, shortId } from "../features/format";
import { OperationsWorkspaceView, SignInView } from "./ProductOperationsApp";

type RecordedCall = {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
};
type HandlerReply =
  | { ok: true; json: unknown }
  | { ok: false; status: number; json: unknown }
  | { fail: true };

function harness() {
  const calls: RecordedCall[] = [];
  let steps: Array<{ match: (req: RecordedCall) => boolean; step: (req: RecordedCall) => HandlerReply }> = [];
  const fetchImpl = async (_url: string, init?: RequestInit): Promise<Response> => {
    const method = String(init?.method ?? "GET");
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    const headers: Record<string, string> = { ...((init?.headers ?? {}) as Record<string, string>) };
    const path = new URL(String(_url)).pathname;
    const req: RecordedCall = { method, path, body, headers };
    calls.push(req);
    for (let index = 0; index < steps.length; index++) {
      const candidate = steps[index];
      if (candidate.match(req)) {
        steps.splice(index, 1);
        const out = candidate.step(req);
        if ("fail" in out) throw new TypeError("network interrupted");
        const status = out.ok ? 200 : out.status;
        return new Response(JSON.stringify(out.json), {
          status,
          headers: { "content-type": "application/json" },
        });
      }
    }
    throw new Error(`No scripted handler for ${method} ${path}`);
  };
  function on(match: (req: RecordedCall) => boolean, step: (req: RecordedCall) => HandlerReply): void {
    steps.push({ match, step });
  }
  return { calls, on, fetchImpl };
}

function newFoundation(h: { fetchImpl: unknown }, configure?: { clock?: () => Date }): SessionFoundation {
  return createSessionFoundation({
    wireClient: (getToken) =>
      createV2Client({
        baseUrl: "http://localhost:4100/v2",
        fetchImpl: h.fetchImpl as typeof fetch,
        getToken,
        generateKey: () => "generated-key",
      }),
    refreshTokenStore: createMemorySecureTokenStore(),
    pendingMutationStore: createMemoryPendingMutationStore(),
    generateKey: () => "generated-key",
    clock: configure?.clock ?? (() => new Date("2026-10-12T05:00:00Z")),
  });
}

async function authedFoundationWith(h: { fetchImpl: unknown }, actor: v2.Actor): Promise<SessionFoundation> {
  const foundation = newFoundation(h);
  await foundation.adoptAuthenticatedSession(sessionOf(actor));
  return foundation;
}

const FACILITY_ID = "f1100000-0000-4000-8000-000000000001";
const ORDER_A = "aaaa0000-0000-4000-8000-00000000000a";
const ORDER_B = "bbbb0000-0000-4000-8000-00000000000b";
const CUSTOMER_ID = "c0000000-0000-4000-8000-0000000000c1";
const SERVICE_ID = "77000000-0000-4000-8000-000000000011";
const LINE_ID = "99000000-0000-4000-8000-000000000033";
const CHALLENGE_ID = "cc000000-0000-4000-8000-0000000000cc";
const SESSION_ID = "ee000000-0000-4000-8000-0000000000ee";

const WINDOW = {
  start: "2026-10-12T03:30:00Z",
  end: "2026-10-12T04:30:00Z",
  timezone: "Asia/Kolkata",
};

function orderOf(overrides: Partial<v2.Order> = {}): v2.Order {
  return {
    id: ORDER_A,
    version: 3,
    status: "AT_FACILITY",
    customerId: CUSTOMER_ID,
    facilityId: FACILITY_ID,
    lines: [{
      orderLineId: LINE_ID,
      serviceId: SERVICE_ID,
      billingUnit: "KG",
      estimatedWeightGrams: 4500,
      declaredGarmentCount: 9,
      unitPriceMinor: 10000,
      lineTotalMinor: 450000,
      provisional: false,
    }],
    totalMinor: 450000,
    currency: "INR",
    paymentModel: "DUE_AT_RETURN",
    pickupWindow: WINDOW,
    promisedReturnWindow: {
      start: "2026-10-14T04:00:00.000Z",
      end: "2026-10-14T14:00:00.000Z",
      timezone: "Asia/Kolkata",
    },
    createdAt: "2026-10-11T10:00:00.000Z",
    timeline: [{ status: "AT_FACILITY", label: "Received at the facility", at: "2026-10-12T04:40:00.000Z" }],
    containers: [],
    permittedActions: [],
    deliveryLegs: [{ leg: "PICKUP", status: "COMPLETED", version: 2 }],
    ...overrides,
  };
}

const facilityActor: v2.Actor = {
  id: "00000000-0000-4000-8000-0000000000aa",
  role: "FACILITY",
  facilityIds: [FACILITY_ID],
  scope: { facilityIds: [FACILITY_ID] },
};
const operatorActor: v2.Actor = { ...facilityActor, role: "OPERATOR" };

function sessionOf(actor: v2.Actor): v2.Session {
  return {
    sessionId: SESSION_ID,
    accessToken: "session-access-token",
    refreshToken: "session-refresh-token",
    expiresAt: "2090-01-01T00:00:00.000Z",
    actor,
  };
}

describe("sign-in controller (OTP + optional TOTP)", () => {
  it("requests an OTP with only the phone, then verifies with code and TOTP second factor", async () => {
    const h = harness();
    const foundation = newFoundation(h);
    const signIn = new SignInController({ foundation, publicClient: () => foundation.getPlainV2Client() });
    h.on((req) => req.path === "/v2/identity/otp", () => ({
      ok: true,
      json: { challengeId: CHALLENGE_ID, expiresAt: "2026-10-12T05:10:00.000Z" },
    }));
    await signIn.requestOtp("+919000000001");
    expect(signIn.getState().phase).toBe("collectCode");
    h.on((req) => req.path === "/v2/identity/otp/verify", () => ({ ok: true, json: sessionOf(operatorActor) }));
    await signIn.verifyOtp("123456", "654321");
    const verify = h.calls.find((call) => call.path === "/v2/identity/otp/verify")!;
    expect(verify.body).toEqual({ challengeId: CHALLENGE_ID, code: "123456", mfaCode: "654321" });
    expect(verify.headers["Idempotency-Key"]).toBe("generated-key");
    expect(signIn.getState().phase).toBe("signedIn");
    expect(foundation.getActor()?.role).toBe("OPERATOR");
  });

  it("omits mfaCode for staff not enrolled yet and shows API failures with code/traceId", async () => {
    const h = harness();
    const foundation = newFoundation(h);
    const signIn = new SignInController({
      foundation,
      publicClient: () => foundation.getPlainV2Client(),
    });
    h.on((req) => req.path === "/v2/identity/otp", () => ({
      ok: true,
      json: { challengeId: CHALLENGE_ID, expiresAt: "2026-10-12T05:10:00.000Z" },
    }));
    h.on((req) => req.path === "/v2/identity/otp/verify", () => ({
      ok: false,
      status: 401,
      json: { code: "UNAUTHENTICATED", message: "The code did not match.", traceId: "trace-1", retryable: false },
    }));
    await signIn.requestOtp("+919000000002");
    await signIn.verifyOtp("000000");
    const verify = h.calls.find((call) => call.path === "/v2/identity/otp/verify")!;
    expect(verify.body).toEqual({ challengeId: CHALLENGE_ID, code: "000000" });
    expect(verify.body).not.toHaveProperty("mfaCode");
    expect(signIn.getState().phase).toBe("collectCode");
    const error = signIn.lastError();
    expect(error?.code).toBe("UNAUTHENTICATED");
    expect(error?.traceId).toBe("trace-1");
    expect(renderToStaticMarkup(createElement(SignInView, {
      state: signIn.getState(),
      error: signIn.lastError(),
      onPhoneSubmit: () => undefined,
      onVerify: () => undefined,
      onBackToPhone: () => undefined,
    }))).toContain("The code did not match.");
  });

  it("rejects an invalid phone before any network call", async () => {
    const h = harness();
    const foundation = newFoundation(h);
    const signIn = new SignInController({
      foundation,
      publicClient: () => foundation.getPlainV2Client(),
    });
    await signIn.requestOtp("90000");
    expect(h.calls).toHaveLength(0);
    expect(signIn.lastError()?.code).toBe("INVALID_INPUT");
    expect(signIn.getState().phase).toBe("collectPhone");
  });
});

describe("queue controller states against the ops queue route", () => {
  it("loads the server queue with a freshness stamp and no client-side scoping tricks", async () => {
    const h = harness();
    const foundation = await authedFoundationWith(h, operatorActor);
    const queue = createQueueController({
      runAuthorized: (run) => foundation.authorized(run),
      clock: () => new Date("2026-10-12T05:00:00Z"),
    });
    h.on((req) => req.path === "/v2/ops/orders/queue", () => ({
      ok: true,
      json: { items: [orderOf()], pageInfo: { hasMore: false } },
    }));
    await queue.refresh();
    const state = queue.getState();
    expect(state.kind).toBe("ready");
    if (state.kind === "ready") {
      expect(state.items.map((order) => order.id)).toEqual([ORDER_A]);
      expect(state.loadedAt).toBe("2026-10-12T05:00:00.000Z");
      expect(state.stale).toBe(false);
    }
    const list = h.calls.find((call) => call.path === "/v2/ops/orders/queue")!;
    expect(list.method).toBe("GET");
  });

  it("keeps the previous rows and marks stale for a transient service outage", async () => {
    const h = harness();
    const foundation = await authedFoundationWith(h, facilityActor);
    const queue = createQueueController({
      runAuthorized: (run) => foundation.authorized(run),
      clock: () => new Date("2026-10-12T05:00:00Z"),
    });
    h.on((req) => req.path === "/v2/ops/orders/queue", () => ({
      ok: true,
      json: { items: [orderOf()], pageInfo: { hasMore: false } },
    }));
    await queue.refresh();
    h.on((req) => req.path === "/v2/ops/orders/queue", () => ({
      ok: false,
      status: 503,
      json: { code: "PROVIDER_UNAVAILABLE", message: "Service temporarily unavailable.", traceId: "trace-2", retryable: true },
    }));
    await queue.refresh();
    const state = queue.getState();
    expect(state.kind).toBe("ready");
    if (state.kind === "ready") {
      expect(state.items).toHaveLength(1);
      expect(state.refreshError?.code).toBe("PROVIDER_UNAVAILABLE");
      expect(state.stale).toBe(true);
    }
  });

  it("erases the queue when facility authorization is revoked", async () => {
    const h = harness(), foundation = await authedFoundationWith(h, facilityActor);
    const queue = createQueueController({ runAuthorized: run => foundation.authorized(run) });
    h.on(req => req.path === "/v2/ops/orders/queue", () => ({ ok: true, json: { items: [orderOf()], pageInfo: { hasMore: false } } }));
    await queue.refresh();
    h.on(req => req.path === "/v2/ops/orders/queue", () => ({ ok: false, status: 403,
      json: { code: "FORBIDDEN", message: "Facility authorization revoked", traceId: "synthetic", retryable: false } }));
    await queue.refresh();
    expect(queue.getState()).toMatchObject({ kind: "error", error: { code: "FORBIDDEN" } });
    expect(JSON.stringify(queue.getState())).not.toContain(ORDER_A);
  });

  it("cannot restore cleared private rows from a late queue response", async () => {
    const h = harness(), foundation = await authedFoundationWith(h, facilityActor);
    const queue = createQueueController({ runAuthorized: run => foundation.authorized(run) });
    h.on(req => req.path === "/v2/ops/orders/queue", () => ({ ok: true, json: { items: [orderOf()], pageInfo: { hasMore: false } } }));
    const refresh = queue.refresh();
    queue.clear();
    await refresh;
    expect(queue.getState()).toEqual({ kind: "idle" });
  });

  it("renders an explicit in-frame empty state, never fabricated rows", async () => {
    const h = harness();
    const foundation = await authedFoundationWith(h, facilityActor);
    const queue = createQueueController({
      runAuthorized: (run) => foundation.authorized(run),
      clock: () => new Date("2026-10-12T05:00:00Z"),
    });
    h.on((req) => req.path === "/v2/ops/orders/queue", () => ({
      ok: true,
      json: { items: [], pageInfo: { hasMore: false } },
    }));
    await queue.refresh();
    const markup = renderToStaticMarkup(createElement(OperationsWorkspaceView, {
      actor: facilityActor,
      queue: queue.getState(),
      detail: { kind: "idle" },
      attempt: { phase: "idle" },
    }));
    expect(markup).toContain("No orders in this queue yet.");
  });

  it("prioritises exception orders ahead of resting ones deterministically", () => {
    const held = orderOf({ id: ORDER_B, status: "ON_HOLD", createdAt: "2026-10-11T18:00:00.000Z" });
    const gatherable = orderOf({ status: "AT_FACILITY", createdAt: "2026-10-11T09:00:00.000Z" });
    const delivered = orderOf({
      id: "dddd0000-0000-4000-8000-0000000000d1",
      status: "DELIVERED",
      createdAt: "2026-10-11T20:00:00.000Z",
    });
    const sorted = prioritiseQueue([delivered, held, gatherable]);
    expect(sorted.map((order) => order.status)).toEqual(["ON_HOLD", "AT_FACILITY", "DELIVERED"]);
  });
});

describe("order detail and staff care action", () => {
  async function wiredUp(actor: v2.Actor) {
    const h = harness();
    const foundation = await authedFoundationWith(h, actor);
    return {
      h,
      foundation,
      detail: createOrderDetailController({
        runAuthorized: (run) => foundation.authorized(run),
        clock: () => new Date("2026-10-12T05:00:00Z"),
      }),
      care: createCareActionController({
        runAuthorized: (run) => foundation.authorized(run),
        generateKey: () => "wired-care-key",
        clock: () => new Date("2026-10-12T05:00:00Z"),
      }),
    };
  }

  it("renders DTO facts only: unit-appropriate quantities, minor-unit totals, timezone windows", async () => {
    const wired = await wiredUp(facilityActor);
    const order = orderOf({
      measuredLines: [{ orderLineId: LINE_ID, measuredWeightGrams: 5300, condition: "GOOD" }],
      containers: [{ id: "0a000000-0000-4000-8000-00000000000a", sealed: true, condition: "GOOD", garmentCount: 9, weightGrams: 5300 }],
    });
    wired.h.on((req) => req.path === `/v2/orders/${ORDER_A}`, () => ({ ok: true, json: order }));
    await wired.detail.select(ORDER_A);
    const state = wired.detail.getState();
    expect(state.kind).toBe("ready");
    if (state.kind !== "ready") throw new Error("detail not ready");
    const markup = renderToStaticMarkup(createElement(OperationsWorkspaceView, {
      actor: facilityActor,
      queue: {
        kind: "ready",
        items: [orderOf()],
        pageInfo: { hasMore: false },
        loadedAt: "2026-10-12T05:00:00.000Z",
        lastGoodAt: "2026-10-12T05:00:00.000Z",
        stale: false,
      },
      detail: state,
      attempt: { phase: "idle" },
    }));
    expect(markup).toContain(formatInrMinor(450000));
    expect(markup).toContain("4,500 g");
    expect(markup).toContain("Measured 5,300 g");
    expect(markup).toContain("Asia/Kolkata");
    expect(markup).toContain(shortId(ORDER_A));
  });

  it("starts care with the retained key, exact contract DTO, then adopts the response", async () => {
    const wired = await wiredUp(operatorActor);
    wired.h.on((req) => req.path === `/v2/ops/orders/${ORDER_A}/care`, () => ({
      ok: true,
      json: orderOf({ version: 4, status: "IN_CARE" }),
    }));
    const updated = await wired.care.begin(orderOf(), "OPERATOR");
    const carePost = wired.h.calls.find((call) => call.path.endsWith("/care"))!;
    expect(carePost.body).toEqual({ target: "IN_CARE", expectedVersion: 3 });
    expect(carePost.headers["Idempotency-Key"]).toBe("wired-care-key");
    expect(carePost.headers["Authorization"]).toBe("Bearer session-access-token");
    expect(updated?.status).toBe("IN_CARE");
    expect(wired.care.getState().phase).toBe("idle");
  });

  it("shares one in-flight care command instead of generating new keys for double clicks", async () => {
    const wired = await wiredUp(operatorActor);
    wired.h.on(req => req.path.endsWith("/care"), () => ({ ok: true, json: orderOf({ version: 4, status: "IN_CARE" }) }));
    const results = await Promise.all([wired.care.begin(orderOf(), "OPERATOR"), wired.care.begin(orderOf(), "OPERATOR")]);
    expect(wired.h.calls.filter(call => call.path.endsWith("/care"))).toHaveLength(1);
    expect(results[1]).toBeNull();
  });

  it("does not resurrect a cleared care result after identity invalidation", async () => {
    const wired = await wiredUp(operatorActor);
    wired.h.on(req => req.path.endsWith("/care"), () => ({ ok: true, json: orderOf({ version: 4, status: "IN_CARE" }) }));
    const pending = wired.care.begin(orderOf(), "OPERATOR");
    wired.care.clear();
    expect(await pending).toBeNull();
    expect(wired.care.getState()).toEqual({ phase: "idle" });
  });

  it("blocks care while the customer has not accepted an intake adjustment (F04-02) and sends nothing", async () => {
    const wired = await wiredUp(facilityActor);
    const order = orderOf({
      status: "AWAITING_ADJUSTMENT",
      adjustment: {
        id: "b0000000-0000-4000-8000-00000000000b",
        version: 1,
        reason: "Extra weight measured at intake",
        previousTotalMinor: 450000,
        newTotalMinor: 456000,
        deltaMinor: 6000,
        state: "PROPOSED",
        expiresAt: "2026-10-13T05:00:00.000Z",
      },
    });
    const action = nextStaffCareAction(order, "FACILITY");
    expect(action.target).toBeUndefined();
    expect(action.blockedReason).toMatch(/customer/);
    const before = wired.h.calls.length;
    await wired.care.begin(order, "FACILITY");
    expect(wired.h.calls.length - before).toBe(0);
    expect(wired.care.getState().phase).toBe("idle");
  });

  it("surfaces version conflicts with the server's current version and does not fake success", async () => {
    const wired = await wiredUp(operatorActor);
    wired.h.on((req) => req.path.endsWith("/care"), () => ({
      ok: false,
      status: 409,
      json: { code: "VERSION_CONFLICT", message: "Order changed on the server.", traceId: "trace-3", retryable: true, currentVersion: 7 },
    }));
    await wired.care.begin(orderOf(), "OPERATOR");
    const state = wired.care.getState();
    expect(state.phase).toBe("rejected");
    if (state.phase === "rejected") {
      expect(state.code).toBe("VERSION_CONFLICT");
      expect(state.currentVersion).toBe(7);
    }
  });

  it("on an unknown outcome, retries the identical command with the same key; no false success", async () => {
    const wired = await wiredUp(operatorActor);
    wired.h.on((req) => req.path.endsWith("/care"), () => ({ fail: true }));
    await wired.care.begin(orderOf(), "OPERATOR");
    const state = wired.care.getState();
    expect(state.phase).toBe("unknown");
    if (state.phase !== "unknown") throw new Error("expected unknown");
    expect(state.input).toEqual({ orderId: ORDER_A, target: "IN_CARE", expectedVersion: 3 });
    wired.h.on((req) => req.path.endsWith("/care"), () => ({
      ok: true,
      json: orderOf({ version: 4, status: "IN_CARE" }),
    }));
    await wired.care.retry();
    const carePosts = wired.h.calls.filter((call) => call.path.endsWith("/care"));
    expect(carePosts).toHaveLength(2);
    expect(carePosts[0].body).toEqual({ target: "IN_CARE", expectedVersion: 3 });
    expect(carePosts[1].body).toEqual({ target: "IN_CARE", expectedVersion: 3 });
    expect(carePosts[0].headers["Idempotency-Key"]).toBe("wired-care-key");
    expect(carePosts[1].headers["Idempotency-Key"]).toBe("wired-care-key");
    expect(wired.care.getState().phase).toBe("idle");
  });

  it("a SUPPORT role cannot start care; FACILITY can (F04-01 role honesty)", () => {
    expect(nextStaffCareAction(orderOf(), "SUPPORT").blockedReason).toMatch(/facility and operator/);
    expect(nextStaffCareAction(orderOf(), "FACILITY").target).toBe("IN_CARE");
  });
});

describe("format helpers", () => {
  it("formats integer minor units and timezone-qualified windows", () => {
    expect(formatInrMinor(44900)).toBe("₹449.00");
    expect(formatInrMinor(0)).toBe("₹0.00");
    expect(formatWindow(WINDOW)).toContain("09:00");
    expect(formatWindow(WINDOW)).toContain("Asia/Kolkata");
  });
});
