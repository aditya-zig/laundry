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
import { parseFacilityRecord, type FacilityDraft } from "../features/FacilityRecordForm";
import { OperationsWorkspaceView, SignInView } from "./ProductOperationsApp";
import { SupportConsole } from "../features/SupportConsole";

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

describe("facility intake and quality commands", () => {
  const bag: v2.Container = { id: "88000000-0000-4000-8000-000000000001", sealId: "PHYSICAL-SEAL-1", sealed: true, condition: "GOOD", garmentCount: 9 };
  const intake: Omit<v2.IntakeRecord, "expectedVersion"> = {
    lines: [{ orderLineId: LINE_ID, measuredWeightGrams: 4700, countedQuantity: 9, condition: "GOOD" }],
    containers: [bag], mediaIds: [],
  };

  it("records measured intake through the SDK with the current version, not the estimate", async () => {
    const h = harness();
    const foundation = await authedFoundationWith(h, facilityActor);
    h.on(r => r.path.endsWith("/intake"), r => {
      expect(r.body).toEqual({ ...intake, expectedVersion: 3 });
      expect(r.headers["Idempotency-Key"]).toBe("intake-key");
      return { ok: true, json: orderOf({ status: "AWAITING_ADJUSTMENT", version: 4 }) };
    });
    const controller = createCareActionController({ runAuthorized: run => foundation.authorized(run), generateKey: () => "intake-key" });
    const result = await controller.recordIntake(orderOf({ status: "PICKUP_PENDING" }), "FACILITY", intake);
    expect(result?.status).toBe("AWAITING_ADJUSTMENT");
    expect(h.calls).toHaveLength(1);
  });

  it("retains immutable measured facts and command identity after an unknown intake outcome", async () => {
    const h = harness();
    const foundation = await authedFoundationWith(h, facilityActor);
    const edited = structuredClone(intake);
    h.on(r => r.path.endsWith("/intake"), () => ({ fail: true }));
    h.on(r => r.path.endsWith("/intake"), () => ({ ok: true, json: orderOf({ version: 4 }) }));
    const controller = createCareActionController({ runAuthorized: run => foundation.authorized(run), generateKey: () => "same-intake-key" });
    expect(await controller.recordIntake(orderOf({ status: "PICKUP_PENDING" }), "FACILITY", edited)).toBeNull();
    const pending = controller.getState();
    expect(pending.phase).toBe("unknown");
    if (pending.phase !== "unknown" || !("kind" in pending.input) || pending.input.kind !== "INTAKE") throw new Error("Expected retained intake command");
    expect(Object.isFrozen(pending.input.record.lines[0])).toBe(true);
    expect(Object.isFrozen(pending.input.record.containers[0])).toBe(true);
    edited.lines[0].measuredWeightGrams = 9000;
    edited.containers[0].sealId = "EDITED";
    expect(await controller.recordIntake(orderOf({ status: "PICKUP_PENDING" }), "FACILITY", edited)).toBeNull();
    expect(await controller.retry()).not.toBeNull();
    expect(h.calls[1].body).toEqual(h.calls[0].body);
    expect(h.calls[1].headers["Idempotency-Key"]).toBe(h.calls[0].headers["Idempotency-Key"]);
  });

  it.each([503, 500, 408, 429])("retains an intake command after an HTTP %s error envelope instead of issuing a new identity", async status => {
    const h = harness();
    const foundation = await authedFoundationWith(h, facilityActor);
    h.on(r => r.path.endsWith("/intake"), () => ({ ok: false, status, json: { code: "PROVIDER_OUTCOME_UNKNOWN", message: "The committed reply was lost", traceId: "intake-lost-reply", retryable: true } }));
    h.on(r => r.path.endsWith("/intake"), () => ({ ok: true, json: orderOf({ version: 4 }) }));
    let generated = 0;
    const controller = createCareActionController({ runAuthorized: run => foundation.authorized(run), generateKey: () => `intake-key-${++generated}` });
    expect(await controller.recordIntake(orderOf({ status: "PICKUP_PENDING" }), "FACILITY", intake)).toBeNull();
    expect(controller.getState().phase).toBe("unknown");
    expect(await controller.recordIntake(orderOf({ status: "PICKUP_PENDING" }), "FACILITY", intake)).toBeNull();
    expect(await controller.retry()).not.toBeNull();
    expect(generated).toBe(1);
    expect(h.calls[1].body).toEqual(h.calls[0].body);
    expect(h.calls[1].headers["Idempotency-Key"]).toBe(h.calls[0].headers["Idempotency-Key"]);
  });

  it("records a failed quality check with its reason and preserves rework instead of inventing readiness", async () => {
    const h = harness();
    const foundation = await authedFoundationWith(h, operatorActor);
    const qc = { passed: false, note: "Visible stain; rewash required", containers: [bag], mediaIds: [] };
    h.on(r => r.path.endsWith("/quality-check"), r => {
      expect(r.body).toEqual({ ...qc, expectedVersion: 3 });
      return { ok: true, json: orderOf({ status: "IN_CARE", version: 4 }) };
    });
    const controller = createCareActionController({ runAuthorized: run => foundation.authorized(run), generateKey: () => "qc-key" });
    expect((await controller.recordQualityCheck(orderOf({ status: "QUALITY_CHECK" }), "OPERATOR", qc))?.status).toBe("IN_CARE");
  });

  it("blocks wrong roles/states and rejects invalid measured facts before sending", async () => {
    const h = harness();
    const foundation = await authedFoundationWith(h, facilityActor);
    const controller = createCareActionController({ runAuthorized: run => foundation.authorized(run), generateKey: () => "must-not-send" });
    expect(await controller.recordIntake(orderOf({ status: "PICKUP_PENDING" }), "CUSTOMER", intake)).toBeNull();
    expect(await controller.recordIntake(orderOf({ status: "CONFIRMED" }), "FACILITY", intake)).toBeNull();
    expect(await controller.recordIntake(orderOf({ status: "PICKUP_PENDING" }), "FACILITY", { ...intake, lines: [{ orderLineId: LINE_ID, condition: "GOOD" }] })).toBeNull();
    expect(await controller.recordQualityCheck(orderOf({ status: "QUALITY_CHECK" }), "FACILITY", { passed: false, containers: [bag], mediaIds: [] })).toBeNull();
    expect(h.calls).toHaveLength(0);
    expect(controller.getState().phase).toBe("rejected");
  });

  it("does not silently upgrade physical facts from a stale form after a detail refresh", async () => {
    const h = harness();
    const foundation = await authedFoundationWith(h, facilityActor);
    const controller = createCareActionController({ runAuthorized: run => foundation.authorized(run), generateKey: () => "must-not-send" });
    const stale = { ...intake, expectedVersion: 2 };
    expect(await controller.recordIntake(orderOf({ status: "PICKUP_PENDING", version: 3 }), "FACILITY", stale)).toBeNull();
    expect(controller.getState()).toMatchObject({ phase: "rejected", code: "VERSION_CONFLICT", currentVersion: 3 });
    expect(h.calls).toHaveLength(0);
  });

  it("retires a denied QC command and uses a fresh key/version after a server refresh", async () => {
    const h = harness();
    const foundation = await authedFoundationWith(h, operatorActor);
    let generated = 0;
    const controller = createCareActionController({ runAuthorized: run => foundation.authorized(run), generateKey: () => `qc-key-${++generated}` });
    const qc = { passed: true, containers: [bag], mediaIds: [] };
    h.on(r => r.path.endsWith("/quality-check"), () => ({ ok: false, status: 409, json: { code: "VERSION_CONFLICT", message: "Order changed", traceId: "qc-version-conflict", retryable: true, currentVersion: 4 } }));
    expect(await controller.recordQualityCheck(orderOf({ status: "QUALITY_CHECK" }), "OPERATOR", qc)).toBeNull();
    expect(controller.getState()).toMatchObject({ phase: "rejected", code: "VERSION_CONFLICT", currentVersion: 4 });
    expect(await controller.retry()).toBeNull();
    h.on(r => r.path.endsWith("/quality-check"), () => ({ ok: true, json: orderOf({ status: "READY_FOR_RETURN", version: 5 }) }));
    expect((await controller.recordQualityCheck(orderOf({ status: "QUALITY_CHECK", version: 4 }), "OPERATOR", qc))?.status).toBe("READY_FOR_RETURN");
    expect(h.calls[0].headers["Idempotency-Key"]).toBe("qc-key-1");
    expect(h.calls[1].headers["Idempotency-Key"]).toBe("qc-key-2");
    expect(h.calls[1].body).toMatchObject({ expectedVersion: 4 });
  });

  it("gives support staff their text console without a forbidden facility queue or fulfillment controls", () => {
    const foundation = newFoundation(harness());
    const actor: v2.Actor = { ...operatorActor, role: "SUPPORT" };
    const markup = renderToStaticMarkup(createElement(OperationsWorkspaceView, {
      actor, queue: { kind: "idle" }, detail: { kind: "idle" }, attempt: { phase: "idle" },
      supportTools: createElement(SupportConsole, { foundation, actorId: actor.id }),
    }));
    expect(markup).toContain('Customer support workspace');
    expect(markup).toContain('aria-label="Staff support console"');
    expect(markup).toContain('Load support cases');
    expect(markup).not.toContain('aria-label="Order queue"');
    expect(markup).not.toContain('Start care');
  });

  it("shows a physical measurement form only to permitted staff at pickup intake", () => {
    const selected = orderOf({ status: "PICKUP_PENDING" });
    const html = (actor: v2.Actor) => renderToStaticMarkup(createElement(OperationsWorkspaceView, {
      actor, queue: { kind: "idle" }, detail: { kind: "ready", orderId: selected.id, order: selected, loadedAt: "2026-10-12T05:00:00Z", stale: false }, attempt: { phase: "idle" },
    }));
    expect(html(facilityActor)).toContain('data-testid="ops-intake-form"');
    expect(html(facilityActor)).toContain("Measured weight (grams)");
    expect(html(facilityActor)).toContain('>Condition</label><select');
    expect(html({ ...facilityActor, role: "CUSTOMER" })).not.toContain('data-testid="ops-intake-form"');
    const qc = orderOf({ status: "QUALITY_CHECK" });
    const qcHtml = renderToStaticMarkup(createElement(OperationsWorkspaceView, {
      actor: facilityActor, queue: { kind: "idle" }, detail: { kind: "ready", orderId: qc.id, order: qc, loadedAt: "2026-10-12T05:00:00Z", stale: false }, attempt: { phase: "idle" },
    }));
    expect(qcHtml).toContain('>Inspection result</label><select');
  });
});

describe("physical facility record validation", () => {
  function draft(): FacilityDraft {
    return {
      confirmed: true, result: "", note: "",
      bags: [{ id: "88000000-0000-4000-8000-000000000001", sealId: "SEAL-A", sealed: true, condition: "GOOD", garmentCount: "9", weightGrams: "" }],
      lines: [{ orderLineId: LINE_ID, quantity: "4700", countedQuantity: "9", condition: "GOOD", note: "" }],
    };
  }
  it("keeps measured PIECE quantity separate from an accessory-inclusive count", () => {
    const order = orderOf({ lines: [{ orderLineId: LINE_ID, serviceId: SERVICE_ID, billingUnit: "PIECE", garmentTypeId: "77000000-0000-4000-8000-000000000012", pieceQuantity: 2, unitPriceMinor: 10000, lineTotalMinor: 20000, provisional: false }] });
    const input = draft(); input.lines[0].quantity = "3"; input.lines[0].countedQuantity = "8";
    const record = parseFacilityRecord("INTAKE", order, input);
    expect(record.kind).toBe("INTAKE");
    if (record.kind !== "INTAKE") throw new Error("wrong command");
    expect(record.record.lines[0]).toMatchObject({ measuredPieceQuantity: 3, countedQuantity: 8 });
    expect(record.record.lines[0]).not.toHaveProperty("measuredWeightGrams");
    expect(record.record.mediaIds).toEqual([]);
  });
  it.each(["", " ", "-1", "1.5", "1e3", "9007199254740992"])("rejects invalid physical integer %j instead of inventing a zero or estimate", text => {
    const input = draft(); input.lines[0].quantity = text;
    expect(() => parseFacilityRecord("INTAKE", orderOf(), input)).toThrow();
  });
  it("requires explicit physical confirmation, conditions and each line exactly once", () => {
    const input = draft(); input.confirmed = false;
    expect(() => parseFacilityRecord("INTAKE", orderOf(), input)).toThrow("Confirm the physical");
    input.confirmed = true; input.lines[0].condition = "";
    expect(() => parseFacilityRecord("INTAKE", orderOf(), input)).toThrow();
    input.lines = [];
    expect(() => parseFacilityRecord("INTAKE", orderOf(), input)).toThrow("each order line");
  });
  it('preserves an explicitly entered pickup inventory UUID separately from the physical seal label', () => {
    const input = draft();
    input.bags[0].id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    expect(parseFacilityRecord('INTAKE', orderOf(), input).record.containers[0]).toMatchObject({ id: input.bags[0].id, sealId: 'SEAL-A' });
  });
  it.each(['', 'SEAL-A', 'not-a-uuid'])('rejects an invalid inventory UUID %j without allocating a replacement', id => {
    const input = draft(); input.bags[0].id = id;
    expect(() => parseFacilityRecord('INTAKE', orderOf(), input)).toThrow('bag inventory UUID');
    expect(input.bags[0].id).toBe(id);
  });
  it("requires distinct physical bag labels rather than accepting duplicated inventory", () => {
    const input = draft(); input.bags.push({ ...input.bags[0], id: "88000000-0000-4000-8000-000000000002" });
    expect(() => parseFacilityRecord("INTAKE", orderOf(), input)).toThrow("labels must be unique");
    input.bags[1].sealId = "SEAL-B";
    expect(parseFacilityRecord("INTAKE", orderOf(), input).record.containers).toHaveLength(2);
  });
  it("requires an explicit QC result and a reason for rework", () => {
    const input = draft();
    expect(() => parseFacilityRecord("QUALITY_CHECK", orderOf(), input)).toThrow("actual inspection");
    input.result = "REWORK";
    expect(() => parseFacilityRecord("QUALITY_CHECK", orderOf(), input)).toThrow();
    input.note = "Stain still visible";
    const result = parseFacilityRecord("QUALITY_CHECK", orderOf(), input);
    expect(result.record).toMatchObject({ passed: false, note: "Stain still visible", expectedVersion: 3 });
  });
});

describe("sign-in controller (OTP + optional TOTP)", () => {
  it("keeps failed local credential erasure visible instead of announcing successful logout", async () => {
    const wire = harness();
    const real = newFoundation(wire);
    const foundation = { ...real, logout: async () => ({ localCredsCleared: false, serverRevocationConfirmed: true, revocationError: null }) };
    const controller = new SignInController({ foundation, publicClient: () => real.getPlainV2Client() });
    await controller.signOut();
    expect(controller.getState().phase).toBe("collectPhone");
    expect(controller.lastError()).toMatchObject({ code: "LOGOUT_INCOMPLETE" });
    expect(controller.lastError()?.message).toContain("could not be erased");
  });
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
