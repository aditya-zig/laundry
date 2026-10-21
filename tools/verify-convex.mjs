#!/usr/bin/env node
// Independent Convex API verification for Laundry.
// Real HTTP against deployed Convex endpoints only. Synthetic demo data only.
// Validates wire responses with the real Zod contracts from
// packages/contracts (dist) and exercises custody + idempotency flows.
// Never prints tokens or secrets. Exit 0 = all required checks pass,
// exit 1 = any failure or blocked required check. JSON report is written
// to docs/implementation/evidence/convex-api/ (counts only, no secrets).
//
// Usage:
//   node tools/verify-convex.mjs [--demo URL] [--prod URL]
//     [--skip-demo] [--skip-prod] [--wait-secs N] [--evidence DIR]
//
// Defaults:
//   --demo https://hidden-trout-436.ap-southeast-2.convex.site/v1
//   --prod  https://dutiful-kangaroo-719.ap-southeast-2.convex.site/v1

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const DEFAULT_DEMO = "https://hidden-trout-436.ap-southeast-2.convex.site/v1";
const DEFAULT_PROD = "https://dutiful-kangaroo-719.ap-southeast-2.convex.site/v1";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : ["_", a];
  })
);
const DEMO_BASE = String(args.demo ?? DEFAULT_DEMO).replace(/\/$/, "");
const PROD_BASE = String(args.prod ?? DEFAULT_PROD).replace(/\/$/, "");
const SKIP_DEMO = Boolean(args["skip-demo"]);
const SKIP_PROD = Boolean(args["skip-prod"]);
const WAIT_SECS = Number(args["wait-secs"] ?? 60);
const EVIDENCE_DIR = resolve(ROOT, String(args.evidence ?? "docs/implementation/evidence/convex-api"));

// Real contract schemas. Import from the built workspace package so the
// verifier checks the same Zod shapes the apps use.
let contracts;
try {
  contracts = await import(join(ROOT, "packages/contracts/dist/index.js"));
} catch {
  contracts = await import("@laundry/contracts");
}
const {
  serviceSchema,
  quoteSchema,
  checkoutSchema,
  orderSchema,
  deliveryJobSchema,
  sessionSchema,
  reviewSchema,
  errorEnvelopeSchema,
} = contracts;

const results = [];
function record(target, id, name, status, detail, extra = {}) {
  results.push({ target, id, name, status, detail, ...extra });
  const tag = status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "BLOCKED";
  console.log(`[${tag}] [${target}] ${id}: ${name}${detail ? ` -- ${detail}` : ""}`);
}
const pass = (t, id, n, d, x) => record(t, id, n, "pass", d, x);
const fail = (t, id, n, d, x) => record(t, id, n, "fail", d, x);
const blocked = (t, id, n, d, x) => record(t, id, n, "blocked", d, x);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uuid = () => crypto.randomUUID();

async function call(base, method, path, { token, body, key } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (key) headers["Idempotency-Key"] = key;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function envelopeCode(r) {
  const p = errorEnvelopeSchema.safeParse(r.json);
  return p.success ? p.data.code : null;
}

function checkSchema(target, id, name, parsed, r) {
  if (!parsed.success) {
    fail(target, id, name, `schema mismatch: ${parsed.error.issues.slice(0, 2).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, { http: r.status });
    return null;
  }
  return parsed.data;
}

// Poll /health until the transport reports, or the budget runs out.
async function waitForHealth(siteBase, budgetSecs) {
  const deadline = Date.now() + budgetSecs * 1000;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const r = await call(siteBase, "GET", "/health");
      last = r;
      if (r.status === 200 && r.json && typeof r.json === "object") return { ready: true, body: r.json };
    } catch (e) {
      last = { error: String(e) };
    }
    await sleep(5000);
  }
  return { ready: false, last };
}

async function demoAuth(base, role) {
  return call(base, "POST", "/auth/demo", { body: { role }, key: uuid() });
}

// ---------------------------------------------------------------- prod ---
async function verifyProd() {
  const T = "prod";
  const health = await call(PROD_BASE, "GET", "/health");
  if (health.status !== 200) {
    fail(T, "prod-health", "production health reachable", `HTTP ${health.status}`);
    return;
  }
  const demoMode = health.json?.demoMode;
  const liveReady = health.json?.liveReady;
  if (demoMode === false) pass(T, "prod-health", "production health reachable", `demoMode false, liveReady ${liveReady}`);
  else fail(T, "prod-health", "production health reachable", `demoMode is ${demoMode}, expected false`);

  // Demo auth must be rejected in real mode.
  const demo = await call(PROD_BASE, "POST", "/auth/demo", { body: { role: "customer" }, key: uuid() });
  if (demo.status === 403 && envelopeCode(demo) === "FORBIDDEN") pass(T, "prod-demo-reject", "demo auth rejected in real mode", "403 FORBIDDEN");
  else fail(T, "prod-demo-reject", "demo auth rejected in real mode", `HTTP ${demo.status} code ${envelopeCode(demo)}`);

  // OTP request must not mint unsent challenges in live mode. The repo
  // engine gates this lane behind DEMO_MODE (501 otherwise) because no SMS
  // provider is wired. A 200 without an SMS send is an unsent lane.
  const otp = await call(PROD_BASE, "POST", "/auth/otp/request", { body: { phone: "+919000000001" }, key: uuid() });
  if (otp.status === 501 && envelopeCode(otp) === "PROVIDER_UNAVAILABLE") {
    pass(T, "prod-otp-reject", "unsent OTP lane rejected in real mode", "501 PROVIDER_UNAVAILABLE");
  } else {
    fail(T, "prod-otp-reject", "unsent OTP lane rejected in real mode",
      `HTTP ${otp.status} code ${envelopeCode(otp)}; challenge minted without SMS provider, BUG`);
  }

  // Provider lanes must refuse honestly, never fake success.
  const lanes = [
    ["prod-webhook-reject", "POST", "/webhooks/payments/razorpay", {}],
    ["prod-media-reject", "GET", "/media/00000000-0000-4000-8000-000000000000/download", undefined],
    ["prod-voice-reject", "POST", "/demo/conversations/voice-notes", {}],
  ];
  for (const [id, method, path, body] of lanes) {
    const r = await call(PROD_BASE, method, path, body === undefined ? {} : { body, key: uuid() });
    if (r.status === 501 && envelopeCode(r) === "PROVIDER_UNAVAILABLE") pass(T, id, `${method} ${path} refused honestly`, "501 PROVIDER_UNAVAILABLE");
    else fail(T, id, `${method} ${path} refused honestly`, `HTTP ${r.status} code ${envelopeCode(r)}`);
  }

  // WhatsApp handshake without a configured verify token must not succeed.
  const hs = await call(PROD_BASE, "GET", "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=123");
  if ((hs.status === 502 || hs.status === 403) && hs.status !== 200) pass(T, "prod-whatsapp-handshake", "unconfigured WhatsApp handshake refused", `HTTP ${hs.status}`);
  else fail(T, "prod-whatsapp-handshake", "unconfigured WhatsApp handshake refused", `HTTP ${hs.status}`);

  // Auth boundary: unauthenticated mutating call is 401, never a 500 leak.
  const una = await call(PROD_BASE, "POST", "/quotes", { body: {}, key: uuid() });
  if (una.status === 401 && envelopeCode(una) === "UNAUTHENTICATED") pass(T, "prod-auth-boundary", "unauthenticated write rejected", "401 UNAUTHENTICATED");
  else fail(T, "prod-auth-boundary", "unauthenticated write rejected", `HTTP ${una.status} code ${envelopeCode(una)}`);

  // Public catalog stays readable in live mode and matches the contract.
  const svc = await call(PROD_BASE, "GET", "/services");
  const parsed = checkSchema(T, "prod-catalog", "public catalog matches service contract",
    (await import("zod")).z.array(serviceSchema).safeParse(svc.json), svc);
  if (parsed) pass(T, "prod-catalog", "public catalog matches service contract", `${parsed.length} services`);
}

// ---------------------------------------------------------------- demo ---
function slotHoursFromNow(hoursAhead, startHourKolkata = 10) {
  // Pickup window one hour wide on a future day; distinct hoursAhead values
  // land in distinct UTC hour buckets so capacity holds do not collide
  // (fresh buckets hold 2 concurrent holds each).
  const now = Date.now() + hoursAhead * 3600_000;
  const d = new Date(now);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const start = new Date(day.getTime() + (startHourKolkata - 5.5) * 3600_000 + (hoursAhead % 5) * 3600_000);
  const startMs = start.getTime() < Date.now() + 3600_000 ? start.getTime() + 86400_000 : start.getTime();
  return { start: new Date(startMs).toISOString(), end: new Date(startMs + 3600_000).toISOString() };
}

async function verifyDemo() {
  const T = "demo";
  const siteBase = DEMO_BASE.replace(/\/v1$/, "");
  const h = await waitForHealth(siteBase, WAIT_SECS);
  if (!h.ready) {
    const detail = `cloud demo not ready after ${WAIT_SECS}s (HTTP actions not enabled or undeployed). HTTP lane being implemented; rerun once /health is ready.`;
    blocked(T, "demo-health", "cloud demo health reachable", detail);
    for (const [id, name] of [
      ["demo-catalog", "catalog matches contracts"], ["demo-login", "demo login roles"],
      ["demo-quote", "quotes deadlines and capacity"], ["demo-checkout-idem", "checkout idempotency"],
      ["demo-capture", "capture duplicate"], ["demo-ownership", "role and ownership"],
      ["demo-custody", "pickup vs return custody"], ["demo-otp", "OTP custody proof"],
      ["demo-ops", "ops intake and care"], ["demo-review", "delivered review duplicate"],
      ["demo-version", "stale version rejection"], ["demo-draft", "conversation draft and confirm"],
      ["demo-whatsapp-refuse", "unlinked WhatsApp refusal"],
    ]) blocked(T, id, name, "skipped: demo cloud unreachable");
    return;
  }
  if (h.body.demoMode === true) pass(T, "demo-health", "cloud demo health reachable", "demoMode true");
  else fail(T, "demo-health", "cloud demo health reachable", `demoMode is ${h.body.demoMode}, expected true for synthetic demo`);

  // Login roles: synthetic demo users only.
  const roles = {};
  for (const role of ["customer", "rider", "operator"]) {
    const r = await demoAuth(DEMO_BASE, role);
    const s = checkSchema(T, "demo-login", `demo login as ${role}`, sessionSchema.safeParse(r.json), r);
    if (!s || r.status !== 200) { fail(T, "demo-login", "demo login roles", `${role}: HTTP ${r.status} code ${envelopeCode(r)} (seedDemo may be missing)`); return; }
    roles[role] = s;
  }
  pass(T, "demo-login", "demo login roles", "customer, rider, operator sessions issued; token values withheld");
  const bad = await call(DEMO_BASE, "POST", "/auth/demo", { body: { role: "admin" }, key: uuid() });
  if (bad.status === 400) pass(T, "demo-login", "demo login roles", "unknown role rejected 400");
  else fail(T, "demo-login", "demo login roles", `unknown role: HTTP ${bad.status}`);
  const me = await call(DEMO_BASE, "GET", "/me", { token: roles.customer.token });
  if (me.status === 200 && me.json?.role === "customer") pass(T, "demo-login", "demo login roles", "/me reflects customer role");
  else fail(T, "demo-login", "demo login roles", `/me: HTTP ${me.status}`);

  const cust = roles.customer.token, rider = roles.rider.token, ops = roles.operator.token;
  // Per-run slot jitter keeps reruns reproducible while capacity holds from
  // a previous run are still active.
  // Give each test run its own future day; business capacity stays at 2.
  const JITTER = 24 * (5 + Math.floor(Math.random() * 90));

  // Catalog against real contracts.
  const svcRes = await call(DEMO_BASE, "GET", "/services");
  const { z } = await import("zod");
  const services = checkSchema(T, "demo-catalog", "catalog matches contracts", z.array(serviceSchema).safeParse(svcRes.json), svcRes);
  if (!services || services.length === 0) { fail(T, "demo-catalog", "catalog matches contracts", "empty catalog; run seedDemo"); return; }
  pass(T, "demo-catalog", "catalog matches contracts", `${services.length} services validate`);
  const one = await call(DEMO_BASE, "GET", `/services/${services[0].id}`);
  if (one.status === 200 && serviceSchema.safeParse(one.json).success) pass(T, "demo-catalog", "catalog matches contracts", "service detail validates");
  else fail(T, "demo-catalog", "catalog matches contracts", `detail: HTTP ${one.status}`);
  const area = await call(DEMO_BASE, "GET", "/service-areas/check");
  if (area.status === 200 && area.json?.areaId) pass(T, "demo-catalog", "catalog matches contracts", "service-area check ok");
  else fail(T, "demo-catalog", "catalog matches contracts", `area check: HTTP ${area.status}`);

  const service = services.find((s) => s.garments?.length) ?? services[0];
  const garmentId = service.garments[0].id;
  const addrRes = await call(DEMO_BASE, "GET", "/addresses", { token: cust });
  const addressId = addrRes.json?.[0]?.id;
  if (!addressId) { fail(T, "demo-quote", "quotes deadlines and capacity", "no demo address for customer"); return; }
  const line = { serviceId: service.id, garmentTypeId: garmentId, quantity: 2 };

  async function makeQuote(slotAhead, returnDaysOut, extra = {}) {
    const w = slotHoursFromNow(slotAhead);
    const returnBy = new Date(Date.parse(w.end) + returnDaysOut * 86400_000).toISOString();
    return call(DEMO_BASE, "POST", "/quotes",
      { token: cust, body: { addressId, lines: [line], pickupWindow: { ...w, timezone: "Asia/Kolkata" }, requestedReturnBy: returnBy, timezone: "Asia/Kolkata", ...extra }, key: uuid() });
  }

  // Valid quote.
  const q1 = await makeQuote(30 + JITTER, 5);
  const quote1 = checkSchema(T, "demo-quote", "quotes deadlines and capacity", quoteSchema.safeParse(q1.json), q1);
  if (!quote1) return;
  if (quote1.totalMinor > 0 && quote1.currency === "INR") pass(T, "demo-quote", "quotes deadlines and capacity", `quote ok, total ${quote1.totalMinor} minor INR`);
  else fail(T, "demo-quote", "quotes deadlines and capacity", "quote totals invalid");

  // Deadline earlier than slowest turnaround is refused, never silently moved.
  const qEarly = await makeQuote(34 + JITTER, 0);
  if (qEarly.status === 422 && envelopeCode(qEarly) === "DEADLINE_UNAVAILABLE") pass(T, "demo-quote", "quotes deadlines and capacity", "early return 422 DEADLINE_UNAVAILABLE");
  else fail(T, "demo-quote", "quotes deadlines and capacity", `early return: HTTP ${qEarly.status} code ${envelopeCode(qEarly)}`);

  // Capacity: fresh buckets hold 2, so the third concurrent quote in one
  // slot must refuse with NO_CAPACITY.
  const capSlot = 50 + JITTER;
  await makeQuote(capSlot, 5);
  await makeQuote(capSlot, 5);
  const qFull = await makeQuote(capSlot, 5);
  if (qFull.status === 409 && envelopeCode(qFull) === "NO_CAPACITY") pass(T, "demo-quote", "quotes deadlines and capacity", "third hold in slot 409 NO_CAPACITY");
  else fail(T, "demo-quote", "quotes deadlines and capacity", `capacity: HTTP ${qFull.status} code ${envelopeCode(qFull)}`);

  // Second quote in its own slot for the idempotency-conflict probe.
  const q2 = await makeQuote(70 + JITTER, 5);
  const quote2 = checkSchema(T, "demo-checkout-idem", "checkout idempotency and conflicts", quoteSchema.safeParse(q2.json), q2);
  if (!quote2) return;

  // Checkout idempotency: same key plus same payload replays; same key
  // plus different payload conflicts.
  const K1 = uuid();
  const c1 = await call(DEMO_BASE, "POST", "/checkouts", { token: cust, body: { quoteId: quote1.id }, key: K1 });
  const co1 = checkSchema(T, "demo-checkout-idem", "checkout idempotency and conflicts", checkoutSchema.safeParse(c1.json), c1);
  if (!co1) return;
  pass(T, "demo-checkout-idem", "checkout idempotency and conflicts", "checkout created, payment pending distinct from confirmed");
  const c1r = await call(DEMO_BASE, "POST", "/checkouts", { token: cust, body: { quoteId: quote1.id }, key: K1 });
  if (c1r.status === 200 && c1r.json?.orderId === co1.orderId && c1r.json?.paymentId === co1.paymentId) {
    pass(T, "demo-checkout-idem", "checkout idempotency and conflicts", "same key plus payload replays original order and payment");
  } else fail(T, "demo-checkout-idem", "checkout idempotency and conflicts", `replay: HTTP ${c1r.status}`);
  const cConf = await call(DEMO_BASE, "POST", "/checkouts", { token: cust, body: { quoteId: quote2.id }, key: K1 });
  if (cConf.status === 409 && envelopeCode(cConf) === "IDEMPOTENCY_CONFLICT") {
    pass(T, "demo-checkout-idem", "checkout idempotency and conflicts", "same key plus different payload 409 IDEMPOTENCY_CONFLICT");
  } else fail(T, "demo-checkout-idem", "checkout idempotency and conflicts", `conflict: HTTP ${cConf.status} code ${envelopeCode(cConf)}`);
  const cStale = await call(DEMO_BASE, "POST", "/checkouts", { token: cust, body: { quoteId: quote2.id, expectedVersion: 999 }, key: uuid() });
  if (cStale.status === 409) pass(T, "demo-version", "stale version rejection", "stale quote version 409 on checkout");
  else fail(T, "demo-version", "stale version rejection", `stale checkout: HTTP ${cStale.status}`);

  // Capture duplicate: same payment captured twice yields one order view,
  // unknown payment is 404.
  const cap1 = await call(DEMO_BASE, "POST", `/demo/payments/${co1.paymentId}/capture`, { token: cust, body: {}, key: uuid() });
  const capView = checkSchema(T, "demo-capture", "capture duplicate", orderSchema.safeParse(cap1.json), cap1);
  if (!capView) return;
  const cap2 = await call(DEMO_BASE, "POST", `/demo/payments/${co1.paymentId}/capture`, { token: cust, body: {}, key: uuid() });
  if (cap2.status === 200 && cap2.json?.id === capView.id && cap2.json?.version === capView.version) {
    pass(T, "demo-capture", "capture duplicate", "duplicate capture returns same order view, no second order");
  } else fail(T, "demo-capture", "capture duplicate", `recapture: HTTP ${cap2.status}`);
  const capUnknown = await call(DEMO_BASE, "POST", `/demo/payments/${uuid()}/capture`, { token: cust, body: {}, key: uuid() });
  if (capUnknown.status === 404) pass(T, "demo-capture", "capture duplicate", "unknown payment 404");
  else fail(T, "demo-capture", "capture duplicate", `unknown capture: HTTP ${capUnknown.status}`);
  const orderId = capView.id;

  // Role and ownership: private resources 404 to strangers, 403 to wrong roles.
  const riderPeek = await call(DEMO_BASE, "GET", `/orders/${orderId}`, { token: rider });
  if (riderPeek.status === 404) pass(T, "demo-ownership", "role and ownership", "unassigned rider reads customer order 404");
  else fail(T, "demo-ownership", "role and ownership", `rider peek: HTTP ${riderPeek.status}`);
  const custOps = await call(DEMO_BASE, "GET", "/ops/orders", { token: cust });
  if (custOps.status === 403) pass(T, "demo-ownership", "role and ownership", "customer reads ops queue 403");
  else fail(T, "demo-ownership", "role and ownership", `customer ops read: HTTP ${custOps.status}`);
  const custAccept = await call(DEMO_BASE, "GET", "/partner/jobs", { token: cust });
  if (custAccept.status === 403) pass(T, "demo-ownership", "role and ownership", "customer reads partner jobs 403");
  else fail(T, "demo-ownership", "role and ownership", `customer jobs read: HTTP ${custAccept.status}`);

  // Dispatch assigns jobs explicitly; riders cannot discover or self-assign
  // unassigned customer addresses. Read only this synthetic order's legs.
  for (const job of capView.deliveries) {
    const path = `/ops/deliveries/${job.id}/dispatch`;
    const invalid = await call(DEMO_BASE, "POST", path, {
      token: ops, body: { assignedTo: roles.customer.user.id, expectedVersion: job.version }, key: uuid(),
    });
    if (invalid.status === 400) pass(T, "demo-dispatch", "operator assignment", "non-rider assignee rejected");
    else fail(T, "demo-dispatch", "operator assignment", `non-rider: HTTP ${invalid.status}`);
    const key = uuid();
    const payload = { assignedTo: roles.rider.user.id, expectedVersion: job.version };
    const assigned = await call(DEMO_BASE, "POST", path, { token: ops, body: payload, key });
    if (assigned.status !== 200 || assigned.json?.assignedTo !== roles.rider.user.id) {
      fail(T, "demo-custody", "pickup vs return custody", `operator assignment: HTTP ${assigned.status}`);
      return;
    }
    const replay = await call(DEMO_BASE, "POST", path, { token: ops, body: payload, key });
    if (replay.status === 200 && replay.json?.version === assigned.json.version) pass(T, "demo-dispatch", "operator assignment", "assignment retry replays without version bump");
    else fail(T, "demo-dispatch", "operator assignment", `assignment replay: HTTP ${replay.status}`);
    const stale = await call(DEMO_BASE, "POST", path, { token: ops, body: payload, key: uuid() });
    if (stale.status === 409 && envelopeCode(stale) === "VERSION_CONFLICT") pass(T, "demo-dispatch", "operator assignment", "stale assignment version rejected");
    else fail(T, "demo-dispatch", "operator assignment", `stale assignment: HTTP ${stale.status}`);
  }
  // Custody: pickup handover must not deliver; only the return leg can.
  const jobsRes = await call(DEMO_BASE, "GET", "/partner/jobs", { token: rider });
  const jobs = z.array(deliveryJobSchema).safeParse(jobsRes.json);
  if (!jobs.success) { fail(T, "demo-custody", "pickup vs return custody", "partner jobs schema mismatch"); return; }
  const pickup = jobs.data.find((j) => j.orderId === orderId && j.leg === "PICKUP");
  const ret = jobs.data.find((j) => j.orderId === orderId && j.leg === "RETURN");
  if (!pickup || !ret) { fail(T, "demo-custody", "pickup vs return custody", "pickup and return jobs missing after capture"); return; }
  const accP = await call(DEMO_BASE, "POST", `/partner/jobs/${pickup.id}/accept`, { token: rider, body: {}, key: uuid() });
  if (accP.status !== 200) { fail(T, "demo-custody", "pickup vs return custody", `pickup accept: HTTP ${accP.status}`); return; }
  const codes = await call(DEMO_BASE, "GET", `/orders/${orderId}/handover-code`, { token: cust });
  const pickupOtp = codes.json?.pickupOtp;
  if (!pickupOtp) { fail(T, "demo-otp", "OTP custody proof", "no pickup OTP revealed to customer owner"); return; }
  if (codes.json?.returnOtp) fail(T, "demo-otp", "OTP custody proof", "return OTP visible before READY_FOR_RETURN");
  else pass(T, "demo-otp", "OTP custody proof", "return OTP withheld until return window");

  // OTP proof: missing OTP, wrong OTP, and photo-only proof all fail.
  const noOtp = await call(DEMO_BASE, "POST", `/partner/jobs/${pickup.id}/handover`,
    { token: rider, body: { jobId: pickup.id, actionId: uuid(), bagIds: ["BAG-1"], method: "OTP", capturedAt: new Date().toISOString(), expectedVersion: accP.json.version }, key: uuid() });
  if (noOtp.status === 400) pass(T, "demo-otp", "OTP custody proof", "handover without OTP 400");
  else fail(T, "demo-otp", "OTP custody proof", `no-OTP handover: HTTP ${noOtp.status}`);
  const wrongOtp = await call(DEMO_BASE, "POST", `/partner/jobs/${pickup.id}/handover`,
    { token: rider, body: { jobId: pickup.id, actionId: uuid(), bagIds: ["BAG-1"], method: "OTP", otp: "000000", capturedAt: new Date().toISOString(), expectedVersion: accP.json.version }, key: uuid() });
  if (wrongOtp.status === 400) pass(T, "demo-otp", "OTP custody proof", "wrong OTP 400");
  else fail(T, "demo-otp", "OTP custody proof", `wrong-OTP handover: HTTP ${wrongOtp.status}`);
  const photoOnly = await call(DEMO_BASE, "POST", `/partner/jobs/${pickup.id}/handover`,
    { token: rider, body: { jobId: pickup.id, actionId: uuid(), bagIds: ["BAG-1"], method: "PROVIDER_PROOF", capturedAt: new Date().toISOString(), expectedVersion: accP.json.version }, key: uuid() });
  if (photoOnly.status === 400) pass(T, "demo-otp", "OTP custody proof", "proof reference required, photos alone never complete handover");
  else fail(T, "demo-otp", "OTP custody proof", `photo-only handover: HTTP ${photoOnly.status}`);
  const forgedProof = await call(DEMO_BASE, "POST", `/partner/jobs/${pickup.id}/handover`,
    { token: rider, body: { jobId: pickup.id, actionId: uuid(), bagIds: ["BAG-1"], method: "PROVIDER_PROOF", proofReference: "synthetic-unverified-proof", capturedAt: new Date().toISOString(), expectedVersion: accP.json.version }, key: uuid() });
  if (forgedProof.status === 403) pass(T, "demo-otp", "OTP custody proof", "manual rider cannot bypass OTP with an arbitrary proof reference");
  else fail(T, "demo-otp", "OTP custody proof", `forged proof: HTTP ${forgedProof.status}`);
  const hop = await call(DEMO_BASE, "POST", `/partner/jobs/${pickup.id}/handover`,
    { token: rider, body: { jobId: pickup.id, actionId: uuid(), bagIds: ["BAG-1"], method: "OTP", otp: pickupOtp, capturedAt: new Date().toISOString(), expectedVersion: accP.json.version }, key: uuid() });
  if (hop.status !== 200 || hop.json?.status !== "COMPLETED") { fail(T, "demo-custody", "pickup vs return custody", `pickup handover: HTTP ${hop.status}`); return; }
  pass(T, "demo-otp", "OTP custody proof", "correct OTP completes pickup handover");
  const afterPickup = await call(DEMO_BASE, "GET", `/orders/${orderId}`, { token: cust });
  if (afterPickup.json?.status !== "DELIVERED") pass(T, "demo-custody", "pickup vs return custody", `pickup completion leaves order ${afterPickup.json?.status}, not delivered`);
  else fail(T, "demo-custody", "pickup vs return custody", "pickup handover delivered the order");

  // Ops intake and care: matching counts go straight to the facility.
  const lines = afterPickup.json?.lines ?? [];
  const measured = lines.map((l) => ({ orderLineId: l.orderLineId, quantity: l.quantity }));
  const intake = await call(DEMO_BASE, "POST", `/ops/orders/${orderId}/intake`,
    { token: ops, body: { expectedVersion: afterPickup.json.version, measuredLines: measured, bagIds: ["BAG-1"] }, key: uuid() });
  if (intake.status === 200 && intake.json?.status === "AT_FACILITY") pass(T, "demo-ops", "ops intake and care", "matching intake reconciles to AT_FACILITY");
  else { fail(T, "demo-ops", "ops intake and care", `intake: HTTP ${intake.status} status ${intake.json?.status}`); return; }
  for (const to of ["IN_CARE", "QUALITY_CHECK", "READY_FOR_RETURN"]) {
    const cur = await call(DEMO_BASE, "GET", `/orders/${orderId}`, { token: cust });
    const adv = await call(DEMO_BASE, "POST", `/ops/orders/${orderId}/care`, { token: ops, body: { expectedVersion: cur.json.version, to }, key: uuid() });
    if (adv.status !== 200 || adv.json?.status !== to) { fail(T, "demo-ops", "ops intake and care", `care to ${to}: HTTP ${adv.status}`); return; }
  }
  pass(T, "demo-ops", "ops intake and care", "care progression AT_FACILITY to READY_FOR_RETURN");

  // Second order exercises the mismatch path: intake difference gates care
  // until the adjustment decision lands.
  const q3 = await makeQuote(90 + JITTER, 5);
  const quote3 = checkSchema(T, "demo-ops", "ops intake and care", quoteSchema.safeParse(q3.json), q3);
  if (!quote3) return;
  const c3 = await call(DEMO_BASE, "POST", "/checkouts", { token: cust, body: { quoteId: quote3.id }, key: uuid() });
  const pay3 = c3.json?.paymentId;
  await call(DEMO_BASE, "POST", `/demo/payments/${pay3}/capture`, { token: cust, body: {}, key: uuid() });
  const o3 = await call(DEMO_BASE, "GET", `/orders/${c3.json.orderId}`, { token: cust });
  const over = o3.json.lines.map((l) => ({ orderLineId: l.orderLineId, quantity: l.quantity + 1 }));
  const mis = await call(DEMO_BASE, "POST", `/ops/orders/${c3.json.orderId}/intake`,
    { token: ops, body: { expectedVersion: o3.json.version, measuredLines: over, bagIds: ["BAG-2"] }, key: uuid() });
  if (mis.status === 200 && mis.json?.status === "AWAITING_ADJUSTMENT" && mis.json?.adjustment?.id) {
    pass(T, "demo-ops", "ops intake and care", "count mismatch opens AWAITING_ADJUSTMENT");
  } else { fail(T, "demo-ops", "ops intake and care", `mismatch intake: HTTP ${mis.status}`); return; }
  const careBlocked = await call(DEMO_BASE, "POST", `/ops/orders/${c3.json.orderId}/care`,
    { token: ops, body: { expectedVersion: mis.json.version, to: "IN_CARE" }, key: uuid() });
  if (careBlocked.status === 409 && envelopeCode(careBlocked) === "REQUIRES_APPROVAL") {
    pass(T, "demo-ops", "ops intake and care", "care gated on pending adjustment 409 REQUIRES_APPROVAL");
  } else fail(T, "demo-ops", "ops intake and care", `gated care: HTTP ${careBlocked.status} code ${envelopeCode(careBlocked)}`);

  // Stale version rejection on a live order.
  const staleCancel = await call(DEMO_BASE, "POST", `/orders/${c3.json.orderId}/cancel`,
    { token: cust, body: { reason: "changed mind", expectedVersion: 1 }, key: uuid() });
  if (staleCancel.status === 409 && envelopeCode(staleCancel) === "VERSION_CONFLICT") {
    pass(T, "demo-version", "stale version rejection", "stale cancel 409 VERSION_CONFLICT");
  } else fail(T, "demo-version", "stale version rejection", `stale cancel: HTTP ${staleCancel.status} code ${envelopeCode(staleCancel)}`);

  // Return leg delivers the first order; only then is a review allowed.
  const accR = await call(DEMO_BASE, "POST", `/partner/jobs/${ret.id}/accept`, { token: rider, body: {}, key: uuid() });
  const codes2 = await call(DEMO_BASE, "GET", `/orders/${orderId}/handover-code`, { token: cust });
  const returnOtp = codes2.json?.returnOtp;
  if (!returnOtp) { fail(T, "demo-custody", "pickup vs return custody", "no return OTP at READY_FOR_RETURN"); return; }
  const hopR = await call(DEMO_BASE, "POST", `/partner/jobs/${ret.id}/handover`,
    { token: rider, body: { jobId: ret.id, actionId: uuid(), bagIds: ["BAG-1"], method: "OTP", otp: returnOtp, capturedAt: new Date().toISOString(), expectedVersion: accR.json.version }, key: uuid() });
  if (hopR.status !== 200) { fail(T, "demo-custody", "pickup vs return custody", `return handover: HTTP ${hopR.status}`); return; }
  const delivered = await call(DEMO_BASE, "GET", `/orders/${orderId}`, { token: cust });
  if (delivered.json?.status === "DELIVERED") pass(T, "demo-custody", "pickup vs return custody", "return handover with valid proof delivers the order");
  else fail(T, "demo-custody", "pickup vs return custody", `after return: ${delivered.json?.status}`);

  const revBody = { orderId, overall: 5, comment: "synthetic demo review", mediaIds: [], publishConsent: true };
  const rev1 = await call(DEMO_BASE, "POST", "/reviews", { token: cust, body: revBody, key: uuid() });
  const rev = checkSchema(T, "demo-review", "delivered review duplicate", reviewSchema.safeParse(rev1.json), rev1);
  if (!rev) return;
  pass(T, "demo-review", "delivered review duplicate", "first review for delivered order accepted");
  const rev2 = await call(DEMO_BASE, "POST", "/reviews", { token: cust, body: revBody, key: uuid() });
  if (rev2.status === 400) pass(T, "demo-review", "delivered review duplicate", "second review for same order 400, one per order");
  else fail(T, "demo-review", "delivered review duplicate", `duplicate review: HTTP ${rev2.status}`);
  const revEarly = await call(DEMO_BASE, "POST", "/reviews",
    { token: cust, body: { ...revBody, orderId: c3.json.orderId }, key: uuid() });
  if (revEarly.status === 400) pass(T, "demo-review", "delivered review duplicate", "review of undelivered order 400");
  else fail(T, "demo-review", "delivered review duplicate", `early review: HTTP ${revEarly.status}`);

  // Conversation draft plus confirm: text builds a bound draft, stale
  // revision cannot confirm, current revision checks out.
  const pickupDate = new Date(Date.now() + (120 + Math.floor(Math.random() * 90)) * 86400_000).toISOString().slice(0, 10);
  const returnDate = new Date(Date.parse(pickupDate) + 7 * 86400_000).toISOString().slice(0, 10);
  const hello = await call(DEMO_BASE, "POST", "/demo/conversations/messages", { token: cust, body: { text: "hello" }, key: uuid() });
  if (hello.status === 200 && hello.json?.draft?.draftId && Array.isArray(hello.json?.missingFields)) {
    pass(T, "demo-draft", "conversation draft and confirm", `partial text stays COLLECTING, asks for ${hello.json.missingFields.join(", ") || "nothing"}`);
  } else fail(T, "demo-draft", "conversation draft and confirm", `partial text: HTTP ${hello.status}`);
  const full = await call(DEMO_BASE, "POST", "/demo/conversations/messages",
    { token: cust, body: { text: `wash and press 5 shirts pickup ${pickupDate} return ${returnDate}`, draftId: hello.json?.draft?.draftId }, key: uuid() });
  const draft = full.json?.draft;
  if (full.status === 200 && draft?.state === "QUOTED" && draft?.quoteId && full.json?.quote) {
    pass(T, "demo-draft", "conversation draft and confirm", `full text QUOTED at revision ${draft.revision}, quote bound`);
  } else {
    blocked(T, "demo-draft", "conversation draft and confirm", `full text did not quote: HTTP ${full.status} state ${draft?.state} missing ${full.json?.missingFields}`);
  }
  if (draft?.state === "QUOTED") {
    const staleConfirm = await call(DEMO_BASE, "POST", `/conversation-drafts/${draft.draftId}/confirm`,
      { token: cust, body: { draftId: draft.draftId, revision: draft.revision - 1 || 1, quoteId: draft.quoteId }, key: uuid() });
    // revision-1 is stale unless the draft is still at revision 1.
    if (draft.revision > 1 && staleConfirm.status === 409) {
      pass(T, "demo-draft", "conversation draft and confirm", "stale draft revision 409 on confirm");
    } else if (draft.revision > 1) fail(T, "demo-draft", "conversation draft and confirm", `stale confirm: HTTP ${staleConfirm.status}`);
    const okConfirm = await call(DEMO_BASE, "POST", `/conversation-drafts/${draft.draftId}/confirm`,
      { token: cust, body: { draftId: draft.draftId, revision: draft.revision, quoteId: draft.quoteId }, key: uuid() });
    if (okConfirm.status === 200 && checkoutSchema.safeParse(okConfirm.json).success) {
      pass(T, "demo-draft", "conversation draft and confirm", "current revision confirms to checkout, bound to draft and quote");
    } else fail(T, "demo-draft", "conversation draft and confirm", `confirm: HTTP ${okConfirm.status} code ${envelopeCode(okConfirm)}`);
    const mismatch = await call(DEMO_BASE, "POST", `/conversation-drafts/${draft.draftId}/confirm`,
      { token: cust, body: { draftId: uuid(), revision: draft.revision, quoteId: draft.quoteId }, key: uuid() });
    if (mismatch.status === 400) pass(T, "demo-whatsapp-refuse", "unlinked WhatsApp refusal", "mismatched draft binding 400");
    else fail(T, "demo-whatsapp-refuse", "unlinked WhatsApp refusal", `mismatched confirm: HTTP ${mismatch.status}`);
  }

  // Arbitrary linking claims are refused: garbage sender phone is invalid,
  // and raw inbound webhooks are never accepted without verification.
  const linkBad = await call(DEMO_BASE, "POST", "/account-links/whatsapp", { token: cust, body: { senderPhone: "x" }, key: uuid() });
  if (linkBad.status === 400) pass(T, "demo-whatsapp-refuse", "unlinked WhatsApp refusal", "invalid sender phone 400, no address disclosed");
  else fail(T, "demo-whatsapp-refuse", "unlinked WhatsApp refusal", `bad link: HTTP ${linkBad.status}`);
  const rawHook = await call(DEMO_BASE, "POST", "/webhooks/whatsapp", { body: { text: "confirm" }, key: uuid() });
  if (rawHook.status === 501) pass(T, "demo-whatsapp-refuse", "unlinked WhatsApp refusal", "raw inbound webhook 501, nothing booked or faked");
  else fail(T, "demo-whatsapp-refuse", "unlinked WhatsApp refusal", `raw webhook: HTTP ${rawHook.status}`);
}

// ------------------------------------------------------------------ main --
if (!SKIP_PROD) await verifyProd();
if (!SKIP_DEMO) await verifyDemo();

mkdirSync(EVIDENCE_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = join(EVIDENCE_DIR, `report-${stamp}.json`);
const summary = {
  at: new Date().toISOString(),
  demoBase: DEMO_BASE,
  prodBase: PROD_BASE,
  counts: {
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status === "fail").length,
    blocked: results.filter((r) => r.status === "blocked").length,
  },
  // Counts and codes only. No tokens, no OTP values, no personal data.
  checks: results.map(({ target, id, name, status, detail, http }) => ({ target, id, name, status, detail, http })),
  failures: results.filter((r) => r.status === "fail"),
};
writeFileSync(reportPath, JSON.stringify(summary, null, 2));
console.log(`\nReport: ${reportPath}`);
console.log(`RESULT: ${summary.counts.fail === 0 && summary.counts.blocked === 0 ? "PASS" : "FAIL"} ` +
  `(pass ${summary.counts.pass}, fail ${summary.counts.fail}, blocked ${summary.counts.blocked})`);
process.exit(summary.counts.fail === 0 && summary.counts.blocked === 0 ? 0 : 1);
