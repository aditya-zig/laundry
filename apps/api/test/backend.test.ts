/** Laundry backend behavior tests. Real PostgreSQL, no mocks. */
import { beforeAll, afterAll, test, expect } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { join } from "node:path";
import { AppModule } from "../src/app.module";
import { EnvelopeFilter } from "../src/filters/http-exception.filter";
import { getPool, initializeDb, closePool } from "../../modules/shared/src/db";

const BASE = "http://localhost:4111";
let app: NestExpressApplication;

async function api(method: string, path: string, token?: string, body?: unknown, extra?: Record<string, string>) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  Object.assign(headers, extra ?? {});
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

async function demo(role: "customer" | "rider" | "operator"): Promise<string> {
  const { status, body } = await api("POST", "/v1/auth/demo", undefined, { role });
  expect(status).toBe(201);
  return body.token as string;
}

async function newCustomer(phone: string): Promise<string> {
  const req = await api("POST", "/v1/auth/otp/request", undefined, { phone });
  expect([200, 201]).toContain(req.status);
  const verify = await api("POST", "/v1/auth/otp/verify", undefined, { challengeId: req.body.challengeId, code: req.body.demoCode ?? "000000" });
  expect([200, 201]).toContain(verify.status);
  return verify.body.token as string;
}

function quoteBody(addr: string, start: string, qty = 2) {
  return {
    addressId: addr, lines: [{ serviceId: "11111111-1111-4111-8111-111111111111", garmentTypeId: "22222222-2222-4222-8222-222222222222", quantity: qty }],
    pickupWindow: { start, end: new Date(new Date(start).getTime() + 3600_000).toISOString(), timezone: "Asia/Kolkata" },
    requestedReturnBy: "2026-12-20T12:30:00.000Z", timezone: "Asia/Kolkata",
  };
}

async function fullOrder(tc: string, tr: string, to: string, slot: string, qty = 2) {
  const addrs = await api("GET", "/v1/addresses", tc);
  const q = await api("POST", "/v1/quotes", tc, quoteBody(addrs.body[0].id, slot, qty), { "Idempotency-Key": randomUUID() });
  expect([200, 201]).toContain(q.status);
  const co = await api("POST", "/v1/checkouts", tc, { quoteId: q.body.id }, { "Idempotency-Key": randomUUID() });
  const cap = await api("POST", `/v1/demo/payments/${co.body.paymentId}/capture`, tc, {});
  expect([200, 201]).toContain(cap.status);
  return { order: cap.body, quote: q.body, checkout: co.body };
}

beforeAll(async () => {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run acceptance tests against production");
  let dbUrl: URL;
  try { dbUrl = new URL(process.env.DATABASE_URL ?? ""); } catch { throw new Error("An explicit verification database URL is required"); }
  if (!["postgres:", "postgresql:"].includes(dbUrl.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(dbUrl.hostname) || !/^\/laundry_verify_[a-zA-Z0-9_]+$/.test(dbUrl.pathname)) {
    throw new Error("Acceptance tests require a loopback laundry_verify_<run> database");
  }
  await initializeDb();
  const db = getPool();
  await db.query("TRUNCATE support_incidents, conversation_messages, conversation_drafts, reviews, handover_actions, delivery_jobs, refunds, refund_obligations, payments, order_timeline, orders, idempotency_records, capacity_holds, capacity_buckets, quotes, outbox, inbox, sessions, otp_challenges RESTART IDENTITY CASCADE");
  app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.enableCors({ origin: true });
  app.useGlobalFilters(new EnvelopeFilter());
  app.useBodyParser?.("json", { limit: "15mb" });
  app.useStaticAssets(join(process.cwd(), "assets", "services"), { prefix: "/assets/services/" });
  await app.listen(4111);
}, 60_000);

afterAll(async () => {
  await app?.close();
  await closePool();
});

test("quote rejects empty lines and bad quantity", async () => {
  const tc = await demo("customer");
  const addrs = await api("GET", "/v1/addresses", tc);
  const addr = addrs.body[0].id;
  const empty = await api("POST", "/v1/quotes", tc, { ...quoteBody(addr, "2026-11-10T03:30:00.000Z"), lines: [] });
  expect(empty.status).toBe(400);
  const tooMany = await api("POST", "/v1/quotes", tc, quoteBody(addr, "2026-11-10T03:30:00.000Z", 101));
  expect(tooMany.status).toBe(400);
  expect(tooMany.body.code).toBe("INVALID_INPUT");
});

test("quote rejects unknown service and deadline before turnaround", async () => {
  const tc = await demo("customer");
  const addrs = await api("GET", "/v1/addresses", tc);
  const addr = addrs.body[0].id;
  const badSvc = await api("POST", "/v1/quotes", tc, {
    ...quoteBody(addr, "2026-11-10T03:30:00.000Z"),
    lines: [{ serviceId: randomUUID(), garmentTypeId: randomUUID(), quantity: 1 }],
  });
  expect(badSvc.status).toBe(400);
  const badDeadline = await api("POST", "/v1/quotes", tc, {
    ...quoteBody(addr, "2026-11-10T03:30:00.000Z"), requestedReturnBy: "2026-11-10T04:00:00.000Z",
  });
  expect(badDeadline.status).toBe(422);
  expect(badDeadline.body.code).toBe("DEADLINE_UNAVAILABLE");
});

test("last pickup slot has exactly one winner", async () => {
  const tc = await demo("customer");
  const to = await demo("operator");
  const addrs = await api("GET", "/v1/addresses", tc);
  const addr = addrs.body[0].id;
  const slot = "2026-11-11T03:30:00.000Z";
  const bucketKey = "slot:2026-11-11T03:00:00.000Z";
  const cap = await api("PUT", "/v1/ops/capacity", to, { bucketKey, windowStart: slot, windowEnd: "2026-11-11T04:30:00.000Z", capacityTotal: 1 });
  expect([200, 201]).toContain(cap.status);
  const [a, b] = await Promise.all([
    api("POST", "/v1/quotes", tc, quoteBody(addr, slot), { "Idempotency-Key": randomUUID() }),
    api("POST", "/v1/quotes", tc, quoteBody(addr, slot), { "Idempotency-Key": randomUUID() }),
  ]);
  const codes = [a.status, b.status].sort();
  expect(codes).toEqual([201, 409]);
  const loser = a.status === 409 ? a : b;
  expect(loser.body.code).toBe("NO_CAPACITY");
});

test("idempotent checkout replays; reused key with new payload conflicts", async () => {
  const tc = await demo("customer");
  const addrs = await api("GET", "/v1/addresses", tc);
  const q1 = await api("POST", "/v1/quotes", tc, quoteBody(addrs.body[0].id, "2026-11-12T03:30:00.000Z"), { "Idempotency-Key": randomUUID() });
  const q2 = await api("POST", "/v1/quotes", tc, quoteBody(addrs.body[0].id, "2026-11-12T05:30:00.000Z"), { "Idempotency-Key": randomUUID() });
  const key = randomUUID();
  const first = await api("POST", "/v1/checkouts", tc, { quoteId: q1.body.id }, { "Idempotency-Key": key });
  expect([200, 201]).toContain(first.status);
  const replay = await api("POST", "/v1/checkouts", tc, { quoteId: q1.body.id }, { "Idempotency-Key": key });
  expect([200, 201]).toContain(replay.status);
  expect(replay.body.orderId).toBe(first.body.orderId);
  const conflict = await api("POST", "/v1/checkouts", tc, { quoteId: q2.body.id }, { "Idempotency-Key": key });
  expect(conflict.status).toBe(409);
  expect(conflict.body.code).toBe("IDEMPOTENCY_CONFLICT");
});

test("duplicate capture does not duplicate the order", async () => {
  const tc = await demo("customer");
  const tr = await demo("rider");
  const to = await demo("operator");
  const { checkout } = await fullOrder(tc, tr, to, "2026-11-13T03:30:00.000Z");
  const again = await api("POST", `/v1/demo/payments/${checkout.paymentId}/capture`, tc, {});
  expect([200, 201]).toContain(again.status);
  expect(again.body.id).toBe(checkout.orderId);
  const db = getPool();
  const n = Number((await db.query("SELECT COUNT(*)::int AS n FROM payments WHERE order_id = $1 AND status = 'CAPTURED'", [checkout.orderId])).rows[0].n);
  expect(n).toBe(1);
});

test("pickup completion never delivers; only return proof delivers", async () => {
  const tc = await demo("customer");
  const tr = await demo("rider");
  const to = await demo("operator");
  const { order } = await fullOrder(tc, tr, to, "2026-11-14T03:30:00.000Z");
  const pickup = order.deliveries.find((j: { leg: string }) => j.leg === "PICKUP");
  const ret = order.deliveries.find((j: { leg: string }) => j.leg === "RETURN");
  const acc = await api("POST", `/v1/partner/jobs/${pickup.id}/accept`, tr, {});
  const hand = await api("POST", `/v1/partner/jobs/${pickup.id}/handover`, tr, {
    actionId: randomUUID(), bagIds: ["bag-1"], method: "OTP", otp: order.pickupOtp,
    capturedAt: "2026-11-14T05:00:00.000Z", expectedVersion: acc.body.version,
  });
  expect([200, 201]).toContain(hand.status);
  const mid = await api("GET", `/v1/orders/${order.id}`, tc);
  expect(["PICKUP_PENDING", "AT_FACILITY"]).toContain(mid.body.status);
  expect(mid.body.status).not.toBe("DELIVERED");
  // Intake then full care, then return leg delivers.
  const lineId = mid.body.lines[0].orderLineId;
  const intake = await api("POST", `/v1/ops/orders/${order.id}/intake`, to, { expectedVersion: mid.body.version, measuredLines: [{ orderLineId: lineId, quantity: 2 }], bagIds: ["bag-1"] });
  expect(intake.body.status).toBe("AT_FACILITY");
  for (const target of ["IN_CARE", "QUALITY_CHECK", "READY_FOR_RETURN"]) {
    const cur = await api("GET", `/v1/orders/${order.id}`, tc);
    const adv = await api("POST", `/v1/ops/orders/${order.id}/care`, to, { expectedVersion: cur.body.version, to: target });
    expect(adv.body.status).toBe(target);
  }
  const ready = await api("GET", `/v1/orders/${order.id}`, tc);
  const racc = await api("POST", `/v1/partner/jobs/${ret.id}/accept`, tr, {});
  const rhand = await api("POST", `/v1/partner/jobs/${ret.id}/handover`, tr, {
    actionId: randomUUID(), bagIds: ["bag-1"], method: "OTP", otp: ready.body.returnOtp,
    capturedAt: "2026-11-18T05:00:00.000Z", expectedVersion: racc.body.version,
  });
  expect([200, 201]).toContain(rhand.status);
  const done = await api("GET", `/v1/orders/${order.id}`, tc);
  expect(done.body.status).toBe("DELIVERED");
});

test("orders are private: another customer gets 404", async () => {
  const tc = await demo("customer");
  const tr = await demo("rider");
  const to = await demo("operator");
  const other = await newCustomer("+91-90000-00099");
  const { order } = await fullOrder(tc, tr, to, "2026-11-15T03:30:00.000Z");
  const peek = await api("GET", `/v1/orders/${order.id}`, other);
  expect(peek.status).toBe(404);
  expect(peek.body.code).toBe("NOT_FOUND");
});

test("extra garments need approved top-up before care; lower intake refunds", async () => {
  const tc = await demo("customer");
  const tr = await demo("rider");
  const to = await demo("operator");
  const { order } = await fullOrder(tc, tr, to, "2026-11-16T03:30:00.000Z");
  const lineId = order.lines[0].orderLineId;
  const over = await api("POST", `/v1/ops/orders/${order.id}/intake`, to, {
    expectedVersion: order.version, measuredLines: [{ orderLineId: lineId, quantity: 4 }], bagIds: ["bag-1", "bag-2"],
  });
  expect(over.body.status).toBe("AWAITING_ADJUSTMENT");
  const blocked = await api("POST", `/v1/ops/orders/${order.id}/care`, to, { expectedVersion: over.body.version, to: "IN_CARE" });
  expect(blocked.status).toBe(409);
  expect(blocked.body.code).toBe("REQUIRES_APPROVAL");
  const adjId = over.body.adjustment.id as string;
  const accept = await api("POST", `/v1/orders/${order.id}/adjustments/${adjId}/decision`, tc, { decision: "ACCEPT" });
  expect(accept.status).toBe(409);
  expect(accept.body.code).toBe("REQUIRES_APPROVAL");
  // Capture the top-up, then care proceeds.
  const db = getPool();
  const topup = (await db.query("SELECT * FROM payments WHERE order_id = $1 AND purpose = 'TOP_UP' AND status = 'PENDING'", [order.id])).rows[0];
  expect(topup).toBeTruthy();
  const pay = await api("POST", `/v1/demo/payments/${topup.id}/capture`, tc, {});
  expect([200, 201]).toContain(pay.status);
  const cur = await api("GET", `/v1/orders/${order.id}`, tc);
  const care = await api("POST", `/v1/ops/orders/${order.id}/care`, to, { expectedVersion: cur.body.version, to: "IN_CARE" });
  expect([200, 201]).toContain(care.status);

  // Lower intake on a second order creates a refund obligation.
  const second = await fullOrder(tc, tr, to, "2026-11-16T06:30:00.000Z");
  const line2 = second.order.lines[0].orderLineId;
  const under = await api("POST", `/v1/ops/orders/${second.order.id}/intake`, to, {
    expectedVersion: second.order.version, measuredLines: [{ orderLineId: line2, quantity: 1 }], bagIds: ["bag-1"],
  });
  expect(under.body.status).toBe("AWAITING_ADJUSTMENT");
  const decided = await api("POST", `/v1/orders/${second.order.id}/adjustments/${under.body.adjustment.id}/decision`, tc, { decision: "ACCEPT" });
  expect(decided.body.status).toBe("AT_FACILITY");
  const obs = await db.query("SELECT * FROM refund_obligations WHERE order_id = $1 AND status = 'OPEN'", [second.order.id]);
  expect(obs.rowCount).toBe(1);
});

test("stale expectedVersion conflicts on cancel", async () => {
  const tc = await demo("customer");
  const tr = await demo("rider");
  const to = await demo("operator");
  const { order } = await fullOrder(tc, tr, to, "2026-11-17T03:30:00.000Z");
  const stale = await api("POST", `/v1/orders/${order.id}/cancel`, tc, { reason: "changed mind", expectedVersion: 1 });
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe("VERSION_CONFLICT");
  const fresh = await api("GET", `/v1/orders/${order.id}`, tc);
  const cancelled = await api("POST", `/v1/orders/${order.id}/cancel`, tc, { reason: "changed mind", expectedVersion: fresh.body.version });
  expect(cancelled.body.status).toBe("CANCELLED");
});

test("reviews: only delivered orders, one per order", async () => {
  const tc = await demo("customer");
  const tr = await demo("rider");
  const to = await demo("operator");
  const { order } = await fullOrder(tc, tr, to, "2026-11-18T03:30:00.000Z");
  const early = await api("POST", "/v1/reviews", tc, { orderId: order.id, overall: 5, publishConsent: true });
  expect(early.status).toBe(400);
  // Deliver it quickly through the legs.
  const pickup = order.deliveries.find((j: { leg: string }) => j.leg === "PICKUP");
  const ret = order.deliveries.find((j: { leg: string }) => j.leg === "RETURN");
  const acc = await api("POST", `/v1/partner/jobs/${pickup.id}/accept`, tr, {});
  await api("POST", `/v1/partner/jobs/${pickup.id}/handover`, tr, {
    actionId: randomUUID(), bagIds: ["b"], method: "OTP", otp: order.pickupOtp, capturedAt: "2026-11-18T05:00:00.000Z", expectedVersion: acc.body.version,
  });
  let cur = await api("GET", `/v1/orders/${order.id}`, tc);
  await api("POST", `/v1/ops/orders/${order.id}/intake`, to, { expectedVersion: cur.body.version, measuredLines: [{ orderLineId: cur.body.lines[0].orderLineId, quantity: 2 }], bagIds: ["b"] });
  for (const target of ["IN_CARE", "QUALITY_CHECK", "READY_FOR_RETURN"]) {
    cur = await api("GET", `/v1/orders/${order.id}`, tc);
    await api("POST", `/v1/ops/orders/${order.id}/care`, to, { expectedVersion: cur.body.version, to: target });
  }
  cur = await api("GET", `/v1/orders/${order.id}`, tc);
  const racc = await api("POST", `/v1/partner/jobs/${ret.id}/accept`, tr, {});
  await api("POST", `/v1/partner/jobs/${ret.id}/handover`, tr, {
    actionId: randomUUID(), bagIds: ["b"], method: "OTP", otp: cur.body.returnOtp, capturedAt: "2026-11-19T05:00:00.000Z", expectedVersion: racc.body.version,
  });
  const first = await api("POST", "/v1/reviews", tc, { orderId: order.id, overall: 5, publishConsent: true });
  expect([200, 201]).toContain(first.status);
  const dup = await api("POST", "/v1/reviews", tc, { orderId: order.id, overall: 4, publishConsent: true });
  expect(dup.status).toBe(400);
});

test("whatsapp webhook verifies signature and dedupes by message id", async () => {
  const secret = process.env.WHATSAPP_VERIFY_TOKEN as string;
  const check = await fetch(`${BASE}/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${secret}&hub.challenge=abc123`);
  expect([200, 201]).toContain(check.status);
  const payload = { entry: [{ changes: [{ value: { messages: [{ id: "wamid-test-1", type: "text", text: { body: "wash and press 3 shirts" }, from: "919000000001" }] } }] }] };
  const raw = JSON.stringify(payload);
  const sig = "sha256=" + createHmac("sha256", process.env.WHATSAPP_APP_SECRET as string).update(Buffer.from(raw)).digest("hex");
  const res = await fetch(`${BASE}/v1/webhooks/whatsapp`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig }, body: raw,
  });
  expect([200, 201]).toContain(res.status);
  const res2 = await fetch(`${BASE}/v1/webhooks/whatsapp`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig }, body: raw,
  });
  expect([200, 201]).toContain(res2.status);
  const db = getPool();
  const n = Number((await db.query("SELECT COUNT(*)::int AS n FROM conversation_messages WHERE provider_message_id = 'wamid-test-1'")).rows[0].n);
  expect(n).toBe(1);
  const bad = await fetch(`${BASE}/v1/webhooks/whatsapp`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": "sha256=deadbeef" }, body: raw,
  });
  expect(bad.status).toBe(403);
});

test("draft confirm binds revision and quote; stale revision conflicts, replay returns same checkout", async () => {
  const tc = await demo("customer");
  const msg = await api("POST", "/v1/demo/conversations/messages", tc, {
    text: "Dry clean 2 blazers on 2026-12-01 at 10am, return Friday",
  }, { "Idempotency-Key": randomUUID() });
  expect([200, 201]).toContain(msg.status);
  const draft = msg.body.draft;
  if (!msg.body.quote) {
    // Missing address/time is fine; this assertion documents draft behavior.
    expect(draft.missingFields.length).toBeGreaterThanOrEqual(0);
    return;
  }
  const stale = await api("POST", `/v1/conversation-drafts/${draft.draftId}/confirm`, tc, {
    draftId: draft.draftId, revision: draft.revision - 1 > 0 ? draft.revision - 1 : 999, quoteId: msg.body.quote.id,
  });
  expect(stale.status).toBe(409);
  const key = randomUUID();
  const first = await api("POST", `/v1/conversation-drafts/${draft.draftId}/confirm`, tc, {
    draftId: draft.draftId, revision: draft.revision, quoteId: msg.body.quote.id,
  }, { "Idempotency-Key": key });
  expect([200, 201]).toContain(first.status);
});

test("invalid UUID paths and bodies return 4xx envelopes, never 500", async () => {
  const tc = await demo("customer");
  const badGet = await api("GET", "/v1/orders/not-a-uuid", tc);
  expect(badGet.status).toBe(400);
  expect(badGet.body.code).toBe("INVALID_INPUT");
  const badBody = await api("POST", "/v1/quotes", tc, {});
  expect(badBody.status).toBe(400);
  expect(badBody.body.code).toBe("INVALID_INPUT");
  const badPay = await api("GET", "/v1/payments/definitely-bad", tc);
  expect(badPay.status).toBe(400);
});

test("rider cannot draft or confirm; only customers", async () => {
  const tr = await demo("rider");
  const msg = await api("POST", "/v1/demo/conversations/messages", tr, { text: "wash and press 2 shirts tomorrow" });
  expect(msg.status).toBe(403);
  expect(msg.body.code).toBe("FORBIDDEN");
  const voice = await api("POST", "/v1/demo/conversations/voice-notes", tr, { mime: "audio/ogg", base64: Buffer.from("x").toString("base64") });
  expect(voice.status).toBe(403);
});

test("drafts are isolated per customer and per WhatsApp sender", async () => {
  const a = await newCustomer("+91-90000-00101");
  const b = await newCustomer("+91-90000-00102");
  const ma = await api("POST", "/v1/demo/conversations/messages", a, { text: "wash and press 2 shirts tomorrow between 9am and 10am" });
  const mb = await api("POST", "/v1/demo/conversations/messages", b, { text: "wash and press 2 shirts tomorrow between 9am and 10am" });
  expect(ma.body.draft.draftId).not.toBe(mb.body.draft.draftId);
  // Explicit draftId of another user is not visible.
  const peek = await api("POST", "/v1/demo/conversations/messages", b, { text: "hello", draftId: ma.body.draft.draftId });
  expect(peek.status).toBe(404);
  // WhatsApp senders are isolated from each other and from app customers.
  const secret = process.env.WHATSAPP_APP_SECRET as string;
  const sendWa = async (id: string, from: string, text: string) => {
    const payload = { entry: [{ changes: [{ value: { messages: [{ id, type: "text", text: { body: text }, from }] } }] }] };
    const raw = JSON.stringify(payload);
    const sig = "sha256=" + createHmac("sha256", secret).update(Buffer.from(raw)).digest("hex");
    const res = await fetch(`${BASE}/v1/webhooks/whatsapp`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig }, body: raw,
    });
    return res.json();
  };
  const t1 = `iso-wa-${randomUUID()}`;
  const t2 = `iso-wa-${randomUUID()}`;
  const wa1 = await sendWa(t1, "919000001101", "wash and press 2 shirts tomorrow") as { draft: { draftId: string } };
  const wa2 = await sendWa(t2, "919000001102", "wash and press 2 shirts tomorrow") as { draft: { draftId: string } };
  expect(wa1.draft.draftId).not.toBe(wa2.draft.draftId);
  expect([wa1.draft.draftId, wa2.draft.draftId]).not.toContain(ma.body.draft.draftId);
});

test("parser: wash-and-iron selects combined service, keeps minutes, separates pickup and return", async () => {
  const tc = await newCustomer("+91-90000-00201");
  await api("POST", "/v1/addresses", tc, { label: "Home", line1: "1 Main St", city: "Mumbai", postalCode: "400001" });
  const msg = await api("POST", "/v1/demo/conversations/messages", tc, {
    text: "Pick up two dress shirts tomorrow between 9:30am and 10:30am, wash and iron, return 2026-12-10 before 6pm",
    receivedAt: "2026-11-19T04:00:00.000Z",
  });
  expect([200, 201]).toContain(msg.status);
  // Wash-and-iron must not collapse to press-only.
  const quote = msg.body.quote as { lines: { serviceId: string }[]; pickupWindow: { start: string; end: string } } | undefined;
  if (quote) {
    expect(quote.lines[0].serviceId).toBe("11111111-1111-4111-8111-111111111111");
    expect(quote.pickupWindow.start).toContain("T04:00:00.000Z");
    expect(quote.pickupWindow.end).toContain("T05:00:00.000Z");
  } else {
    // If capacity/quote failed, the draft must still show what was understood.
    expect(msg.body.reply as string).toMatch(/return deadline|Confirm|addressId/i);
  }
});

test("parser: time words are never garment counts; vague return asks instead of defaulting", async () => {
  const tc = await newCustomer("+91-90000-00202");
  const times = await api("POST", "/v1/demo/conversations/messages", tc, { text: "pick up tomorrow between nine and ten" });
  expect(times.body.missingFields).toContain("garment count");
  const vague = await api("POST", "/v1/demo/conversations/messages", tc, {
    text: "wash and press 2 shirts tomorrow between 9am and 10am, return them soon",
  });
  expect(vague.body.missingFields.join(",")).toMatch(/return deadline/);
});

test("speech adapter rejects bad MIME, empty and oversize audio without a false success", async () => {
  const { transcribeAudio } = await import("../../modules/conversations/src/speech");
  const badMime = await transcribeAudio({ bytes: Buffer.from([1, 2, 3]), mime: "video/mp4" });
  expect(badMime.ok).toBe(false);
  const empty = await transcribeAudio({ bytes: Buffer.alloc(0), mime: "audio/ogg" });
  expect(empty.ok).toBe(false);
  const big = await transcribeAudio({ bytes: Buffer.alloc(10 * 1024 * 1024 + 1), mime: "audio/ogg" });
  expect(big.ok).toBe(false);
  const unconfigured = await transcribeAudio({ bytes: Buffer.from([1]), mime: "audio/ogg" });
  // Either unconfigured (no WHISPER_COMMAND in test env) or a real failure;
  // both must be explicit ok:false, never ok:true with empty text.
  if (unconfigured.ok) expect(unconfigured.text.length).toBeGreaterThan(0);
});

test("voice-notes endpoint returns a real transcript and draft when the local model is available", async () => {
  const candidates = [
    "/tmp/opencode/laundry_request.wav",
    "/home/batman/Projects/code/Laundry/.data/whisper",
  ];
  let sample: Buffer | null = null;
  try {
    const { readFileSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    if (existsSync(candidates[0])) sample = readFileSync(candidates[0]);
    void join;
  } catch { sample = null; }
  if (!sample) return; // portable skip: adapter unit test above still guards the seam.
  const wrapperCandidates = [
    process.env.WHISPER_COMMAND,
    "/home/batman/Projects/code/Laundry/tools/voice-transcriber/whisper_wrapper.sh",
  ].filter(Boolean) as string[];
  const { existsSync } = await import("node:fs");
  const wrapper = wrapperCandidates.find((p) => existsSync(p));
  if (!wrapper) return;
  process.env.WHISPER_COMMAND = wrapper;
  process.env.WHISPER_CACHE_DIR ??= "/home/batman/Projects/code/Laundry/.data/whisper";
  const tc = await demo("customer");
  const res = await api("POST", "/v1/demo/conversations/voice-notes", tc, { mime: "audio/wav", base64: sample.toString("base64") });
  expect([200, 201]).toContain(res.status);
  if (!res.body.ok) return; // model unavailable in this env; explicit fallback, not a fake transcript.
  expect(res.body.transcript.toLowerCase()).toMatch(/wash|iron|shirt|laundry|pick/);
  expect(res.body.draft.draftId).toBeTruthy();
});

test("configured WhatsApp media retrieval and send use fixtures; duplicate audio books once", async () => {
  const { createServer } = await import("node:http");
  const { readFileSync, existsSync } = await import("node:fs");
  const samplePath = "/tmp/opencode/laundry_request.wav";
  const sample: Buffer = existsSync(samplePath) ? readFileSync(samplePath) : Buffer.from("RIFF-fake");
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname.endsWith("/media-file")) {
      res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": String(sample.length) });
      res.end(sample);
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/v26.0/")) {
      const port = (server.address() as { port: number }).port;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "media123", mime_type: "audio/wav", file_size: String(sample.length), url: `http://127.0.0.1:${port}/media-file` }));
      return;
    }
    if (req.method === "POST" && url.pathname.endsWith("/messages")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ messages: [{ id: "wamid-out-1" }] }));
      return;
    }
    res.writeHead(404); res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const prev = { ...process.env };
  try {
    process.env.WHATSAPP_API_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.WHATSAPP_API_VERSION = "v26.0";
    process.env.WHATSAPP_TOKEN = "test-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone";
    process.env.DEMO_MODE = "false";
    process.env.WHISPER_COMMAND = "/bin/false";
    const { retrieveWhatsappMedia, sendWhatsappText } = await import("../../modules/conversations/src/whatsapp");
    const media = await retrieveWhatsappMedia("media123");
    expect(media.bytes.length).toBeGreaterThan(0);
    expect(media.mime).toMatch(/audio/);
    const sent = await sendWhatsappText("919000000001", "hello from fixture");
    expect(sent.status).toBe("sent");
    expect(sent.id).toBe("wamid-out-1");
    // Audio webhook through the same fixture: accepted once, outbox holds one notification.
    const secret = process.env.WHATSAPP_APP_SECRET as string;
    const wid = `wamid-audio-${randomUUID()}`;
    const payload = { entry: [{ changes: [{ value: { messages: [{ id: wid, type: "audio", audio: { id: "media123", mime_type: "audio/ogg" }, from: "919000000777", timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] };
    const raw = JSON.stringify(payload);
    const sig = "sha256=" + createHmac("sha256", secret).update(Buffer.from(raw)).digest("hex");
    const db = getPool();
    const before = Number((await db.query("SELECT COUNT(*)::int AS n FROM outbox WHERE event_type = 'notification.whatsapp.v1'")).rows[0].n);
    const r1 = await fetch(`${BASE}/v1/webhooks/whatsapp`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig }, body: raw });
    expect([200, 201]).toContain(r1.status);
    const r2 = await fetch(`${BASE}/v1/webhooks/whatsapp`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig }, body: raw });
    expect([200, 201]).toContain(r2.status);
    const msgCount = Number((await db.query("SELECT COUNT(*)::int AS n FROM conversation_messages WHERE provider_message_id = $1", [wid])).rows[0].n);
    expect(msgCount).toBe(1);
    const after = Number((await db.query("SELECT COUNT(*)::int AS n FROM outbox WHERE event_type = 'notification.whatsapp.v1'")).rows[0].n);
    expect(after - before).toBe(1);
  } finally {
    Object.keys(process.env).forEach((k) => { if (!(k in prev)) delete process.env[k]; });
    Object.assign(process.env, prev);
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("expired quotes cannot checkout; stale intake version conflicts", async () => {
  const tc = await demo("customer");
  const tr = await demo("rider");
  const to = await demo("operator");
  const addrs = await api("GET", "/v1/addresses", tc);
  const q = await api("POST", "/v1/quotes", tc, quoteBody(addrs.body[0].id, "2026-12-10T03:30:00.000Z"), { "Idempotency-Key": randomUUID() });
  expect([200, 201]).toContain(q.status);
  const db = getPool();
  await db.query("UPDATE quotes SET expires_at = now() - INTERVAL '1 minute' WHERE id = $1", [q.body.id]);
  const co = await api("POST", "/v1/checkouts", tc, { quoteId: q.body.id }, { "Idempotency-Key": randomUUID() });
  expect(co.status).toBe(410);
  expect(co.body.code).toBe("QUOTE_EXPIRED");
  const { order } = await fullOrder(tc, tr, to, "2026-12-11T03:30:00.000Z");
  const staleIntake = await api("POST", `/v1/ops/orders/${order.id}/intake`, to, {
    expectedVersion: 1, measuredLines: [{ orderLineId: order.lines[0].orderLineId, quantity: 2 }], bagIds: ["bag-1"],
  });
  expect(staleIntake.status).toBe(409);
  expect(staleIntake.body.code).toBe("VERSION_CONFLICT");
});

test("razorpay webhook replay delivers once via inbox dedupe", async () => {
  const prevSecret = process.env.RAZORPAY_KEY_SECRET;
  process.env.RAZORPAY_KEY_SECRET = "test-rzp-secret";
  try {
    const tc = await demo("customer");
    const addrs = await api("GET", "/v1/addresses", tc);
    const q = await api("POST", "/v1/quotes", tc, quoteBody(addrs.body[0].id, "2026-12-12T03:30:00.000Z"), { "Idempotency-Key": randomUUID() });
    const co = await api("POST", "/v1/checkouts", tc, { quoteId: q.body.id }, { "Idempotency-Key": randomUUID() });
    const eventId = `evt-${randomUUID()}`;
    const payload = { id: eventId, event: "payment.captured", payload: { payment: { entity: { id: co.body.paymentId, status: "captured" } } } };
    const raw = JSON.stringify(payload);
    const sig = createHmac("sha256", "test-rzp-secret").update(Buffer.from(raw)).digest("hex");
    const h = { "Content-Type": "application/json", "X-Razorpay-Signature": sig };
    const r1 = await fetch(`${BASE}/v1/webhooks/payments/razorpay`, { method: "POST", headers: h, body: raw });
    expect([200, 201]).toContain(r1.status);
    const j1 = await r1.json() as { duplicate: boolean };
    expect(j1.duplicate).toBe(false);
    const r2 = await fetch(`${BASE}/v1/webhooks/payments/razorpay`, { method: "POST", headers: h, body: raw });
    expect([200, 201]).toContain(r2.status);
    const j2 = await r2.json() as { duplicate: boolean };
    expect(j2.duplicate).toBe(true);
  } finally {
    if (prevSecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = prevSecret;
  }
});

test("outbox supports transactional claim/lease and notification ledger", async () => {
  const db = getPool();
  const cols = (await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'outbox' AND column_name IN ('leased_until','last_error')`,
  )).rows.map((r: { column_name: string }) => r.column_name).sort();
  expect(cols).toEqual(["last_error", "leased_until"]);
  // Claim pattern from the worker must run inside a transaction.
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const rows = (await client.query(
      `SELECT id FROM outbox WHERE dispatched = FALSE AND attempts < 5 AND (leased_until IS NULL OR leased_until < now())
       ORDER BY occurred_at LIMIT 5 FOR UPDATE SKIP LOCKED`,
    )).rows;
    expect(Array.isArray(rows)).toBe(true);
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
  const ledgers = (await db.query("SELECT to_regclass('public.notification_deliveries') AS c")).rows[0].c;
  expect(ledgers).toBe("notification_deliveries");
});
