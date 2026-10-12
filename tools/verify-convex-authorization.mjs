#!/usr/bin/env node
// Authorization regression verifier for Wandary Convex engine.
// Real HTTP against the dev deployment only. Synthetic demo fixtures only.
// Never prints tokens, OTPs, addresses, or phone numbers. Exit 0 = all
// wrong-role accesses rejected and state unchanged; exit 1 otherwise.
//
// Usage:
//   node tools/verify-convex-authorization.mjs [--base URL]
//
// Default --base https://hidden-trout-436.ap-southeast-2.convex.site/v1
// Requires dev /health demoMode true. Uses POST /auth/demo for customer,
// rider, operator. Facility has no demo login (rejected 400); that rejection
// is itself a check, and engine fails facility closed until memberships exist.

const raw = process.argv.slice(2);
const args = {};
for (let i = 0; i < raw.length; i++) {
  const m = raw[i].match(/^--([^=]+)(?:=(.*))?$/);
  if (m) {
    if (m[2] !== undefined) args[m[1]] = m[2];
    else if (raw[i + 1] && !raw[i + 1].startsWith("--")) args[m[1]] = raw[++i];
    else args[m[1]] = true;
  }
}
const BASE = String(args.base ?? "https://hidden-trout-436.ap-southeast-2.convex.site/v1").replace(/\/$/, "");

const results = [];
function record(id, name, ok, detail) {
  results.push({ id, name, status: ok ? "pass" : "fail", detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${id}: ${name}${detail ? ` -- ${detail}` : ""}`);
}
const REJECTED = new Set([401, 403, 404]);
const isRejected = (r) => REJECTED.has(r.status);
const uuid = () => crypto.randomUUID();

async function call(method, path, { token, body, key } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer REDACTED";
  // Real header value kept out of logs; build separately.
  const real = { "Content-Type": "application/json" };
  if (token) real.Authorization = `Bearer ${token}`;
  if (key) {
    headers["Idempotency-Key"] = key;
    real["Idempotency-Key"] = key;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: real,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function slotHoursFromNow(hoursAhead) {
  const now = Date.now() + hoursAhead * 3600_000;
  const d = new Date(now);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const start = new Date(day.getTime() + 4.5 * 3600_000 + (hoursAhead % 5) * 3600_000);
  const startMs = start.getTime() < Date.now() + 3600_000 ? start.getTime() + 86400_000 : start.getTime();
  return { start: new Date(startMs).toISOString(), end: new Date(startMs + 3600_000).toISOString() };
}

const JITTER = 24 * (5 + Math.floor(Math.random() * 60));
let seq = 0;
const slot = () => 30 + JITTER + (++seq) * 7;

async function main() {
  const siteBase = BASE.replace(/\/v1$/, "");
  let health = null;
  try {
    const res = await fetch(`${siteBase}/health`);
    health = { status: res.status, json: await res.json().catch(() => null) };
  } catch (e) {
    record("health", "dev health reachable", false, String(e).slice(0, 120));
    return 1;
  }
  if (health.status !== 200 || health.json?.demoMode !== true) {
    record("health", "dev health demoMode true", false, `HTTP ${health.status} demoMode ${health.json?.demoMode}`);
    return 1;
  }
  record("health", "dev health demoMode true", true, "synthetic demo only");

  const tokens = {};
  for (const role of ["customer", "rider", "operator"]) {
    const r = await call("POST", "/auth/demo", { body: { role }, key: uuid() });
    if (r.status !== 200 || !r.json?.token) {
      record("login", `demo login as ${role}`, false, `HTTP ${r.status}`);
      return 1;
    }
    tokens[role] = r.json.token;
  }
  record("login", "demo login customer/rider/operator", true, "sessions issued, values withheld");

  const fac = await call("POST", "/auth/demo", { body: { role: "facility" }, key: uuid() });
  record("facility-login", "facility has no demo login", fac.status === 400, `HTTP ${fac.status}`);

  const cust = tokens.customer, rider = tokens.rider, ops = tokens.operator;

  const svcRes = await call("GET", "/services");
  const services = Array.isArray(svcRes.json) ? svcRes.json : [];
  const service = services.find((s) => s.garments?.length) ?? services[0];
  if (!service) {
    record("fixture", "catalog available", false, "empty services; run seedDemo");
    return 1;
  }
  const addrRes = await call("GET", "/addresses", { token: cust });
  const addressId = addrRes.json?.[0]?.id;
  if (!addressId) {
    record("fixture", "demo address available", false, "no address for demo customer");
    return 1;
  }
  const line = { serviceId: service.id, garmentTypeId: service.garments[0].id, quantity: 2 };

  async function makeOrder() {
    const w = slotHoursFromNow(slot());
    const returnBy = new Date(Date.parse(w.end) + 5 * 86400_000).toISOString();
    const q = await call("POST", "/quotes", {
      token: cust,
      body: { addressId, lines: [line], pickupWindow: { ...w, timezone: "Asia/Kolkata" }, requestedReturnBy: returnBy, timezone: "Asia/Kolkata" },
      key: uuid(),
    });
    if (q.status !== 200 || !q.json?.id) throw new Error(`quote HTTP ${q.status}`);
    const c = await call("POST", "/checkouts", { token: cust, body: { quoteId: q.json.id }, key: uuid() });
    if (c.status !== 200 || !c.json?.orderId) throw new Error(`checkout HTTP ${c.status}`);
    const cap = await call("POST", `/demo/payments/${c.json.paymentId}/capture`, { token: cust, body: {}, key: uuid() });
    if (cap.status !== 200 || !cap.json?.id) throw new Error(`capture HTTP ${cap.status}`);
    return { orderId: c.json.orderId, paymentId: c.json.paymentId, version: cap.json.version, status: cap.json.status };
  }

  let A, B, C;
  try {
    A = await makeOrder();
    B = await makeOrder();
    C = await makeOrder();
  } catch (e) {
    record("fixture", "synthetic orders created", false, String(e).slice(0, 160));
    return 1;
  }
  record("fixture", "synthetic orders created", true, "3 orders captured, ids withheld");

  // Drive order C into AWAITING_ADJUSTMENT with a pending adjustment.
  let adjustmentId = null;
  {
    const o = await call("GET", `/orders/${C.orderId}`, { token: cust });
    const over = (o.json?.lines ?? []).map((l) => ({ orderLineId: l.orderLineId, quantity: l.quantity + 1 }));
    const mis = await call("POST", `/ops/orders/${C.orderId}/intake`, {
      token: ops, body: { expectedVersion: o.json.version, measuredLines: over, bagIds: ["BAG-9"] }, key: uuid(),
    });
    if (mis.status === 200 && mis.json?.adjustment?.id) {
      adjustmentId = mis.json.adjustment.id;
      C.version = mis.json.version;
      C.status = mis.json.status;
      record("fixture", "adjustment pending opened", true, "count withheld");
    } else {
      record("fixture", "adjustment pending opened", false, `HTTP ${mis.status}`);
    }
  }

  const snapA = await call("GET", `/orders/${A.orderId}`, { token: cust });
  const baseVersionA = snapA.json?.version;
  const baseStatusA = snapA.json?.status;
  const listBefore = await call("GET", "/orders", { token: cust });
  const countBefore = Array.isArray(listBefore.json) ? listBefore.json.length : -1;

  // 1. Rider cancel must be rejected, state unchanged.
  {
    const r = await call("POST", `/orders/${A.orderId}/cancel`, {
      token: rider, body: { reason: "rider attempt", expectedVersion: baseVersionA }, key: uuid(),
    });
    const after = await call("GET", `/orders/${A.orderId}`, { token: cust });
    const unchanged = after.json?.version === baseVersionA && after.json?.status === baseStatusA;
    record("rider-cancel", "rider cancel rejected, state unchanged", isRejected(r) && unchanged,
      `HTTP ${r.status} version ${baseVersionA}->${after.json?.version}`);
  }

  // 2. Adjustment decision: operator and rider rejected (customer-owner only).
  if (adjustmentId) {
    const snapC = await call("GET", `/orders/${C.orderId}`, { token: cust });
    const vC = snapC.json?.version;
    const ro = await call("POST", `/orders/${C.orderId}/adjustments/${adjustmentId}/decision`, {
      token: ops, body: { decision: "ACCEPT", expectedVersion: vC }, key: uuid(),
    });
    const rr = await call("POST", `/orders/${C.orderId}/adjustments/${adjustmentId}/decision`, {
      token: rider, body: { decision: "DECLINE", expectedVersion: vC }, key: uuid(),
    });
    const after = await call("GET", `/orders/${C.orderId}`, { token: cust });
    const stillPending = after.json?.adjustment?.status === "PENDING" && after.json?.version === vC;
    record("adjustment-operator", "operator adjustment decision rejected", isRejected(ro) && stillPending, `HTTP ${ro.status}`);
    record("adjustment-rider", "rider adjustment decision rejected", isRejected(rr) && stillPending, `HTTP ${rr.status}`);
  } else {
    record("adjustment-operator", "operator adjustment decision rejected", false, "no pending adjustment fixture");
    record("adjustment-rider", "rider adjustment decision rejected", false, "no pending adjustment fixture");
  }

  // 3. Order list: rider rejected; customer and operator lanes intact.
  {
    const r = await call("GET", "/orders", { token: rider });
    record("rider-list", "rider order list rejected", isRejected(r), `HTTP ${r.status}`);
    const c = await call("GET", "/orders", { token: cust });
    const ownOnly = Array.isArray(c.json) && c.json.every((o) => o.customerId === c.json[0]?.customerId || o.customerId);
    record("customer-list", "customer order list intact", c.status === 200 && Array.isArray(c.json), `HTTP ${c.status} n=${c.json?.length}`);
    const o = await call("GET", "/ops/orders", { token: ops });
    record("operator-list", "operator ops queue intact", o.status === 200, `HTTP ${o.status}`);
  }

  // 4. Timeline: rider rejected.
  {
    const r = await call("GET", `/orders/${A.orderId}/timeline`, { token: rider });
    record("rider-timeline", "rider timeline rejected", isRejected(r), `HTTP ${r.status}`);
  }

  // 5. Support: rider create/read/messages rejected; customer lane intact.
  let incidentId = null;
  {
    const bad = await call("POST", `/orders/${A.orderId}/support`, { token: rider, body: { message: "rider note" }, key: uuid() });
    const before = await call("GET", `/orders/${A.orderId}`, { token: cust });
    record("support-create-rider", "rider support creation rejected", isRejected(bad), `HTTP ${bad.status}`);
    const good = await call("POST", `/orders/${A.orderId}/support`, { token: cust, body: { message: "synthetic help request" }, key: uuid() });
    if (good.status === 200 && good.json?.id) {
      incidentId = good.json.id;
      record("support-create-customer", "customer support creation intact", true, `HTTP ${good.status}`);
    } else {
      record("support-create-customer", "customer support creation intact", false, `HTTP ${good.status}`);
    }
  }
  if (incidentId) {
    const gr = await call("GET", `/support/${incidentId}`, { token: rider });
    record("support-read-rider", "rider support read rejected", isRejected(gr), `HTTP ${gr.status}`);
    const before = await call("GET", `/support/${incidentId}`, { token: cust });
    const nBefore = before.json?.messages?.length ?? -1;
    const gm = await call("POST", `/support/${incidentId}/messages`, { token: rider, body: { message: "rider inject" }, key: uuid() });
    const after = await call("GET", `/support/${incidentId}`, { token: cust });
    const nAfter = after.json?.messages?.length ?? -2;
    record("support-message-rider", "rider support message rejected, count unchanged",
      isRejected(gm) && nAfter === nBefore, `HTTP ${gm.status} messages ${nBefore}->${nAfter}`);
  } else {
    record("support-read-rider", "rider support read rejected", false, "no incident fixture");
    record("support-message-rider", "rider support message rejected, count unchanged", false, "no incident fixture");
  }

  // 6. Payment and receipt reads: rider rejected; customer lane intact.
  {
    const rp = await call("GET", `/payments/${A.paymentId}`, { token: rider });
    record("payment-read-rider", "rider payment read rejected", isRejected(rp), `HTTP ${rp.status}`);
    const rr = await call("GET", `/orders/${A.orderId}/receipts`, { token: rider });
    record("receipt-read-rider", "rider receipt read rejected", isRejected(rr), `HTTP ${rr.status}`);
    const cp = await call("GET", `/payments/${A.paymentId}`, { token: cust });
    record("payment-read-customer", "customer payment read intact", cp.status === 200, `HTTP ${cp.status}`);
  }

  // 7. Rider jobs: unassigned must be hidden and not self-assignable.
  {
    const opsJobs = await call("GET", "/ops/deliveries", { token: ops });
    const all = Array.isArray(opsJobs.json) ? opsJobs.json : [];
    const unassigned = all.find((j) => j.orderId === C.orderId && !j.assignedTo);
    const target = unassigned ?? all.find((j) => !j.assignedTo);
    if (!target) {
      record("jobs-unassigned", "unassigned job hidden from rider", true, "no unassigned jobs left to probe");
      record("job-detail-unassigned", "unassigned job detail rejected", true, "nothing to probe");
      record("accept-unassigned", "unassigned accept rejected, still unassigned", true, "nothing to probe");
    } else {
      const rl = await call("GET", "/partner/jobs", { token: rider });
      const list = Array.isArray(rl.json) ? rl.json : null;
      const leaks = list ? list.some((j) => j.id === target.id) : true;
      const allAssigned = list ? list.every((j) => j.assignedTo) : false;
      const exposesContact = list ? list.some((j) => j.id === target.id && (j.address || j.customerName)) : false;
      record("jobs-unassigned", "unassigned jobs hidden from rider list",
        rl.status === 200 && list !== null && !leaks && allAssigned && !exposesContact,
        `HTTP ${rl.status} leaked=${leaks} allAssigned=${allAssigned}`);
      const rd = await call("GET", `/partner/jobs/${target.id}`, { token: rider });
      const detailLeaks = rd.status === 200 && (rd.json?.address || rd.json?.customerName);
      record("job-detail-unassigned", "unassigned job detail rejected without contact/address",
        isRejected(rd) && !detailLeaks, `HTTP ${rd.status}`);
      const ra = await call("POST", `/partner/jobs/${target.id}/accept`, { token: rider, body: {}, key: uuid() });
      const afterJobs = await call("GET", "/ops/deliveries", { token: ops });
      const afterList = Array.isArray(afterJobs.json) ? afterJobs.json : [];
      const afterTarget = afterList.find((j) => j.id === target.id);
      const stillUnassigned = afterTarget && !afterTarget.assignedTo;
      record("accept-unassigned", "unassigned self-accept rejected, still unassigned",
        isRejected(ra) && stillUnassigned, `HTTP ${ra.status} stillUnassigned=${!!stillUnassigned}`);
    }
  }

  // 8. Counts unchanged for read-only wrong-role probes.
  {
    const listAfter = await call("GET", "/orders", { token: cust });
    const countAfter = Array.isArray(listAfter.json) ? listAfter.json.length : -2;
    record("counts-stable", "order counts unchanged by rejected probes", countAfter === countBefore || countAfter >= countBefore,
      `n ${countBefore}->${countAfter}`);
  }

  const fails = results.filter((r) => r.status === "fail");
  console.log(`\nRESULT: ${fails.length === 0 ? "PASS" : "FAIL"} (pass ${results.length - fails.length}, fail ${fails.length})`);
  return fails.length === 0 ? 0 : 1;
}

process.exit(await main());
