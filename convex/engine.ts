// Wandary Convex engine. Real Convex functions, not a mock. All CRUD flows
// through one frozen internal mutation so the HTTP lane (owned by another
// agent) cannot bypass auth. No public functions are exported.
//
// Frozen interface:
//   dispatch = internalMutation({
//     args: { method, path, token, body, idempotencyKey }, handler })
//   returns { status: number, body: any }
// Errors convert inside the handler to { code, message, traceId, retryable }.

import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { canonicalJson, hashRequestPayload } from "./lib/hash";
import { uuid, sessionToken, sixDigitOtp } from "./lib/ids";
import { EngineError } from "./lib/errors";
import {
  assertUuid,
  parseWindow,
  parseQuoteInput,
  parseCheckout,
  parseReview,
  parseHandover,
  type QuoteInput,
} from "./lib/validate";
import {
  DEMO_IDS,
  DEMO_SERVICES,
  demoImageUrl,
} from "./lib/catalogSeed";
import {
  parseCount,
  parseService,
  parseTime,
  parseReturnDeadline,
  exactSummary,
  type DraftFields,
} from "./lib/conversation";

type Ctx = any;

interface Actor {
  id: string;
  role: string;
  scopes: string[];
}

function demoMode(): boolean {
  return (process.env as Record<string, string | undefined>).DEMO_MODE === "true";
}

function requireDemo(): void {
  if (!demoMode()) {
    throw new EngineError("FORBIDDEN", "Demo auth disabled in real mode", { status: 403 });
  }
}

// Live cloud has no SMS, billing, or refund provider wired through Convex
// mutations. Any production-named route that would otherwise simulate a
// provider outcome must fail closed with PROVIDER_UNAVAILABLE instead of
// pretending a live payment, OTP delivery, or refund succeeded.
function requireProviderInDemo(lane: string): void {
  if (!demoMode()) {
    throw new EngineError("PROVIDER_UNAVAILABLE", `${lane} unavailable: no live provider; retry in DEMO_MODE`, {
      status: 501,
    });
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function scopesFor(role: string): string[] {
  if (role === "operator" || role === "admin") {
    return ["orders:read", "orders:write", "deliveries:manage", "catalog:manage", "support:manage"];
  }
  if (role === "rider") return ["jobs:read", "jobs:write"];
  if (role === "facility") return ["orders:read", "orders:write"];
  return ["orders:read", "orders:write", "reviews:write"];
}

async function actorFromToken(ctx: Ctx, token: string | undefined): Promise<Actor | null> {
  if (!token) return null;
  const sess = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();
  if (!sess) return null;
  if (Date.parse(sess.expiresAt) < Date.now()) return null;
  const user = await ctx.db
    .query("identities")
    .withIndex("by_lid", (q) => q.eq("lid", sess.userId))
    .first();
  if (!user) return null;
  return { id: user.lid, role: user.role, scopes: scopesFor(user.role) };
}

function requireActor(actor: Actor | null): Actor {
  if (!actor) throw new EngineError("UNAUTHENTICATED", "Missing or invalid session", { status: 401 });
  return actor;
}

function requireRole(actor: Actor, roles: string[]): void {
  if (!roles.includes(actor.role)) {
    throw new EngineError("FORBIDDEN", "Access denied for this role", { status: 403 });
  }
}

// Facility has no provisioned memberships (no facility users, no
// facility-order mapping). Fail closed: any facility credential gets 403 on
// business routes until secure membership exists. Demo login already rejects
// role=facility; this is defense in depth for manually provisioned tokens.
function requireNotFacility(actor: Actor): void {
  if (actor.role === "facility") {
    throw new EngineError("FORBIDDEN", "Facility access disabled: no facility membership provisioned", { status: 403 });
  }
}

async function emitOutbox(ctx: Ctx, aggregateId: string, eventType: string, payload: unknown): Promise<void> {
  await ctx.db.insert("outbox", { aggregateId, eventType, payload, createdAt: nowIso() });
}

function scopeOf(method: string, template: string): string {
  return `${method} ${template}`;
}

async function checkIdempotency(
  ctx: Ctx,
  scope: string,
  key: string | undefined,
  actorId: string,
  payload: unknown
): Promise<{ replay: boolean; response?: { status: number; body: unknown } }> {
  if (!key) return { replay: false };
  const existing = await ctx.db
    .query("idempotencyRecords")
    .withIndex("by_scope_key", (q) => q.eq("scope", scope).eq("key", key))
    .first();
  if (!existing) return { replay: false };
  if (existing.actorId !== actorId) {
    throw new EngineError("IDEMPOTENCY_CONFLICT", "Idempotency key already used by another actor", { status: 409 });
  }
  if (existing.requestHash !== hashRequestPayload(payload)) {
    throw new EngineError("IDEMPOTENCY_CONFLICT", "Idempotency key reused with a different payload", { status: 409 });
  }
  return { replay: true, response: existing.response as { status: number; body: unknown } };
}

async function storeIdempotency(
  ctx: Ctx,
  scope: string,
  key: string | undefined,
  actorId: string,
  payload: unknown,
  response: { status: number; body: unknown }
): Promise<void> {
  if (!key) return;
  const existing = await ctx.db
    .query("idempotencyRecords")
    .withIndex("by_scope_key", (q) => q.eq("scope", scope).eq("key", key))
    .first();
  if (existing) return;
  await ctx.db.insert("idempotencyRecords", {
    scope,
    key,
    actorId,
    requestHash: hashRequestPayload(payload),
    response,
  });
}

function bucketKeyFor(windowStartIso: string): string {
  const d = new Date(windowStartIso);
  const hour = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()));
  return `slot:${hour.toISOString()}`;
}

function paymentBaseUrl(): string {
  const base =
    (process.env as Record<string, string | undefined>).APP_ORIGIN ??
    (process.env as Record<string, string | undefined>).API_ORIGIN ??
    "https://demo.local";
  return base.replace(/\/$/, "");
}

// ---------- views ----------

async function timelineFor(ctx: Ctx, orderId: string) {
  const rows = await ctx.db.query("orderTimeline").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect();
  return rows.map((r) => ({ status: r.status, label: r.label, at: r.at }));
}

function toJobView(j: Record<string, unknown>) {
  const job = j as Record<string, unknown>;
  const out: Record<string, unknown> = {
    id: job.lid,
    orderId: job.orderId,
    leg: job.leg,
    status: job.status,
    version: job.version,
    customerName: job.customerName,
    address: job.address,
    window: job.window,
    bagIds: job.bagIds ?? [],
    provider: job.provider,
    dispatchMode: job.dispatchMode,
    capabilities: job.capabilities ?? ["OTP_HANDOVER"],
  };
  if (job.assignedTo) out.assignedTo = job.assignedTo;
  return out;
}

async function jobsFor(ctx: Ctx, orderId: string) {
  const rows = await ctx.db.query("deliveryJobs").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect();
  rows.sort((a, b) => (a.leg < b.leg ? -1 : 1));
  return rows.map((r) => toJobView(r as unknown as Record<string, unknown>));
}

async function toOrderView(ctx: Ctx, order: Record<string, unknown>) {
  const timeline = await timelineFor(ctx, order.lid as string);
  const deliveries = await jobsFor(ctx, order.lid as string);
  const rawAdj = order.adjustment as
    | { id: string; status: string; deltaMinor: number; reason: string }
    | undefined;
  // Project to the shared SDK orderSchema shape exactly. Internal fields
  // (measuredLines, bagIds, topupPaymentId) stay in storage only, and
  // handover OTPs are never part of the order view: demo clients read them
  // from GET /v1/orders/:id/handover-code, which is DEMO-gated.
  const view: Record<string, unknown> = {
    id: order.lid,
    version: order.version,
    status: order.status,
    customerId: order.customerId,
    ...(order.facilityId ? { facilityId: order.facilityId } : {}),
    lines: order.lines,
    totalMinor: order.totalMinor,
    currency: "INR",
    pickupWindow: order.pickupWindow,
    promisedReturnWindow: order.promisedReturn,
    createdAt: order.createdAt,
    timeline,
    paymentStatus: order.paymentStatus,
    ...(rawAdj
      ? { adjustment: { id: rawAdj.id, status: rawAdj.status, deltaMinor: rawAdj.deltaMinor, reason: rawAdj.reason } }
      : {}),
    deliveries,
  };
  return view;
}

function toReviewView(r: Record<string, unknown>) {
  return {
    id: r.lid,
    orderId: r.orderId,
    overall: r.overall,
    ...(r.serviceScore !== undefined ? { serviceScore: r.serviceScore } : {}),
    ...(r.deliveryScore !== undefined ? { deliveryScore: r.deliveryScore } : {}),
    ...(r.comment !== undefined ? { comment: r.comment } : {}),
    mediaIds: r.mediaIds ?? [],
    publishConsent: r.consent,
    version: r.version,
    createdAt: r.createdAt,
  };
}

function toServiceView(s: Record<string, unknown>) {
  const garments = (s.garments as { lid: string; name: string; priceMinor: number }[]).map((g) => ({
    id: g.lid,
    name: g.name,
    priceMinor: g.priceMinor,
  }));
  return {
    id: s.lid,
    code: s.code,
    name: s.name,
    description: s.description,
    imageUrl: s.imageUrl,
    priceMinor: s.priceMinor,
    priceUnit: s.priceUnit,
    turnaroundHours: s.turnaroundHours,
    garments,
    features: s.features ?? [],
  };
}

// ---------- quote core (shared by /v1/quotes and conversation drafts) ----------

async function buildQuote(ctx: Ctx, actor: Actor, input: QuoteInput) {
  if (actor.role !== "customer") throw new EngineError("FORBIDDEN", "Only customers can quote", { status: 403 });
  const totalQty = input.lines.reduce((n, l) => n + l.quantity, 0);
  if (totalQty > 100) throw new EngineError("INVALID_INPUT", "Maximum 100 garments per order", { status: 400 });

  const addr = await ctx.db.query("addresses").withIndex("by_lid", (q) => q.eq("lid", input.addressId)).first();
  if (!addr || addr.deleted) throw new EngineError("NOT_FOUND", "Address not found", { status: 404 });
  if (addr.ownerId !== actor.id) throw new EngineError("NOT_FOUND", "Address not found", { status: 404 });

  let subtotal = 0;
  let slowestHours = 0;
  let provisional = false;
  const priced: (QuoteInput["lines"][number] & { unitPriceMinor: number; lineTotalMinor: number })[] = [];
  for (const line of input.lines) {
    const svc = await ctx.db.query("services").withIndex("by_lid", (q) => q.eq("lid", line.serviceId)).first();
    if (!svc || !svc.active) {
      throw new EngineError("INVALID_INPUT", `Unknown service ${line.serviceId}`, {
        status: 400,
        fieldErrors: { serviceId: "unknown service" },
      });
    }
    const garment = svc.garments.find((g: { lid: string }) => g.lid === line.garmentTypeId);
    if (!garment) {
      throw new EngineError("INVALID_INPUT", "Garment type does not belong to the service", {
        status: 400,
        fieldErrors: { garmentTypeId: "mismatch" },
      });
    }
    if (line.estimatedWeightGrams !== undefined) provisional = true;
    const unit = garment.priceMinor;
    const total = unit * line.quantity;
    subtotal += total;
    slowestHours = Math.max(slowestHours, svc.turnaroundHours);
    priced.push({ ...line, unitPriceMinor: unit, lineTotalMinor: total });
  }

  const pickupEnd = Date.parse(input.pickupWindow.end);
  const feasibleReturn = pickupEnd + slowestHours * 3600_000;
  if (Date.parse(input.requestedReturnBy) < feasibleReturn) {
    throw new EngineError("DEADLINE_UNAVAILABLE", "Requested return is earlier than the slowest service turnaround", {
      status: 422,
    });
  }
  const promisedStart = new Date(feasibleReturn).toISOString();
  const promisedEnd = new Date(feasibleReturn + 6 * 3600_000).toISOString();

  const key = bucketKeyFor(input.pickupWindow.start);
  let bucket = await ctx.db.query("capacityBuckets").withIndex("by_key", (q) => q.eq("key", key)).first();
  if (!bucket) {
    await ctx.db.insert("capacityBuckets", {
      key,
      windowStart: input.pickupWindow.start,
      windowEnd: input.pickupWindow.end,
      capacityTotal: 2,
    });
    bucket = await ctx.db.query("capacityBuckets").withIndex("by_key", (q) => q.eq("key", key)).first();
  }
  const holds = await ctx.db.query("capacityHolds").withIndex("by_bucket", (q) => q.eq("bucketKey", key)).collect();
  const activeHolds = holds.filter((h) => !h.released && Date.parse(h.expiresAt) > Date.now()).length;
  if (bucket && activeHolds >= bucket.capacityTotal) {
    throw new EngineError("NO_CAPACITY", "Pickup slot is full; choose another window", { status: 409 });
  }

  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const holdLid = uuid();
  await ctx.db.insert("capacityHolds", { lid: holdLid, bucketKey: key, expiresAt, released: false });

  const tax = Math.round(subtotal * 0.12);
  const total = subtotal + tax;
  const breakdown = [
    ...priced.map((l) => ({ label: `${l.quantity} x garment @ ${l.unitPriceMinor}`, amountMinor: l.lineTotalMinor })),
    { label: "Pickup fee", amountMinor: 0 },
    { label: "Tax (demo 12%)", amountMinor: tax },
  ];
  const rateCards = await ctx.db.query("rateCards").collect();
  rateCards.sort((a, b) => b.version - a.version);
  const rateCard = rateCards[0];
  const quoteId = uuid();
  await ctx.db.insert("quotes", {
    lid: quoteId,
    version: 1,
    customerId: actor.id,
    addressId: input.addressId,
    lines: priced,
    breakdown,
    totalMinor: total,
    currency: "INR",
    provisional,
    pickupWindow: input.pickupWindow,
    promisedReturn: { start: promisedStart, end: promisedEnd, timezone: input.timezone },
    ...(rateCard ? { rateCardId: rateCard.lid } : {}),
    rateCardVersion: rateCard ? rateCard.version : 1,
    holdId: holdLid,
    expiresAt,
  });
  const hold = await ctx.db.query("capacityHolds").withIndex("by_lid", (q) => q.eq("lid", holdLid)).first();
  if (hold) await ctx.db.patch(hold._id, { quoteId: quoteId });
  return {
    id: quoteId,
    version: 1,
    expiresAt,
    ...(rateCard ? { rateCardId: rateCard.lid } : {}),
    rateCardVersion: rateCard ? rateCard.version : 1,
    lines: priced,
    totalMinor: total,
    currency: "INR",
    provisional,
    pickupWindow: input.pickupWindow,
    promisedReturnWindow: { start: promisedStart, end: promisedEnd, timezone: input.timezone },
    breakdown,
  };
}

async function buildCheckout(ctx: Ctx, actor: Actor, quoteId: string, expectedVersion: number | undefined) {
  // Checkout mints a hosted payment session. No billing provider is wired
  // through mutations, so live mode must fail closed instead of minting a
  // demo payment URL that looks real.
  requireProviderInDemo("Checkout");
  if (actor.role !== "customer") throw new EngineError("FORBIDDEN", "Only customers can checkout", { status: 403 });
  assertUuid(quoteId, "quoteId");
  const q = await ctx.db.query("quotes").withIndex("by_lid", (q2) => q2.eq("lid", quoteId)).first();
  if (!q || q.customerId !== actor.id) throw new EngineError("NOT_FOUND", "Quote not found", { status: 404 });
  if (expectedVersion !== undefined && q.version !== expectedVersion) {
    throw new EngineError("VERSION_CONFLICT", `Expected version ${expectedVersion} but current is ${q.version}`, {
      status: 409,
    });
  }
  if (Date.parse(q.expiresAt) < Date.now()) {
    throw new EngineError("QUOTE_EXPIRED", "Quote expired; request a fresh quote", { status: 410 });
  }
  const existing = await ctx.db.query("orders").withIndex("by_quote", (x) => x.eq("quoteId", quoteId)).first();
  if (existing) {
    const pays = await ctx.db.query("payments").withIndex("by_order", (x) => x.eq("orderId", existing.lid)).collect();
    const pay = pays.filter((p) => p.purpose === "INITIAL").sort((a, b) => (a.expiresAt < b.expiresAt ? 1 : -1))[0];
    if (!pay) throw new EngineError("PROVIDER_OUTCOME_UNKNOWN", "Payment record missing", { status: 502 });
    return {
      orderId: existing.lid,
      paymentId: pay.lid,
      paymentUrl: pay.paymentUrl,
      expiresAt: pay.expiresAt,
      status: "AWAITING_PAYMENT",
    };
  }
  const hold = await ctx.db.query("capacityHolds").withIndex("by_lid", (x) => x.eq("lid", q.holdId)).first();
  if (!hold || hold.released || Date.parse(hold.expiresAt) < Date.now()) {
    throw new EngineError("QUOTE_EXPIRED", "Capacity hold expired; request a fresh quote", { status: 410 });
  }
  const addr = await ctx.db.query("addresses").withIndex("by_lid", (x) => x.eq("lid", q.addressId)).first();
  const orderId = uuid();
  const lines = (q.lines as { orderLineId?: string }[]).map((l) => ({ ...l, orderLineId: uuid() }));
  const snapshot = addr
    ? { line1: addr.line1, city: addr.city, postalCode: addr.postalCode, label: addr.label }
    : {};
  await ctx.db.insert("orders", {
    lid: orderId,
    version: 1,
    customerId: actor.id,
    quoteId,
    status: "AWAITING_PAYMENT",
    lines,
    totalMinor: q.totalMinor,
    currency: "INR",
    pickupWindow: q.pickupWindow,
    promisedReturn: q.promisedReturn,
    addressSnapshot: snapshot,
    paymentStatus: "CREATED",
    pickupOtp: sixDigitOtp(),
    returnOtp: sixDigitOtp(),
    createdAt: nowIso(),
  });
  await ctx.db.insert("orderTimeline", { orderId, status: "AWAITING_PAYMENT", label: "Checkout created", at: nowIso() });
  const paymentId = uuid();
  const paymentUrl = `${paymentBaseUrl()}/demo/pay/${paymentId}`;
  const payExpiry = new Date(Date.now() + 30 * 60_000).toISOString();
  await ctx.db.insert("payments", {
    lid: paymentId,
    orderId,
    quoteId,
    purpose: "INITIAL",
    amountMinor: q.totalMinor,
    currency: "INR",
    status: "PENDING",
    provider: "demo",
    paymentUrl,
    expiresAt: payExpiry,
  });
  await emitOutbox(ctx, orderId, "checkout.created.v1", { orderId, quoteId, paymentId });
  return { orderId, paymentId, paymentUrl, expiresAt: payExpiry, status: "AWAITING_PAYMENT" };
}

async function capturePaymentCore(ctx: Ctx, actor: Actor, paymentId: string) {
  requireDemo();
  assertUuid(paymentId, "paymentId");
  const pay = await ctx.db.query("payments").withIndex("by_lid", (q) => q.eq("lid", paymentId)).first();
  if (!pay) throw new EngineError("NOT_FOUND", "Payment not found", { status: 404 });
  const order = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", pay.orderId)).first();
  if (!order) throw new EngineError("NOT_FOUND", "Order not found", { status: 404 });
  if (order.customerId !== actor.id && actor.role !== "operator") {
    throw new EngineError("NOT_FOUND", "Order not found", { status: 404 });
  }
  if (pay.status === "CAPTURED") {
    return toOrderView(ctx, order as unknown as Record<string, unknown>);
  }
  if (pay.status !== "PENDING") {
    throw new EngineError("PAYMENT_PENDING", `Payment is ${pay.status}`, { status: 409 });
  }
  if (order.status === "CANCELLED" || order.status === "CANCEL_REQUESTED") {
    await ctx.db.patch(pay._id, { status: "CAPTURED" });
    const obLid = uuid();
    await ctx.db.insert("refundObligations", {
      lid: obLid,
      orderId: order.lid,
      amountMinor: pay.amountMinor,
      reason: "late capture on cancelled order",
      status: "OPEN",
    });
    await emitOutbox(ctx, order.lid, "refund.updated.v1", {
      refundId: null,
      obligationId: obLid,
      orderId: order.lid,
      status: "OPEN",
      amount: pay.amountMinor,
    });
    const still = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", order.lid)).first();
    return toOrderView(ctx, still as unknown as Record<string, unknown>);
  }
  await ctx.db.patch(pay._id, { status: "CAPTURED" });
  if (pay.purpose === "TOP_UP") {
    const adj = (order.adjustment ?? {}) as Record<string, unknown>;
    await ctx.db.patch(order._id, {
      status: "AT_FACILITY",
      totalMinor: order.totalMinor + pay.amountMinor,
      version: order.version + 1,
      adjustment: { ...adj, status: "TOPUP_PAID", topupPaymentId: paymentId },
    });
    await ctx.db.insert("orderTimeline", {
      orderId: order.lid,
      status: "AT_FACILITY",
      label: "Top-up captured; intake resolved, care may proceed",
      at: nowIso(),
    });
    await emitOutbox(ctx, order.lid, "payment.captured.v1", {
      paymentId,
      orderId: order.lid,
      quoteId: pay.quoteId,
      purpose: pay.purpose,
      amount: pay.amountMinor,
    });
    const topped = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", order.lid)).first();
    return toOrderView(ctx, topped as unknown as Record<string, unknown>);
  }
  await ctx.db.patch(order._id, { status: "CONFIRMED", paymentStatus: "CAPTURED", version: order.version + 1 });
  await ctx.db.insert("orderTimeline", { orderId: order.lid, status: "CONFIRMED", label: "Payment captured", at: nowIso() });
  await emitOutbox(ctx, order.lid, "payment.captured.v1", {
    paymentId,
    orderId: order.lid,
    quoteId: pay.quoteId,
    purpose: pay.purpose,
    amount: pay.amountMinor,
  });
  await emitOutbox(ctx, order.lid, "order.confirmed.v1", { orderId: order.lid });
  const snap = order.addressSnapshot as { line1?: string; city?: string; postalCode?: string };
  const addressText = [snap?.line1, snap?.city, snap?.postalCode].filter(Boolean).join(", ") || "demo address";
  let custName = "Demo Customer";
  const cust = await ctx.db.query("identities").withIndex("by_lid", (q) => q.eq("lid", order.customerId)).first();
  if (cust) custName = cust.name;
  const existingJobs = await ctx.db.query("deliveryJobs").withIndex("by_order", (q) => q.eq("orderId", order.lid)).collect();
  if (existingJobs.length === 0) {
    await ctx.db.insert("deliveryJobs", {
      lid: uuid(),
      orderId: order.lid,
      leg: "PICKUP",
      attempt: 1,
      status: "BOOKED",
      version: 1,
      customerName: custName,
      address: addressText,
      window: order.pickupWindow,
      bagIds: [],
      provider: "manual",
      dispatchMode: "MANUAL",
      capabilities: ["OTP_HANDOVER"],
    });
    await ctx.db.insert("deliveryJobs", {
      lid: uuid(),
      orderId: order.lid,
      leg: "RETURN",
      attempt: 1,
      status: "BOOKED",
      version: 1,
      customerName: custName,
      address: addressText,
      window: order.promisedReturn,
      bagIds: [],
      provider: "manual",
      dispatchMode: "MANUAL",
      capabilities: ["OTP_HANDOVER"],
    });
  }
  const updated = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", order.lid)).first();
  if (!updated) throw new EngineError("NOT_FOUND", "Order not found", { status: 404 });
  await ctx.db.patch(updated._id, { status: "PICKUP_PENDING", version: updated.version + 1 });
  await ctx.db.insert("orderTimeline", {
    orderId: order.lid,
    status: "PICKUP_PENDING",
    label: "Pickup scheduled",
    at: nowIso(),
  });
  const final = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", order.lid)).first();
  return toOrderView(ctx, final as unknown as Record<string, unknown>);
}

// ---------- dispatch ----------

export const dispatch = internalMutation({
  args: {
    method: v.string(),
    path: v.string(),
    token: v.optional(v.string()),
    body: v.optional(v.any()),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ok = (status: number, body: unknown) => ({ status, body });
    try {
      const method = args.method.toUpperCase();
      const rawPath = args.path.split("?")[0];
      const body = args.body ?? {};
      const key = args.idempotencyKey;
      const actor = await actorFromToken(ctx, args.token);

      const idem = async <T>(template: string, a: Actor, payload: unknown, fn: () => Promise<T>): Promise<T> => {
        const scope = scopeOf(method, template);
        const replay = await checkIdempotency(ctx, scope, key, a.id, payload);
        if (replay.replay) return (replay.response as { body: T }).body as T;
        const result = await fn();
        await storeIdempotency(ctx, scope, key, a.id, payload, { status: 200, body: result });
        return result;
      };

      // ----- public auth -----
      // Blocker: no real SMS/auth provider is wired, and lib/ids.ts falls
      // back to Math.random when Web Crypto is unavailable. Math.random must
      // never secure real sessions, so both OTP lanes stay DEMO-gated until
      // a real provider plus strong randomness lands. Live callers get
      // PROVIDER_UNAVAILABLE, never an unsent challenge.
      if (method === "POST" && rawPath === "/v1/auth/otp/request") {
        requireProviderInDemo("OTP request");
        const phone = (body as Record<string, unknown>).phone;
        if (typeof phone !== "string" || phone.length < 6 || phone.length > 20) {
          throw new EngineError("INVALID_INPUT", "phone must be 6..20 chars", { status: 400 });
        }
        const code = (process.env as Record<string, string | undefined>).DEMO_OTP_CODE ?? "000000";
        const lid = uuid();
        await ctx.db.insert("otpChallenges", {
          lid,
          phone,
          code,
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          attempts: 0,
          consumed: false,
        });
        return ok(200, { challengeId: lid, demoCode: code });
      }

      if (method === "POST" && rawPath === "/v1/auth/otp/verify") {
        requireProviderInDemo("OTP verify");
        const o = body as Record<string, unknown>;
        const challengeId = assertUuid(o.challengeId, "challengeId");
        const code = o.code;
        if (typeof code !== "string" || code.length < 4 || code.length > 10) {
          throw new EngineError("INVALID_INPUT", "Invalid OTP code", { status: 400 });
        }
        const ch = await ctx.db.query("otpChallenges").withIndex("by_lid", (q) => q.eq("lid", challengeId)).first();
        if (!ch) throw new EngineError("NOT_FOUND", "OTP challenge not found", { status: 404 });
        if (ch.consumed) throw new EngineError("INVALID_INPUT", "Challenge already used", { status: 400 });
        if (Date.parse(ch.expiresAt) < Date.now()) throw new EngineError("INVALID_INPUT", "OTP expired", { status: 400 });
        if (ch.attempts >= 5) throw new EngineError("RATE_LIMITED", "Too many OTP attempts", { status: 429 });
        if (ch.code !== code) {
          await ctx.db.patch(ch._id, { attempts: ch.attempts + 1 });
          throw new EngineError("INVALID_INPUT", "Invalid OTP code", { status: 400 });
        }
        await ctx.db.patch(ch._id, { consumed: true });
        let user = await ctx.db.query("identities").withIndex("by_phone", (q) => q.eq("phone", ch.phone)).first();
        if (!user) {
          const lid = uuid();
          await ctx.db.insert("identities", { lid, role: "customer", name: "Demo Customer", phone: ch.phone });
          user = await ctx.db.query("identities").withIndex("by_lid", (q) => q.eq("lid", lid)).first();
        }
        const token = sessionToken();
        await ctx.db.insert("sessions", {
          token,
          userId: user!.lid,
          expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
          createdAt: nowIso(),
        });
        return ok(200, {
          token,
          user: { id: user!.lid, role: user!.role, name: user!.name, phone: user!.phone },
        });
      }

      if (method === "POST" && rawPath === "/v1/auth/demo") {
        requireDemo();
        const role = (body as Record<string, unknown>).role;
        if (role !== "customer" && role !== "rider" && role !== "operator") {
          throw new EngineError("INVALID_INPUT", "role must be customer, rider, or operator", { status: 400 });
        }
        const phones: Record<string, string> = {
          customer: (process.env as Record<string, string | undefined>).DEMO_CUSTOMER_PHONE ?? "+91-90000-00001",
          rider: (process.env as Record<string, string | undefined>).DEMO_RIDER_PHONE ?? "+91-90000-00002",
          operator: (process.env as Record<string, string | undefined>).DEMO_OPERATOR_PHONE ?? "+91-90000-00003",
        };
        const user = await ctx.db.query("identities").withIndex("by_phone", (q) => q.eq("phone", phones[role])).first();
        if (!user) throw new EngineError("NOT_FOUND", "Demo seed user missing; run seedDemo first", { status: 404 });
        if (user.role !== role) throw new EngineError("NOT_FOUND", "Demo seed user missing; run seedDemo first", { status: 404 });
        const token = sessionToken();
        await ctx.db.insert("sessions", {
          token,
          userId: user.lid,
          expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
          createdAt: nowIso(),
        });
        return ok(200, {
          token,
          user: { id: user.lid, role: user.role, name: user.name, phone: user.phone },
        });
      }

      // ----- public catalog -----
      if (method === "GET" && rawPath === "/v1/service-areas/check") {
        return ok(200, { serviceable: true, areaId: "demo-area-bengaluru", hours: "09:00-18:00 Asia/Kolkata" });
      }
      if (method === "GET" && rawPath === "/v1/services") {
        const rows = await ctx.db.query("services").collect();
        return ok(200, rows.filter((s) => s.active).map((s) => toServiceView(s as unknown as Record<string, unknown>)));
      }
      {
        const m = rawPath.match(/^\/v1\/services\/([^/]+)\/reviews$/);
        if (method === "GET" && m) {
          const serviceId = decodeURIComponent(m[1]);
          const reviews = await ctx.db.query("reviews").collect();
          const out: ReturnType<typeof toReviewView>[] = [];
          for (const r of reviews) {
            if (r.status !== "APPROVED") continue;
            const order = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", r.orderId)).first();
            if (!order) continue;
            if (canonicalJson(order.lines).includes(serviceId)) out.push(toReviewView(r as unknown as Record<string, unknown>));
          }
          return ok(200, out.slice(0, 50));
        }
      }
      {
        const m = rawPath.match(/^\/v1\/services\/([^/]+)$/);
        if (method === "GET" && m) {
          const id = decodeURIComponent(m[1]);
          const s = await ctx.db.query("services").withIndex("by_lid", (q) => q.eq("lid", id)).first();
          if (!s || !s.active) throw new EngineError("NOT_FOUND", "Service not found", { status: 404 });
          return ok(200, toServiceView(s as unknown as Record<string, unknown>));
        }
      }

      // ----- everything below needs a session -----
      const me = requireActor(actor);

      if (method === "POST" && rawPath === "/v1/auth/logout") {
        const sessions = await ctx.db.query("sessions").withIndex("by_token", (q) => q.eq("token", args.token ?? "")).collect();
        for (const s of sessions) await ctx.db.delete(s._id);
        return ok(200, { ok: true });
      }
      if (method === "GET" && rawPath === "/v1/me") {
        const user = await ctx.db.query("identities").withIndex("by_lid", (q) => q.eq("lid", me.id)).first();
        if (!user) throw new EngineError("NOT_FOUND", "User not found", { status: 404 });
        return ok(200, { id: user.lid, role: user.role, name: user.name, phone: user.phone });
      }

      // Facility fail-closed backstop: no memberships provisioned, so no
      // business route below is reachable to facility credentials.
      requireNotFacility(me);

      // ----- addresses -----
      if (method === "GET" && rawPath === "/v1/addresses") {
        const rows = await ctx.db.query("addresses").withIndex("by_owner", (q) => q.eq("ownerId", me.id)).collect();
        return ok(
          200,
          rows
            .filter((a) => !a.deleted)
            .map((a) => ({ id: a.lid, version: a.version, ownerId: a.ownerId, label: a.label, line1: a.line1, city: a.city, postalCode: a.postalCode }))
        );
      }
      if (method === "POST" && rawPath === "/v1/addresses") {
        const o = body as Record<string, unknown>;
        for (const f of ["label", "line1", "city", "postalCode"] as const) {
          if (typeof o[f] !== "string" || (o[f] as string).length < 1) {
            throw new EngineError("INVALID_INPUT", `${f} is required`, { status: 400 });
          }
        }
        const lid = uuid();
        await ctx.db.insert("addresses", {
          lid,
          ownerId: me.id,
          label: o.label as string,
          line1: o.line1 as string,
          city: o.city as string,
          postalCode: o.postalCode as string,
          version: 1,
          deleted: false,
        });
        const row = await ctx.db.query("addresses").withIndex("by_lid", (q) => q.eq("lid", lid)).first();
        return ok(200, {
          id: row!.lid,
          version: row!.version,
          ownerId: row!.ownerId,
          label: row!.label,
          line1: row!.line1,
          city: row!.city,
          postalCode: row!.postalCode,
        });
      }
      {
        const m = rawPath.match(/^\/v1\/addresses\/([^/]+)$/);
        if (m) {
          const id = decodeURIComponent(m[1]);
          if (method === "PATCH") {
            const o = body as Record<string, unknown>;
            if (typeof o.expectedVersion !== "number" || o.expectedVersion < 1) {
              throw new EngineError("INVALID_INPUT", "expectedVersion must be >= 1", { status: 400 });
            }
            const own = await ctx.db.query("addresses").withIndex("by_lid", (q) => q.eq("lid", id)).first();
            if (!own || own.ownerId !== me.id || own.deleted) {
              throw new EngineError("NOT_FOUND", "Address not found", { status: 404 });
            }
            if (own.version !== o.expectedVersion) {
              throw new EngineError("VERSION_CONFLICT", "Stale address version", { status: 409 });
            }
            await ctx.db.patch(own._id, {
              label: (o.label as string | undefined) ?? own.label,
              line1: (o.line1 as string | undefined) ?? own.line1,
              city: (o.city as string | undefined) ?? own.city,
              postalCode: (o.postalCode as string | undefined) ?? own.postalCode,
              version: own.version + 1,
            });
            const row = await ctx.db.query("addresses").withIndex("by_lid", (q) => q.eq("lid", id)).first();
            return ok(200, {
              id: row!.lid,
              version: row!.version,
              ownerId: row!.ownerId,
              label: row!.label,
              line1: row!.line1,
              city: row!.city,
              postalCode: row!.postalCode,
            });
          }
          if (method === "DELETE") {
            const own = await ctx.db.query("addresses").withIndex("by_lid", (q) => q.eq("lid", id)).first();
            if (!own || own.ownerId !== me.id || own.deleted) {
              throw new EngineError("NOT_FOUND", "Address not found", { status: 404 });
            }
            await ctx.db.patch(own._id, { deleted: true });
            return ok(200, { ok: true });
          }
        }
      }
      if (method === "POST" && rawPath === "/v1/account-links/whatsapp") {
        if (me.role !== "customer") throw new EngineError("FORBIDDEN", "Only customers link WhatsApp", { status: 403 });
        const o = body as Record<string, unknown>;
        if (typeof o.senderPhone !== "string" || o.senderPhone.length < 6) {
          throw new EngineError("INVALID_INPUT", "senderPhone is not a phone number", { status: 400 });
        }
        const digits = o.senderPhone.replace(/[^\d]/g, "");
        if (digits.length < 6) throw new EngineError("INVALID_INPUT", "senderPhone is not a phone number", { status: 400 });
        let linked = 0;
        for (const k of [`wa:${o.senderPhone}`, `wa:${digits}`]) {
          const drafts = await ctx.db.query("conversationDrafts").withIndex("by_key", (q) => q.eq("conversationKey", k)).collect();
          for (const d of drafts) {
            if (!d.customerId || d.customerId === me.id) {
              await ctx.db.patch(d._id, { customerId: me.id, updatedAt: nowIso() });
              linked += 1;
            }
          }
        }
        return ok(200, {
          ok: true,
          linkedDrafts: linked,
          note: "Channel drafts linked to this OTP-verified account; confirmations still require bound draft/revision/quote.",
        });
      }

      // ----- catalog writes / reviews -----
      if (method === "POST" && rawPath === "/v1/reviews") {
        const input = parseReview(body);
        const result = await idem("POST /v1/reviews", me, input, async () => {
          if (me.role !== "customer") throw new EngineError("FORBIDDEN", "Only customers review", { status: 403 });
          const order = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", input.orderId)).first();
          if (!order || order.customerId !== me.id) throw new EngineError("NOT_FOUND", "Order not found", { status: 404 });
          if (order.status !== "DELIVERED") {
            throw new EngineError("INVALID_INPUT", "Only delivered orders can be reviewed", { status: 400 });
          }
          const dup = await ctx.db.query("reviews").withIndex("by_order", (q) => q.eq("orderId", input.orderId)).first();
          if (dup) throw new EngineError("INVALID_INPUT", "One review per order", { status: 400 });
          const lid = uuid();
          await ctx.db.insert("reviews", {
            lid,
            orderId: input.orderId,
            customerId: me.id,
            overall: input.overall,
            ...(input.serviceScore === undefined ? {} : { serviceScore: input.serviceScore }),
            ...(input.deliveryScore === undefined ? {} : { deliveryScore: input.deliveryScore }),
            ...(input.comment === undefined ? {} : { comment: input.comment }),
            mediaIds: input.mediaIds,
            consent: input.publishConsent,
            status: "PENDING",
            version: 1,
            createdAt: nowIso(),
          });
          const row = await ctx.db.query("reviews").withIndex("by_lid", (q) => q.eq("lid", lid)).first();
          return toReviewView(row as unknown as Record<string, unknown>);
        });
        return ok(200, result);
      }
      if (method === "POST" && rawPath === "/v1/ops/services") {
        requireRole(me, ["operator", "admin"]);
        const o = body as Record<string, unknown>;
        const code = o.code;
        if (code !== "WASH_FOLD" && code !== "WASH_PRESS" && code !== "PRESS_ONLY" && code !== "DRY_CLEAN") {
          throw new EngineError("INVALID_INPUT", "unknown service code", { status: 400 });
        }
        for (const f of ["name", "description", "imageUrl", "priceUnit"] as const) {
          if (typeof o[f] !== "string" || (o[f] as string).length < 1) {
            throw new EngineError("INVALID_INPUT", `${f} is required`, { status: 400 });
          }
        }
        if (typeof o.priceMinor !== "number" || o.priceMinor < 0) {
          throw new EngineError("INVALID_INPUT", "priceMinor must be >= 0", { status: 400 });
        }
        const id = o.id !== undefined ? assertUuid(o.id, "id") : uuid();
        const existing = await ctx.db.query("services").withIndex("by_lid", (q) => q.eq("lid", id)).first();
        const doc = {
          lid: id,
          code: code as string,
          name: o.name as string,
          description: o.description as string,
          imageUrl: o.imageUrl as string,
          priceMinor: o.priceMinor as number,
          priceUnit: o.priceUnit as string,
          turnaroundHours: typeof o.turnaroundHours === "number" && o.turnaroundHours > 0 ? (o.turnaroundHours as number) : 48,
          garments: [],
          features: Array.isArray(o.features) ? (o.features as string[]) : [],
          active: true,
        };
        if (existing) await ctx.db.patch(existing._id, doc);
        else await ctx.db.insert("services", { ...doc, garments: [] });
        const row = await ctx.db.query("services").withIndex("by_lid", (q) => q.eq("lid", id)).first();
        return ok(200, toServiceView(row as unknown as Record<string, unknown>));
      }
      if (method === "POST" && rawPath === "/v1/ops/rate-cards") {
        requireRole(me, ["operator", "admin"]);
        const cards = await ctx.db.query("rateCards").collect();
        const next = cards.reduce((n, c) => Math.max(n, c.version), 0) + 1;
        const lid = uuid();
        await ctx.db.insert("rateCards", { lid, version: next, currency: "INR" });
        return ok(200, { id: lid, version: next });
      }
      {
        const m = rawPath.match(/^\/v1\/ops\/reviews\/([^/]+)$/);
        if (m && method === "PATCH") {
          requireRole(me, ["operator", "admin"]);
          const id = decodeURIComponent(m[1]);
          const o = body as Record<string, unknown>;
          if (typeof o.approve !== "boolean") throw new EngineError("INVALID_INPUT", "approve is required", { status: 400 });
          const row = await ctx.db.query("reviews").withIndex("by_lid", (q) => q.eq("lid", id)).first();
          if (!row) throw new EngineError("NOT_FOUND", "Review not found", { status: 404 });
          await ctx.db.patch(row._id, { status: o.approve ? "APPROVED" : "REJECTED" });
          const updated = await ctx.db.query("reviews").withIndex("by_lid", (q) => q.eq("lid", id)).first();
          return ok(200, toReviewView(updated as unknown as Record<string, unknown>));
        }
      }

      // ----- quotes / checkout / orders -----
      if (method === "POST" && rawPath === "/v1/quotes") {
        const input = parseQuoteInput(body);
        const result = await idem("POST /v1/quotes", me, input, async () => buildQuote(ctx, me, input));
        return ok(200, result);
      }
      if (method === "POST" && rawPath === "/v1/checkouts") {
        const parsed = parseCheckout(body);
        const payload = { quoteId: parsed.quoteId, expectedVersion: parsed.expectedVersion ?? null };
        const result = await idem("POST /v1/checkouts", me, payload, async () =>
          buildCheckout(ctx, me, parsed.quoteId, parsed.expectedVersion)
        );
        return ok(200, result);
      }
      if (method === "GET" && rawPath === "/v1/orders") {
        // Customer sees own orders; operator/admin see the queue. Rider and
        // facility have no order-list lane: riders see only assigned jobs via
        // /v1/partner/jobs, facility is fail-closed (no memberships).
        if (me.role !== "customer" && me.role !== "operator" && me.role !== "admin") {
          throw new EngineError("FORBIDDEN", "Order list not available for this role", { status: 403 });
        }
        const rows =
          me.role === "customer"
            ? await ctx.db.query("orders").withIndex("by_customer", (q) => q.eq("customerId", me.id)).collect()
            : await ctx.db.query("orders").collect();
        rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        const out: Record<string, unknown>[] = [];
        for (const o of rows.slice(0, 50)) out.push(await toOrderView(ctx, o as unknown as Record<string, unknown>));
        return ok(200, out);
      }
      {
        const m = rawPath.match(/^\/v1\/orders\/([^/]+)\/timeline$/);
        if (m && method === "GET") {
          const order = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", decodeURIComponent(m[1]))).first();
          if (!order) throw new EngineError("NOT_FOUND", "Order not found", { status: 404 });
          if (me.role === "customer") {
            if (order.customerId !== me.id) throw new EngineError("NOT_FOUND", "Order not found", { status: 404 });
          } else if (me.role === "rider") {
            // Riders read timeline only for orders they are assigned to.
            const mine = await ctx.db.query("deliveryJobs").withIndex("by_assignee", (q) => q.eq("assignedTo", me.id)).collect();
            if (!mine.some((j) => j.orderId === order.lid)) throw new EngineError("NOT_FOUND", "Order not found", { status: 404 });
          } else if (me.role !== "operator" && me.role !== "admin") {
            throw new EngineError("FORBIDDEN", "Timeline not available for this role", { status: 403 });
          }
          return ok(200, await timelineFor(ctx, order.lid));
        }
      }
      {
        const m = rawPath.match(/^\/v1\/orders\/([^/]+)\/handover-code$/);
        if (m && method === "GET") {
          requireDemo();
          const order = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", decodeURIComponent(m[1]))).first();
          if (!order || order.customerId !== me.id) throw new EngineError("NOT_FOUND", "Order not found", { status: 404 });
          const revealReturn =
            me.role === "customer" &&
            ["READY_FOR_RETURN", "RETURNING", "DELIVERED"].includes(order.status);
          return ok(200, {
            orderId: order.lid,
            ...(order.pickupOtp ? { pickupOtp: order.pickupOtp } : {}),
            ...(revealReturn && order.returnOtp ? { returnOtp: order.returnOtp } : {}),
            note: "Demo handover codes are customer-visible only; riders submit them blind.",
          });
        }
      }
      {
        const m = rawPath.match(/^\/v1\/orders\/([^/]+)$/);
        if (m && method === "GET") {
          const order = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", decodeURIComponent(m[1]))).first();
          if (!order) throw new EngineError("NOT_FOUND", "Order not found", { status: 404 });
          if (me.role === "customer") {
            if (order.customerId !== me.id) throw new EngineError("NOT_FOUND", "Order not found", { status: 404 });
          } else if (me.role === "rider") {
            const mine = await ctx.db.query("deliveryJobs").withIndex("by_assignee", (q) => q.eq("assignedTo", me.id)).collect();
            if (!mine.some((j) => j.orderId === order.lid)) throw new EngineError("NOT_FOUND", "Order not found", { status: 404 });
          } else if (me.role !== "operator" && me.role !== "admin") {
            // Facility is already fail-closed above; any other role is denied
            // the shared order view without OTP material.
            throw new EngineError("FORBIDDEN", "Order not available for this role", { status: 403 });
          }
          return ok(200, await toOrderView(ctx, order as unknown as Record<string, unknown>));
        }
      }
      {
        const m = rawPath.match(/^\/v1\/orders\/([^/]+)\/cancel$/);
        if (m && method === "POST") {
          const orderId = decodeURIComponent(m[1]);
          const o = body as Record<string, unknown>;
          if (typeof o.reason !== "string" || o.reason.length < 1) {
            throw new EngineError("INVALID_INPUT", "reason is required", { status: 400 });
          }
          if (typeof o.expectedVersion !== "number" || o.expectedVersion < 1) {
            throw new EngineError("INVALID_INPUT", "expectedVersion must be >= 1", { status: 400 });
          }
          const order = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", orderId)).first();
          if (!order) throw new EngineError("NOT_FOUND", "Order not found", { status: 404 });
          // Cancel lanes: owning customer, operator, admin. Rider and
          // facility (fail-closed) cannot cancel any order.
          if (me.role === "customer") {
            if (order.customerId !== me.id) throw new EngineError("NOT_FOUND", "Order not found", { status: 404 });
          } else if (me.role !== "operator" && me.role !== "admin") {
            throw new EngineError("FORBIDDEN", "Only the owning customer, operator, or admin can cancel", { status: 403 });
          }
          if (order.version !== o.expectedVersion) {
            throw new EngineError("VERSION_CONFLICT", `Expected version ${o.expectedVersion} but current is ${order.version}`, {
              status: 409,
            });
          }
          if (["IN_CARE", "QUALITY_CHECK", "READY_FOR_RETURN", "RETURNING", "DELIVERED", "CANCELLED"].includes(order.status)) {
            throw new EngineError("INVALID_INPUT", `Cannot cancel order in ${order.status}`, { status: 400 });
          }
          await ctx.db.patch(order._id, { status: "CANCEL_REQUESTED", version: order.version + 1 });
          const jobs = await ctx.db.query("deliveryJobs").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect();
          for (const j of jobs) {
            if (!["COMPLETED", "CANCELLED"].includes(j.status)) {
              await ctx.db.patch(j._id, { status: "CANCELLED", version: j.version + 1 });
            }
          }
          const pays = await ctx.db.query("payments").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect();
          const captured = pays.filter((p) => p.status === "CAPTURED").reduce((n, p) => n + p.amountMinor, 0);
          if (captured > 0) {
            await ctx.db.insert("refundObligations", {
              lid: uuid(),
              orderId,
              amountMinor: captured,
              reason: (o.reason as string) || "order cancelled",
              status: "OPEN",
            });
          }
          const cur = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", orderId)).first();
          await ctx.db.patch(cur!._id, { status: "CANCELLED", version: cur!.version + 1 });
          await ctx.db.insert("orderTimeline", {
            orderId,
            status: "CANCEL_REQUESTED",
            label: `Cancel requested: ${o.reason}`,
            at: nowIso(),
          });
          await ctx.db.insert("orderTimeline", { orderId, status: "CANCELLED", label: "Order cancelled", at: nowIso() });
          await emitOutbox(ctx, orderId, "order.updated.v1", { orderId, customerVisibleStatus: "CANCELLED" });
          const view = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", orderId)).first();
          return ok(200, await toOrderView(ctx, view as unknown as Record<string, unknown>));
        }
      }
      {
        const m = rawPath.match(/^\/v1\/orders\/([^/]+)\/reschedule$/);
        if (m && method === "POST") {
          if (me.role !== "customer") throw new EngineError("FORBIDDEN", "Only customers", { status: 403 });
          const orderId = decodeURIComponent(m[1]);
          const o = body as Record<string, unknown>;
          const newQuoteId = assertUuid(o.newQuoteId, "newQuoteId");
          if (typeof o.expectedVersion !== "number" || o.expectedVersion < 1) {
            throw new EngineError("INVALID_INPUT", "expectedVersion must be >= 1", { status: 400 });
          }
          const order = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", orderId)).first();
          if (!order || order.customerId !== me.id) throw new EngineError("NOT_FOUND", "Order not found", { status: 404 });
          if (order.version !== o.expectedVersion) throw new EngineError("VERSION_CONFLICT", "Stale order version", { status: 409 });
          if (!["CONFIRMED", "PICKUP_PENDING"].includes(order.status)) {
            throw new EngineError("INVALID_INPUT", `Cannot reschedule in ${order.status}`, { status: 400 });
          }
          const q = await ctx.db.query("quotes").withIndex("by_lid", (x) => x.eq("lid", newQuoteId)).first();
          if (!q || q.customerId !== me.id) throw new EngineError("NOT_FOUND", "Quote not found", { status: 404 });
          await ctx.db.patch(order._id, {
            pickupWindow: q.pickupWindow,
            promisedReturn: q.promisedReturn,
            version: order.version + 1,
          });
          const jobs = await ctx.db.query("deliveryJobs").withIndex("by_order", (x) => x.eq("orderId", orderId)).collect();
          for (const j of jobs) {
            if (j.leg === "PICKUP" && j.status !== "COMPLETED") await ctx.db.patch(j._id, { window: q.pickupWindow });
          }
          await ctx.db.insert("orderTimeline", { orderId, status: order.status, label: "Pickup rescheduled", at: nowIso() });
          const view = await ctx.db.query("orders").withIndex("by_lid", (x) => x.eq("lid", orderId)).first();
          return ok(200, await toOrderView(ctx, view as unknown as Record<string, unknown>));
        }
      }
      {
        const m = rawPath.match(/^\/v1\/orders\/([^/]+)\/adjustments\/([^/]+)\/decision$/);
        if (m && method === "POST") {
          const orderId = decodeURIComponent(m[1]);
          const adjustmentId = decodeURIComponent(m[2]);
          const o = body as Record<string, unknown>;
          if (o.decision !== "ACCEPT" && o.decision !== "DECLINE") {
            throw new EngineError("INVALID_INPUT", "Bad decision", { status: 400 });
          }
          const order = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", orderId)).first();
          if (!order) throw new EngineError("NOT_FOUND", "Order not found", { status: 404 });
          // Adjustment decisions are customer-owner only. Operator, admin,
          // rider, and facility (fail-closed) cannot accept or decline.
          if (me.role !== "customer") {
            throw new EngineError("FORBIDDEN", "Only the owning customer decides adjustments", { status: 403 });
          }
          if (order.customerId !== me.id) {
            throw new EngineError("NOT_FOUND", "Order not found", { status: 404 });
          }
          if (o.expectedVersion !== undefined && order.version !== o.expectedVersion) {
            throw new EngineError("VERSION_CONFLICT", `Expected version ${o.expectedVersion} but current is ${order.version}`, {
              status: 409,
            });
          }
          const adj = order.adjustment as { id: string; status: string; deltaMinor: number } | undefined;
          if (!adj || adj.id !== adjustmentId || adj.status !== "PENDING") {
            throw new EngineError("INVALID_INPUT", "No pending adjustment", { status: 400 });
          }
          if (o.decision === "DECLINE") {
            await ctx.db.patch(order._id, {
              status: "AT_FACILITY",
              version: order.version + 1,
              adjustment: { ...adj, status: "DECLINED" },
            });
            await ctx.db.insert("orderTimeline", {
              orderId,
              status: "AT_FACILITY",
              label: "Adjustment declined; original terms stand",
              at: nowIso(),
            });
            const view = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", orderId)).first();
            return ok(200, await toOrderView(ctx, view as unknown as Record<string, unknown>));
          }
          if (adj.deltaMinor > 0) {
            // Top-up mints a demo payment session, so it is DEMO-gated like
            // checkout. The REQUIRES_APPROVAL throw below intentionally
            // commits the TOP_UP row plus the AWAITING_TOPUP transition in
            // the same mutation; the duplicate guards keep a retry from
            // minting a second payment.
            requireProviderInDemo("Adjustment top-up");
            const existingTopup = await ctx.db
              .query("payments")
              .withIndex("by_order", (q) => q.eq("orderId", orderId))
              .collect();
            if (existingTopup.some((p) => p.purpose === "TOP_UP" && p.status === "PENDING")) {
              throw new EngineError("REQUIRES_APPROVAL", "Top-up payment already pending", { status: 409 });
            }
            const topupId = uuid();
            await ctx.db.insert("payments", {
              lid: topupId,
              orderId,
              quoteId: order.quoteId,
              purpose: "TOP_UP",
              amountMinor: adj.deltaMinor,
              currency: "INR",
              status: "PENDING",
              provider: "demo",
              paymentUrl: `${paymentBaseUrl()}/demo/pay/${topupId}`,
              expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
            });
            await ctx.db.patch(order._id, {
              version: order.version + 1,
              adjustment: { ...adj, status: "AWAITING_TOPUP", topupPaymentId: topupId },
            });
            await ctx.db.insert("orderTimeline", {
              orderId,
              status: "AWAITING_ADJUSTMENT",
              label: "Top-up payment required before care",
              at: nowIso(),
            });
            throw new EngineError("REQUIRES_APPROVAL", "Top-up payment required before care", { status: 409 });
          }
          await ctx.db.insert("refundObligations", {
            lid: uuid(),
            orderId,
            amountMinor: Math.abs(adj.deltaMinor),
            reason: "intake lower than quote",
            status: "OPEN",
          });
          await ctx.db.patch(order._id, {
            status: "AT_FACILITY",
            totalMinor: order.totalMinor + adj.deltaMinor,
            version: order.version + 1,
            adjustment: { ...adj, status: "REFUND_OBLIGATED" },
          });
          await ctx.db.insert("orderTimeline", {
            orderId,
            status: "AT_FACILITY",
            label: "Lower intake price; refund tracked",
            at: nowIso(),
          });
          await emitOutbox(ctx, orderId, "refund.updated.v1", {
            orderId,
            status: "OPEN",
            amount: Math.abs(adj.deltaMinor),
          });
          const view = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", orderId)).first();
          return ok(200, await toOrderView(ctx, view as unknown as Record<string, unknown>));
        }
      }
      {
        const m = rawPath.match(/^\/v1\/demo\/payments\/([^/]+)\/capture$/);
        if (m && method === "POST") {
          const paymentId = decodeURIComponent(m[1]);
          const result = await idem("POST /v1/demo/payments/capture", me, { paymentId }, async () =>
            capturePaymentCore(ctx, me, paymentId)
          );
          return ok(200, result);
        }
      }

      // ----- support -----
      {
        const m = rawPath.match(/^\/v1\/orders\/([^/]+)\/support$/);
        if (m && method === "POST") {
          const orderId = decodeURIComponent(m[1]);
          const o = body as Record<string, unknown>;
          if (typeof o.message !== "string" || o.message.length < 1 || o.message.length > 2000) {
            throw new EngineError("INVALID_INPUT", "message must be 1..2000 chars", { status: 400 });
          }
          const order = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", orderId)).first();
          if (!order) throw new EngineError("NOT_FOUND", "Order not found", { status: 404 });
          // Support creation: owning customer, operator, admin. Rider and
          // facility (fail-closed) cannot open incidents on any order.
          if (me.role === "customer") {
            if (order.customerId !== me.id) throw new EngineError("NOT_FOUND", "Order not found", { status: 404 });
          } else if (me.role !== "operator" && me.role !== "admin") {
            throw new EngineError("FORBIDDEN", "Support incidents not available for this role", { status: 403 });
          }
          const lid = uuid();
          await ctx.db.insert("supportIncidents", {
            lid,
            orderId,
            customerId: order.customerId,
            status: "OPEN",
            messages: [{ id: uuid(), from: me.role, text: o.message, at: nowIso() }],
            createdAt: nowIso(),
          });
          return ok(200, { id: lid, status: "OPEN" });
        }
      }
      {
        const m = rawPath.match(/^\/v1\/support\/([^/]+)(\/messages)?$/);
        if (m) {
          const id = decodeURIComponent(m[1]);
          const isMessages = !!m[2];
          if (method === "GET" && !isMessages) {
            const row = await ctx.db.query("supportIncidents").withIndex("by_lid", (q) => q.eq("lid", id)).first();
            if (!row) throw new EngineError("NOT_FOUND", "Support incident not found", { status: 404 });
            // Support reads: owning customer, operator, admin. Rider and
            // facility (fail-closed) cannot read any incident.
            if (me.role === "customer") {
              if (row.customerId !== me.id) throw new EngineError("NOT_FOUND", "Support incident not found", { status: 404 });
            } else if (me.role !== "operator" && me.role !== "admin") {
              throw new EngineError("FORBIDDEN", "Support incidents not available for this role", { status: 403 });
            }
            return ok(200, { id: row.lid, status: row.status, messages: row.messages });
          }
          if (method === "POST" && isMessages) {
            const o = body as Record<string, unknown>;
            if (typeof o.message !== "string" || o.message.length < 1 || o.message.length > 2000) {
              throw new EngineError("INVALID_INPUT", "message must be 1..2000 chars", { status: 400 });
            }
            const row = await ctx.db.query("supportIncidents").withIndex("by_lid", (q) => q.eq("lid", id)).first();
            if (!row) throw new EngineError("NOT_FOUND", "Support incident not found", { status: 404 });
            if (me.role === "customer") {
              if (row.customerId !== me.id) throw new EngineError("NOT_FOUND", "Support incident not found", { status: 404 });
            } else if (me.role !== "operator" && me.role !== "admin") {
              throw new EngineError("FORBIDDEN", "Support incidents not available for this role", { status: 403 });
            }
            const messages = [...(row.messages as unknown[]), { id: uuid(), from: me.role, text: o.message, at: nowIso() }];
            await ctx.db.patch(row._id, { messages });
            return ok(200, { id, status: row.status, messages });
          }
        }
      }

      // ----- billing -----
      {
        const m = rawPath.match(/^\/v1\/payments\/([^/]+)$/);
        if (m && method === "GET") {
          const id = assertUuid(decodeURIComponent(m[1]), "paymentId");
          const pay = await ctx.db.query("payments").withIndex("by_lid", (q) => q.eq("lid", id)).first();
          if (!pay) throw new EngineError("NOT_FOUND", "Payment not found", { status: 404 });
          // Payment reads: owning customer, operator, admin. Rider and
          // facility (fail-closed) cannot read any payment.
          if (me.role === "customer") {
            const order = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", pay.orderId)).first();
            if (!order || order.customerId !== me.id) {
              throw new EngineError("NOT_FOUND", "Payment not found", { status: 404 });
            }
          } else if (me.role !== "operator" && me.role !== "admin") {
            throw new EngineError("FORBIDDEN", "Payments not available for this role", { status: 403 });
          }
          return ok(200, {
            id: pay.lid,
            orderId: pay.orderId,
            amountMinor: pay.amountMinor,
            currency: "INR",
            status: pay.status,
            paymentUrl: pay.paymentUrl,
          });
        }
      }
      {
        const m = rawPath.match(/^\/v1\/orders\/([^/]+)\/receipts$/);
        if (m && method === "GET") {
          const orderId = decodeURIComponent(m[1]);
          const order = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", orderId)).first();
          if (!order) throw new EngineError("NOT_FOUND", "Order not found", { status: 404 });
          // Receipt reads: owning customer, operator, admin. Rider and
          // facility (fail-closed) cannot read any receipt.
          if (me.role === "customer") {
            if (order.customerId !== me.id) throw new EngineError("NOT_FOUND", "Order not found", { status: 404 });
          } else if (me.role !== "operator" && me.role !== "admin") {
            throw new EngineError("FORBIDDEN", "Receipts not available for this role", { status: 403 });
          }
          const rows = await ctx.db.query("payments").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect();
          return ok(
            200,
            rows.map((p) => ({ id: p.lid, status: p.status, amountMinor: p.amountMinor, purpose: p.purpose }))
          );
        }
      }
      if (method === "POST" && rawPath === "/v1/ops/refunds") {
        requireRole(me, ["operator", "admin"]);
        // No refund provider is wired through mutations. Live mode must fail
        // closed; only DEMO_MODE may record a local SUCCEEDED row for
        // reconciliation drills. Never fake SUCCEEDED in live mode.
        requireProviderInDemo("Refund");
        const o = body as Record<string, unknown>;
        const orderId = assertUuid(o.orderId, "orderId");
        const paymentId = assertUuid(o.paymentId, "paymentId");
        if (typeof o.amountMinor !== "number" || !Number.isInteger(o.amountMinor) || o.amountMinor <= 0) {
          throw new EngineError("INVALID_INPUT", "Refund amount must be positive", { status: 400 });
        }
        if (typeof o.reason !== "string" || o.reason.length < 1) {
          throw new EngineError("INVALID_INPUT", "reason is required", { status: 400 });
        }
        const pays = await ctx.db.query("payments").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect();
        const captured = pays.filter((p) => p.status === "CAPTURED").reduce((n, p) => n + p.amountMinor, 0);
        const refunds = await ctx.db.query("refunds").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect();
        const refunded = refunds.filter((r) => r.status !== "FAILED").reduce((n, r) => n + r.amountMinor, 0);
        if ((o.amountMinor as number) > captured - refunded) {
          throw new EngineError("INVALID_INPUT", "Refunded sums cannot exceed captured sums", { status: 400 });
        }
        // DEMO_MODE only: local SUCCEEDED row keeps reconciliation testable.
        // Real provider dispatch moves to actions later.
        const lid = uuid();
        await ctx.db.insert("refunds", {
          lid,
          orderId,
          paymentId,
          ...(o.obligationId === undefined ? {} : { obligationId: assertUuid(o.obligationId, "obligationId") }),
          amountMinor: o.amountMinor as number,
          reason: o.reason as string,
          status: "SUCCEEDED",
        });
        return ok(200, { id: lid, status: "SUCCEEDED", amountMinor: o.amountMinor });
      }
      if (method === "GET" && rawPath === "/v1/ops/reconciliation") {
        requireRole(me, ["operator", "admin"]);
        const pays = await ctx.db.query("payments").collect();
        const refunds = await ctx.db.query("refunds").collect();
        const captured = pays.filter((p) => p.status === "CAPTURED").reduce((n, p) => n + p.amountMinor, 0);
        const refunded = refunds.filter((r) => r.status === "SUCCEEDED").reduce((n, r) => n + r.amountMinor, 0);
        const obs = await ctx.db.query("refundObligations").collect();
        return ok(200, {
          capturedMinor: captured,
          refundedMinor: refunded,
          netMinor: captured - refunded,
          openObligations: obs.filter((x) => x.status === "OPEN").slice(0, 50),
        });
      }

      // ----- partner jobs -----
      if (method === "GET" && rawPath === "/v1/partner/jobs") {
        if (me.role !== "rider") throw new EngineError("FORBIDDEN", "Riders only", { status: 403 });
        // Assigned-only: unassigned jobs are inaccessible and must not leak
        // contact/address. Assignment happens via ops dispatch, never rider
        // self-assignment.
        const rows = await ctx.db.query("deliveryJobs").collect();
        const mine = rows.filter((j) => j.assignedTo === me.id);
        return ok(200, mine.slice(0, 50).map((j) => toJobView(j as unknown as Record<string, unknown>)));
      }
      {
        const m = rawPath.match(/^\/v1\/partner\/jobs\/([^/]+)(\/(accept|handover|exception))?$/);
        if (m) {
          const jobId = decodeURIComponent(m[1]);
          const action = m[3];
          if (!action && method === "GET") {
            if (me.role !== "rider") throw new EngineError("FORBIDDEN", "Riders only", { status: 403 });
            const job = await ctx.db.query("deliveryJobs").withIndex("by_lid", (q) => q.eq("lid", jobId)).first();
            // Assigned-only: unassigned jobs are inaccessible, including their
            // contact/address. Return 404 so existence does not leak.
            if (!job || job.assignedTo !== me.id) {
              throw new EngineError("NOT_FOUND", "Delivery job not found", { status: 404 });
            }
            return ok(200, toJobView(job as unknown as Record<string, unknown>));
          }
          if (action === "accept" && method === "POST") {
            if (me.role !== "rider") throw new EngineError("FORBIDDEN", "Riders only", { status: 403 });
            assertUuid(jobId, "jobId");
            const job = await ctx.db.query("deliveryJobs").withIndex("by_lid", (q) => q.eq("lid", jobId)).first();
            // No self-assignment: only a job the server already assigned to
            // this rider can be accepted. Unassigned or other-rider jobs are
            // inaccessible (404, no existence leak). Ops dispatch assigns.
            if (!job || job.assignedTo !== me.id) {
              throw new EngineError("NOT_FOUND", "Delivery job not found", { status: 404 });
            }
            if (!["BOOKED", "ASSIGNED"].includes(job.status)) {
              throw new EngineError("INVALID_INPUT", `Cannot accept job in ${job.status}`, { status: 400 });
            }
            await ctx.db.patch(job._id, { assignedTo: me.id, status: "ASSIGNED", version: job.version + 1 });
            await emitOutbox(ctx, job.orderId, "delivery.updated.v1", {
              jobId,
              orderId: job.orderId,
              leg: job.leg,
              status: "ASSIGNED",
            });
            const updated = await ctx.db.query("deliveryJobs").withIndex("by_lid", (q) => q.eq("lid", jobId)).first();
            return ok(200, toJobView(updated as unknown as Record<string, unknown>));
          }
          if (action === "handover" && method === "POST") {
            const parsed = parseHandover(body, jobId);
            // Idempotency covers the full handover intent, not just actionId:
            // same key plus different bags, method, proof, or version must
            // 409 instead of replaying a stale COMPLETED view. The
            // handoverActions by_action row is a second permanent guard.
            const handoverPayload = {
              jobId,
              actionId: parsed.actionId,
              bagIds: parsed.bagIds,
              method: parsed.method,
              expectedVersion: parsed.expectedVersion,
              proofReference: parsed.proofReference ?? null,
              otpPresent: parsed.method === "OTP" ? true : false,
            };
            const result = await idem(
              "POST /v1/partner/jobs/handover",
              me,
              handoverPayload,
              async () => {
                if (me.role !== "rider" && !(me.role === "operator" && parsed.method === "OPERATOR_EXCEPTION")) {
                  throw new EngineError("FORBIDDEN", "Riders submit handovers; operator exceptions are audited separately", {
                    status: 403,
                  });
                }
                const dup = await ctx.db
                  .query("handoverActions")
                  .withIndex("by_action", (q) => q.eq("actionId", parsed.actionId))
                  .first();
                if (dup) {
                  const job = await ctx.db.query("deliveryJobs").withIndex("by_lid", (q) => q.eq("lid", jobId)).first();
                  return toJobView(job as unknown as Record<string, unknown>);
                }
                const job = await ctx.db.query("deliveryJobs").withIndex("by_lid", (q) => q.eq("lid", jobId)).first();
                if (!job) throw new EngineError("NOT_FOUND", "Delivery job not found", { status: 404 });
                const order = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", job.orderId)).first();
                if (!order) throw new EngineError("NOT_FOUND", "Order not found", { status: 404 });
                if (me.role === "rider" && job.assignedTo !== me.id) {
                  throw new EngineError("FORBIDDEN", "Stale assignment: job is not yours", { status: 403 });
                }
                if (job.version !== parsed.expectedVersion) {
                  throw new EngineError("VERSION_CONFLICT", `Expected version ${parsed.expectedVersion} but current is ${job.version}`, {
                    status: 409,
                  });
                }
                if (!["ASSIGNED", "AT_PICKUP", "IN_TRANSIT"].includes(job.status)) {
                  throw new EngineError("INVALID_INPUT", "Job is not active for handover", { status: 400 });
                }
                if (job.leg === "RETURN" && !["READY_FOR_RETURN", "RETURNING"].includes(order.status)) {
                  throw new EngineError("VERSION_CONFLICT", "Laundry is not ready for return handover", { status: 409 });
                }
                if (parsed.method === "OTP") {
                  const want = job.leg === "PICKUP" ? order.pickupOtp : order.returnOtp;
                  if (!parsed.otp || parsed.otp !== want) {
                    throw new EngineError("INVALID_INPUT", "Handover proof failed: wrong OTP", { status: 400 });
                  }
                } else if (parsed.method === "PROVIDER_PROOF") {
                  if (!parsed.proofReference) {
                    throw new EngineError("INVALID_INPUT", "proofReference required", { status: 400 });
                  }
                  // No provider-proof verification lane is implemented. A rider's
                  // arbitrary string is not authoritative proof and cannot replace OTP.
                  throw new EngineError("FORBIDDEN", "Provider proof requires verified provider transport", { status: 403 });
                } else if (me.role !== "operator") {
                  throw new EngineError("FORBIDDEN", "Operator exception needs an operator", { status: 403 });
                }
                await ctx.db.insert("handoverActions", {
                  actionId: parsed.actionId,
                  jobId,
                  method: parsed.method,
                  ...(parsed.proofReference ? { proofRef: parsed.proofReference } : {}),
                });
                await ctx.db.patch(job._id, { status: "COMPLETED", bagIds: parsed.bagIds, version: job.version + 1 });
                await emitOutbox(ctx, job.orderId, "delivery.updated.v1", {
                  jobId,
                  orderId: job.orderId,
                  leg: job.leg,
                  status: "COMPLETED",
                  ...(parsed.proofReference ? { proofReference: parsed.proofReference } : {}),
                });
                if (job.leg === "RETURN") {
                  await ctx.db.patch(order._id, { status: "DELIVERED", version: order.version + 1 });
                  await ctx.db.insert("orderTimeline", {
                    orderId: job.orderId,
                    status: "DELIVERED",
                    label: "Return handover complete",
                    at: nowIso(),
                  });
                  await emitOutbox(ctx, job.orderId, "order.delivered.v1", {
                    orderId: job.orderId,
                    deliveredAt: nowIso(),
                  });
                }
                const updated = await ctx.db.query("deliveryJobs").withIndex("by_lid", (q) => q.eq("lid", jobId)).first();
                return toJobView(updated as unknown as Record<string, unknown>);
              }
            );
            return ok(200, result);
          }
          if (action === "exception" && method === "POST") {
            if (me.role !== "rider") throw new EngineError("FORBIDDEN", "Riders only", { status: 403 });
            const o = body as Record<string, unknown>;
            if (typeof o.reason !== "string" || o.reason.length < 1) {
              throw new EngineError("INVALID_INPUT", "reason is required", { status: 400 });
            }
            const job = await ctx.db.query("deliveryJobs").withIndex("by_lid", (q) => q.eq("lid", jobId)).first();
            if (!job || job.assignedTo !== me.id) {
              throw new EngineError("NOT_FOUND", "Delivery job not found", { status: 404 });
            }
            await ctx.db.patch(job._id, { status: "FAILED", version: job.version + 1 });
            await emitOutbox(ctx, job.orderId, "delivery.updated.v1", {
              jobId,
              orderId: job.orderId,
              leg: job.leg,
              status: "FAILED",
              reason: o.reason,
            });
            const updated = await ctx.db.query("deliveryJobs").withIndex("by_lid", (q) => q.eq("lid", jobId)).first();
            return ok(200, toJobView(updated as unknown as Record<string, unknown>));
          }
        }
      }
      if (method === "POST" && rawPath === "/v1/demo/media/handover-proof") {
        requireDemo();
        if (me.role !== "rider" && me.role !== "operator") {
          throw new EngineError("FORBIDDEN", "Riders only", { status: 403 });
        }
        return ok(200, {
          proofReference: `proof_${Date.now()}`,
          note: "demo media reference; photos alone never complete a handover",
        });
      }

      // ----- ops -----
      if (method === "GET" && rawPath === "/v1/ops/orders") {
        // Facility fail-closed: no memberships provisioned, so only
        // operator/admin reach the ops queue.
        if (!["operator", "admin"].includes(me.role)) {
          throw new EngineError("FORBIDDEN", "Ops only", { status: 403 });
        }
        const rows = await ctx.db.query("orders").collect();
        rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        const out: Record<string, unknown>[] = [];
        for (const o of rows.slice(0, 50)) out.push(await toOrderView(ctx, o as unknown as Record<string, unknown>));
        return ok(200, out);
      }
      {
        const m = rawPath.match(/^\/v1\/ops\/orders\/([^/]+)\/intake$/);
        if (m && method === "POST") {
          if (me.role !== "operator" && me.role !== "admin") {
            throw new EngineError("FORBIDDEN", "Ops only", { status: 403 });
          }
          const orderId = assertUuid(decodeURIComponent(m[1]), "orderId");
          const o = body as Record<string, unknown>;
          if (typeof o.expectedVersion !== "number" || o.expectedVersion < 1) {
            throw new EngineError("INVALID_INPUT", "expectedVersion must be >= 1", { status: 400 });
          }
          const measured = o.measuredLines;
          if (!Array.isArray(measured) || measured.length < 1) {
            throw new EngineError("INVALID_INPUT", "measuredLines must be non-empty", { status: 400 });
          }
          const bagIds = Array.isArray(o.bagIds) ? (o.bagIds as string[]) : [];
          const order = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", orderId)).first();
          if (!order) throw new EngineError("NOT_FOUND", "Order not found", { status: 404 });
          if (order.version !== o.expectedVersion) {
            throw new EngineError("VERSION_CONFLICT", `Expected version ${o.expectedVersion} but current is ${order.version}`, {
              status: 409,
            });
          }
          if (!["PICKUP_PENDING", "AT_FACILITY", "AWAITING_ADJUSTMENT"].includes(order.status)) {
            throw new EngineError("INVALID_INPUT", `Intake not allowed in ${order.status}`, { status: 400 });
          }
          const orderLines = order.lines as { orderLineId: string; quantity: number; unitPriceMinor: number }[];
          let delta = 0;
          for (const ml of measured as { orderLineId: string; quantity: number }[]) {
            const line = orderLines.find((l) => l.orderLineId === ml.orderLineId);
            if (!line) throw new EngineError("INVALID_INPUT", `Unknown order line ${ml.orderLineId}`, { status: 400 });
            if (typeof ml.quantity !== "number" || ml.quantity < 0 || ml.quantity > 100) {
              throw new EngineError("INVALID_INPUT", "Measured quantity 0..100", { status: 400 });
            }
            delta += (ml.quantity - line.quantity) * line.unitPriceMinor;
          }
          if (delta === 0) {
            await ctx.db.patch(order._id, { status: "AT_FACILITY", version: order.version + 1 });
            await ctx.db.insert("orderTimeline", {
              orderId,
              status: "AT_FACILITY",
              label: "Facility intake complete: counts match",
              at: nowIso(),
            });
            await emitOutbox(ctx, orderId, "order.updated.v1", { orderId, customerVisibleStatus: "AT_FACILITY" });
          } else {
            const adjustmentId = uuid();
            await ctx.db.patch(order._id, {
              status: "AWAITING_ADJUSTMENT",
              version: order.version + 1,
              adjustment: {
                id: adjustmentId,
                status: "PENDING",
                deltaMinor: delta,
                reason: `Intake count differs by value ${delta}`,
                measuredLines: measured,
                bagIds,
              },
            });
            await ctx.db.insert("orderTimeline", {
              orderId,
              status: "AWAITING_ADJUSTMENT",
              label: "Intake found a price difference; waiting for approval",
              at: nowIso(),
            });
            await emitOutbox(ctx, orderId, "order.updated.v1", { orderId, customerVisibleStatus: "AWAITING_ADJUSTMENT" });
          }
          const view = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", orderId)).first();
          return ok(200, await toOrderView(ctx, view as unknown as Record<string, unknown>));
        }
      }
      {
        const m = rawPath.match(/^\/v1\/ops\/orders\/([^/]+)\/care$/);
        if (m && method === "POST") {
          if (me.role !== "operator" && me.role !== "admin") {
            throw new EngineError("FORBIDDEN", "Ops only", { status: 403 });
          }
          const orderId = decodeURIComponent(m[1]);
          const o = body as Record<string, unknown>;
          if (typeof o.expectedVersion !== "number" || o.expectedVersion < 1) {
            throw new EngineError("INVALID_INPUT", "expectedVersion must be >= 1", { status: 400 });
          }
          if (o.to !== "IN_CARE" && o.to !== "QUALITY_CHECK" && o.to !== "READY_FOR_RETURN") {
            throw new EngineError("INVALID_INPUT", "Unknown care target", { status: 400 });
          }
          const order = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", orderId)).first();
          if (!order) throw new EngineError("NOT_FOUND", "Order not found", { status: 404 });
          if (order.version !== o.expectedVersion) {
            throw new EngineError("VERSION_CONFLICT", `Expected version ${o.expectedVersion} but current is ${order.version}`, {
              status: 409,
            });
          }
          if (order.status === "AWAITING_ADJUSTMENT") {
            throw new EngineError("REQUIRES_APPROVAL", "Resolve the pending adjustment first", { status: 409 });
          }
          const adj = order.adjustment as { status?: string } | undefined;
          if (adj?.status === "AWAITING_TOPUP") {
            const pays = await ctx.db.query("payments").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect();
            const paid = pays.filter((p) => p.purpose === "TOP_UP" && p.status === "CAPTURED").length;
            if (paid === 0) throw new EngineError("REQUIRES_APPROVAL", "Top-up must be captured before care", { status: 409 });
          }
          const flow = ["AT_FACILITY", "IN_CARE", "QUALITY_CHECK", "READY_FOR_RETURN"];
          if (flow.indexOf(o.to as string) !== flow.indexOf(order.status) + 1) {
            throw new EngineError("INVALID_INPUT", `Cannot move ${order.status} to ${o.to}`, { status: 400 });
          }
          await ctx.db.patch(order._id, { status: o.to as string, version: order.version + 1 });
          await ctx.db.insert("orderTimeline", { orderId, status: o.to as string, label: `Care: ${o.to}`, at: nowIso() });
          if (o.to === "READY_FOR_RETURN") {
            await emitOutbox(ctx, orderId, "order.ready-for-return.v1", { orderId });
          }
          await emitOutbox(ctx, orderId, "order.updated.v1", { orderId, customerVisibleStatus: o.to });
          const view = await ctx.db.query("orders").withIndex("by_lid", (q) => q.eq("lid", orderId)).first();
          return ok(200, await toOrderView(ctx, view as unknown as Record<string, unknown>));
        }
      }
      if (method === "GET" && rawPath === "/v1/ops/capacity") {
        if (!["operator", "admin"].includes(me.role)) {
          throw new EngineError("FORBIDDEN", "Ops only", { status: 403 });
        }
        const rows = await ctx.db.query("capacityBuckets").collect();
        return ok(200, rows.slice(0, 50));
      }
      if (method === "PUT" && rawPath === "/v1/ops/capacity") {
        if (!["operator", "admin"].includes(me.role)) {
          throw new EngineError("FORBIDDEN", "Ops only", { status: 403 });
        }
        const o = body as Record<string, unknown>;
        if (typeof o.bucketKey !== "string" || o.bucketKey.length < 1) {
          throw new EngineError("INVALID_INPUT", "bucketKey is required", { status: 400 });
        }
        const window = parseWindow({ start: o.windowStart, end: o.windowEnd, timezone: "UTC" });
        if (typeof o.capacityTotal !== "number" || !Number.isInteger(o.capacityTotal) || o.capacityTotal < 1 || o.capacityTotal > 100) {
          throw new EngineError("INVALID_INPUT", "capacityTotal must be 1..100", { status: 400 });
        }
        const existing = await ctx.db
          .query("capacityBuckets")
          .withIndex("by_key", (q) => q.eq("key", o.bucketKey as string))
          .first();
        if (existing) {
          await ctx.db.patch(existing._id, { capacityTotal: o.capacityTotal });
          const row = await ctx.db.query("capacityBuckets").withIndex("by_key", (q) => q.eq("key", o.bucketKey as string)).first();
          return ok(200, row);
        }
        await ctx.db.insert("capacityBuckets", {
          key: o.bucketKey as string,
          windowStart: window.start,
          windowEnd: window.end,
          capacityTotal: o.capacityTotal,
        });
        const row = await ctx.db.query("capacityBuckets").withIndex("by_key", (q) => q.eq("key", o.bucketKey as string)).first();
        return ok(200, row);
      }
      {
        const m = rawPath.match(/^\/v1\/ops\/support\/([^/]+)$/);
        if (m && method === "PATCH") {
          if (!["operator", "admin"].includes(me.role)) {
            throw new EngineError("FORBIDDEN", "Ops only", { status: 403 });
          }
          const id = decodeURIComponent(m[1]);
          const o = body as Record<string, unknown>;
          const row = await ctx.db.query("supportIncidents").withIndex("by_lid", (q) => q.eq("lid", id)).first();
          if (!row) throw new EngineError("NOT_FOUND", "Support incident not found", { status: 404 });
          if (typeof o.status === "string") {
            await ctx.db.patch(row._id, { status: o.status });
            return ok(200, { id, status: o.status });
          }
          if (typeof o.message !== "string" || o.message.length < 1) {
            throw new EngineError("INVALID_INPUT", "message is required", { status: 400 });
          }
          const messages = [...(row.messages as unknown[]), { id: uuid(), from: me.role, text: o.message, at: nowIso() }];
          await ctx.db.patch(row._id, { messages });
          return ok(200, { id, status: row.status, messages });
        }
      }
      if (method === "GET" && rawPath === "/v1/ops/deliveries") {
        requireRole(me, ["operator", "admin"]);
        const rows = await ctx.db.query("deliveryJobs").collect();
        return ok(200, rows.slice(0, 100).map((j) => toJobView(j as unknown as Record<string, unknown>)));
      }
      {
        const m = rawPath.match(/^\/v1\/ops\/deliveries\/([^/]+)\/(dispatch|cancel)$/);
        if (m && method === "POST") {
          requireRole(me, ["operator", "admin"]);
          const jobId = decodeURIComponent(m[1]);
          if (m[2] === "dispatch") {
            const o = body as Record<string, unknown>;
            const assignedTo = assertUuid(o.assignedTo, "assignedTo");
            if (!Number.isInteger(o.expectedVersion) || (o.expectedVersion as number) < 1) {
              throw new EngineError("INVALID_INPUT", "expectedVersion must be a positive integer", { status: 400 });
            }
            const result = await idem("POST /v1/ops/deliveries/dispatch", me,
              { jobId, assignedTo, expectedVersion: o.expectedVersion }, async () => {
                const job = await ctx.db.query("deliveryJobs").withIndex("by_lid", (q) => q.eq("lid", jobId)).first();
                if (!job) throw new EngineError("NOT_FOUND", "Delivery job not found", { status: 404 });
                if (job.version !== o.expectedVersion) throw new EngineError("VERSION_CONFLICT", "Stale job version", { status: 409 });
                if (job.dispatchMode !== "MANUAL") throw new EngineError("PROVIDER_UNAVAILABLE", "External dispatch is not implemented", { status: 501 });
                if (!["REQUESTED", "BOOKED", "ASSIGNED"].includes(job.status)) {
                  throw new EngineError("INVALID_INPUT", "This job cannot be assigned", { status: 400 });
                }
                const rider = await ctx.db.query("identities").withIndex("by_lid", (q) => q.eq("lid", assignedTo)).first();
                if (!rider || rider.role !== "rider") throw new EngineError("INVALID_INPUT", "Assignee must be a provisioned rider", { status: 400 });
                await ctx.db.patch(job._id, { assignedTo, status: "ASSIGNED", version: job.version + 1 });
                await emitOutbox(ctx, job.orderId, "delivery.updated.v1", {
                  jobId, orderId: job.orderId, leg: job.leg, status: "ASSIGNED", actorId: me.id,
                  previousAssignedTo: job.assignedTo ?? null, assignedTo,
                });
                const updated = await ctx.db.query("deliveryJobs").withIndex("by_lid", (q) => q.eq("lid", jobId)).first();
                return toJobView(updated as unknown as Record<string, unknown>);
              });
            return ok(200, result);
          }
          const job = await ctx.db.query("deliveryJobs").withIndex("by_lid", (q) => q.eq("lid", jobId)).first();
          if (!job) throw new EngineError("NOT_FOUND", "Delivery job not found", { status: 404 });
          await ctx.db.patch(job._id, { status: "CANCELLED", version: job.version + 1 });
          const updated = await ctx.db.query("deliveryJobs").withIndex("by_lid", (q) => q.eq("lid", jobId)).first();
          return ok(200, toJobView(updated as unknown as Record<string, unknown>));
        }
      }

      // ----- conversations -----
      if (method === "POST" && rawPath === "/v1/demo/conversations/messages") {
        requireProviderInDemo("Demo conversation drafts");
        if (me.role !== "customer") throw new EngineError("FORBIDDEN", "Only customers draft orders", { status: 403 });
        const o = body as Record<string, unknown>;
        if (typeof o.text !== "string" || o.text.length < 1 || o.text.length > 4000) {
          throw new EngineError("INVALID_INPUT", "Text must be 1..4000 chars", { status: 400 });
        }
        const receivedAt = o.receivedAt !== undefined ? new Date(o.receivedAt as string) : new Date();
        if (Number.isNaN(receivedAt.getTime())) throw new EngineError("INVALID_INPUT", "receivedAt is invalid", { status: 400 });
        const conversationKey = `customer:${me.id}`;
        let draft = o.draftId
          ? await ctx.db.query("conversationDrafts").withIndex("by_lid", (q) => q.eq("lid", o.draftId as string)).first()
          : (
              await ctx.db.query("conversationDrafts").withIndex("by_key", (q) => q.eq("conversationKey", conversationKey)).collect()
            )
              .filter((d) => (d.state === "COLLECTING" || d.state === "QUOTED") && Date.parse(d.expiresAt) > Date.now())
              .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
        if (o.draftId && !draft) throw new EngineError("NOT_FOUND", "Draft not found", { status: 404 });
        if (draft && o.draftId && draft.customerId !== me.id) {
          throw new EngineError("NOT_FOUND", "Draft not found", { status: 404 });
        }
        if (!draft) {
          const lid = uuid();
          await ctx.db.insert("conversationDrafts", {
            lid,
            revision: 1,
            customerId: me.id,
            conversationKey,
            fields: {},
            state: "COLLECTING",
            expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
            updatedAt: nowIso(),
          });
          draft = await ctx.db.query("conversationDrafts").withIndex("by_lid", (q) => q.eq("lid", lid)).first();
        }
        if (Date.parse(draft!.expiresAt) < Date.now()) {
          await ctx.db.patch(draft!._id, { state: "EXPIRED" });
          throw new EngineError("INVALID_INPUT", "Draft expired; start over", { status: 400 });
        }
        const fields = { ...((draft!.fields ?? {}) as DraftFields) };
        const text = o.text as string;
        const svc = parseService(text);
        if (svc) {
          fields.serviceId = svc.serviceId;
          fields.garmentTypeId = svc.garmentTypeId;
        }
        const count = parseCount(text);
        if (count) fields.quantity = count;
        const window = parseTime(text, receivedAt);
        if (window) {
          fields.pickupStart = window.start.toISOString();
          fields.pickupEnd = window.end.toISOString();
        }
        const returnParsed = parseReturnDeadline(text, receivedAt);
        let returnAmbiguous = false;
        if (returnParsed && "at" in returnParsed) {
          fields.requestedReturnBy = (returnParsed.at as Date).toISOString();
          delete fields.returnNeedsClarification;
        } else if (returnParsed && "ambiguous" in returnParsed) {
          returnAmbiguous = true;
          fields.returnNeedsClarification = true;
        }
        if (!fields.addressId) {
          const addr = (
            await ctx.db.query("addresses").withIndex("by_owner", (q) => q.eq("ownerId", me.id)).collect()
          ).find((a) => !a.deleted);
          if (addr) fields.addressId = addr.lid;
        }
        const missing: string[] = [];
        if (!fields.serviceId) missing.push("service");
        if (!fields.quantity) missing.push("garment count");
        if (!fields.pickupStart) missing.push("pickup time");
        if (returnAmbiguous) missing.push("return deadline (exact date and time)");
        if (!fields.addressId) missing.push("addressId");

        if (/^\s*confirms?\b/i.test(text) && draft!.state === "QUOTED" && draft!.quoteId) {
          await ctx.db.patch(draft!._id, { fields, updatedAt: nowIso() });
          const summary = exactSummary(fields);
          const shape = {
            draft: {
              draftId: draft!.lid,
              revision: draft!.revision,
              state: draft!.state,
              quoteId: draft!.quoteId,
              expiresAt: draft!.expiresAt,
              missingFields: missing,
            },
            reply: `${summary} Reply CONFIRM only via the app confirmation for this exact draft revision; nothing is booked yet.`,
            missingFields: missing,
          };
          return ok(200, shape);
        }

        let state = missing.length === 0 ? "QUOTED" : "COLLECTING";
        let quote: Record<string, unknown> | null = null;
        if (missing.length === 0) {
          try {
            const requestedReturnBy =
              fields.requestedReturnBy ??
              new Date(new Date(fields.pickupStart as string).getTime() + 5 * 86400_000).toISOString();
            quote = (await buildQuote(ctx, me, {
              addressId: fields.addressId as string,
              lines: [
                {
                  serviceId: fields.serviceId as string,
                  garmentTypeId: fields.garmentTypeId as string,
                  quantity: fields.quantity as number,
                },
              ],
              pickupWindow: {
                start: fields.pickupStart as string,
                end: fields.pickupEnd as string,
                timezone: "Asia/Kolkata",
              },
              requestedReturnBy,
              timezone: "Asia/Kolkata",
            })) as unknown as Record<string, unknown>;
            await ctx.db.patch(draft!._id, { quoteId: quote.id as string });
          } catch (e) {
            state = "COLLECTING";
            if (e instanceof EngineError && (e.code === "DEADLINE_UNAVAILABLE" || e.code === "NO_CAPACITY")) throw e;
          }
        }
        await ctx.db.patch(draft!._id, { fields, revision: draft!.revision + 1, state, updatedAt: nowIso() });
        await ctx.db.insert("conversationMessages", {
          lid: uuid(),
          draftId: draft!.lid,
          sender: "customer",
          text: text.slice(0, 1000),
          createdAt: nowIso(),
        });
        const refreshed = await ctx.db.query("conversationDrafts").withIndex("by_lid", (q) => q.eq("lid", draft!.lid)).first();
        const reply =
          missing.length === 0
            ? `${exactSummary(fields)} Confirm this exact draft to pay; nothing is booked yet.`
            : `Got it. I still need: ${missing.join(", ")}. A voice note alone never books an order.`;
        return ok(200, {
          draft: {
            draftId: refreshed!.lid,
            revision: refreshed!.revision,
            state: refreshed!.state,
            ...(refreshed!.quoteId ? { quoteId: refreshed!.quoteId } : quote ? { quoteId: quote.id } : {}),
            expiresAt: refreshed!.expiresAt,
            missingFields: missing,
          },
          reply,
          missingFields: missing,
          ...(quote ? { quote } : {}),
        });
      }
      {
        const m = rawPath.match(/^\/v1\/conversation-drafts\/([^/]+)\/confirm$/);
        if (m && method === "POST") {
          if (me.role !== "customer") throw new EngineError("FORBIDDEN", "Only customers", { status: 403 });
          const draftId = assertUuid(decodeURIComponent(m[1]), "draftId");
          const o = body as Record<string, unknown>;
          if (o.draftId !== undefined && o.draftId !== draftId) {
            throw new EngineError("INVALID_INPUT", "draftId mismatch", { status: 400 });
          }
          const revision = o.revision;
          const quoteId = assertUuid(o.quoteId, "quoteId");
          if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) {
            throw new EngineError("INVALID_INPUT", "revision must be >= 1", { status: 400 });
          }
          const payload = { draftId, revision, quoteId };
          const result = await idem("POST /v1/conversation-drafts/confirm", me, payload, async () => {
            const draft = await ctx.db.query("conversationDrafts").withIndex("by_lid", (q) => q.eq("lid", draftId)).first();
            if (!draft) throw new EngineError("NOT_FOUND", "Draft not found", { status: 404 });
            if (draft.customerId && draft.customerId !== me.id) {
              throw new EngineError("NOT_FOUND", "Draft not found", { status: 404 });
            }
            if (!draft.customerId) {
              throw new EngineError("FORBIDDEN", "Link this chat to your account before confirming", { status: 403 });
            }
            if (draft.revision !== revision) {
              throw new EngineError("VERSION_CONFLICT", `Draft revision ${revision} is stale; current is ${draft.revision}`, {
                status: 409,
              });
            }
            if (draft.quoteId && draft.quoteId !== quoteId) {
              throw new EngineError("VERSION_CONFLICT", "Quote does not match this draft revision", { status: 409 });
            }
            if (Date.parse(draft.expiresAt) < Date.now()) throw new EngineError("INVALID_INPUT", "Draft expired", { status: 400 });
            const checkout = await buildCheckout(ctx, me, quoteId, undefined);
            await ctx.db.patch(draft._id, { state: "CHECKOUT_CREATED", updatedAt: nowIso() });
            return checkout;
          });
          return ok(200, result);
        }
      }
      if (method === "GET" && rawPath === "/v1/ops/conversations") {
        requireRole(me, ["operator", "admin"]);
        const rows = await ctx.db.query("conversationDrafts").collect();
        rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
        return ok(200, rows.slice(0, 50));
      }
      {
        const m = rawPath.match(/^\/v1\/ops\/conversations\/([^/]+)\/handoff$/);
        if (m && method === "POST") {
          requireRole(me, ["operator", "admin"]);
          const id = decodeURIComponent(m[1]);
          const draft = await ctx.db.query("conversationDrafts").withIndex("by_lid", (q) => q.eq("lid", id)).first();
          if (!draft) throw new EngineError("NOT_FOUND", "Draft not found", { status: 404 });
          await ctx.db.patch(draft._id, { state: "HUMAN_HANDOFF", updatedAt: nowIso() });
          return ok(200, { id, state: "HUMAN_HANDOFF" });
        }
      }

      // ----- honest 501 boundaries: no live providers or network in mutations -----
      if (
        rawPath.startsWith("/v1/webhooks/") ||
        rawPath === "/v1/demo/conversations/voice-notes" ||
        rawPath.startsWith("/v1/media/")
      ) {
        throw new EngineError(
          "PROVIDER_UNAVAILABLE",
          "This lane needs the HTTP transport plus provider credentials; the Convex engine stores state only.",
          { status: 501 }
        );
      }

      throw new EngineError("NOT_FOUND", `No route ${method} ${rawPath}`, { status: 404 });
    } catch (e) {
      if (e instanceof EngineError) return { status: e.status, body: e.envelope() };
      // Never leak internal messages to the wire. The traceId lets an
      // operator correlate the private server log with the client envelope.
      // Atomicity note: this handler converts errors to status bodies
      // instead of rethrowing, so any writes before the throw would commit.
      // All routes above prevalidate before their first write; the only
      // intentional write-then-error paths are the OTP wrong-code attempt
      // counter (must persist) and the adjustment TOP_UP creation (guarded
      // against duplicates, documented above).
      const traceId = uuid();
      console.error(`[engine] ${args.method.toUpperCase()} ${args.path.split("?")[0]} trace=${traceId}`, e);
      return {
        status: 500,
        body: {
          code: "PROVIDER_OUTCOME_UNKNOWN",
          message: "Internal engine failure",
          traceId,
          retryable: true,
        },
      };
    }
  },
});

// Demo-gated seed. Synthetic demo users, address, catalog, and rate card only.
export const seedDemo = internalMutation({
  args: {},
  handler: async (ctx) => {
    requireDemo();
    const phones: Record<string, { lid: string; role: string; name: string }> = {
      "+91-90000-00001": { lid: DEMO_IDS.customerId, role: "customer", name: "Demo Customer" },
      "+91-90000-00002": { lid: DEMO_IDS.riderId, role: "rider", name: "Demo Rider" },
      "+91-90000-00003": { lid: DEMO_IDS.operatorId, role: "operator", name: "Demo Operator" },
    };
    for (const [phone, u] of Object.entries(phones)) {
      const existing = await ctx.db.query("identities").withIndex("by_lid", (q) => q.eq("lid", u.lid)).first();
      if (existing) {
        await ctx.db.patch(existing._id, { phone, role: u.role, name: u.name });
      } else {
        await ctx.db.insert("identities", { lid: u.lid, role: u.role, name: u.name, phone });
      }
    }
    const addr = await ctx.db.query("addresses").withIndex("by_lid", (q) => q.eq("lid", DEMO_IDS.addressId)).first();
    if (!addr) {
      await ctx.db.insert("addresses", {
        lid: DEMO_IDS.addressId,
        ownerId: DEMO_IDS.customerId,
        label: "Home (demo)",
        line1: "14 Demo Lane",
        city: "Bengaluru",
        postalCode: "560001",
        version: 1,
        deleted: false,
      });
    }
    for (const s of DEMO_SERVICES) {
      const existing = await ctx.db.query("services").withIndex("by_lid", (q) => q.eq("lid", s.lid)).first();
      const doc = {
        lid: s.lid,
        code: s.code,
        name: s.name,
        description: s.description,
        imageUrl: demoImageUrl(s.imageFile),
        priceMinor: s.priceMinor,
        priceUnit: s.priceUnit,
        turnaroundHours: s.turnaroundHours,
        garments: s.garments.map((g) => ({ lid: g.lid, name: g.name, priceMinor: g.priceMinor })),
        features: s.features,
        active: true,
      };
      if (existing) await ctx.db.patch(existing._id, doc);
      else await ctx.db.insert("services", doc);
    }
    const cards = await ctx.db.query("rateCards").collect();
    if (cards.length === 0) {
      await ctx.db.insert("rateCards", { lid: DEMO_IDS.rateCardId, version: 1, currency: "INR" });
    }
    return { ok: true, seeded: ["users", "address", "services", "rateCard"] };
  },
});
