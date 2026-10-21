import { createClient, ApiError } from "../../packages/api-client/dist/index.js";

/**
 * Post-restart persistence check.
 *
 *   node tools/verification/check-persistence.mjs <paidOrderId> <heldOrderId>
 *
 * Signs in as the demo customer and operator against the running API, reads the
 * orders through the shared SDK, and fails on a drifted state. It also confirms
 * the reviewer's order was only additively backfilled and still has its original
 * status, payment and version.
 */

const API_URL = process.env.PILOT_API_URL ?? "http://127.0.0.1:4100/v1";
const REVIEWER_ORDER = process.env.PILOT_REVIEWER_ORDER_ID;
const [paidId, heldId] = process.argv.slice(2);
if (!paidId || !heldId) {
  console.error("usage: check-persistence.mjs <paidOrderId> <heldOrderId>");
  process.exit(2);
}

const tokens = {};
const clientFor = (role) => createClient({ baseUrl: API_URL, getToken: () => tokens[role] });
const customer = clientFor("customer");
const operator = clientFor("operator");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const customerSession = await customer.demoAuth("customer");
  tokens.customer = customerSession.token;
  const operatorSession = await operator.demoAuth("operator");
  tokens.operator = operatorSession.token;

  const paid = await customer.pilotOrder(paidId);
  assert(paid.status === "DELIVERED", `paid order status=${paid.status}`);
  assert(paid.paymentStatus === "PAID", `paid order payment=${paid.paymentStatus}`);
  assert(paid.totalMinor === 36_000, `paid order total=${paid.totalMinor}`);
  assert(paid.returnStatus === "COMPLETED", `paid order return=${paid.returnStatus}`);
  assert(paid.timeZone === "Asia/Kolkata", `paid order timezone=${paid.timeZone}`);

  let tracking;
  try {
    await customer.pilotLocation(paidId);
    tracking = "readable";
  } catch (error) {
    tracking = error instanceof ApiError && error.status === 404 ? "closed" : `error:${error?.status}`;
  }
  assert(tracking === "closed", `post-delivery tracking was ${tracking}`);

  const held = await customer.pilotOrder(heldId);
  assert(held.status === "DELIVERED", `held order status=${held.status}`);
  assert(held.paymentStatus === "UNPAID", `held order payment=${held.paymentStatus}`);
  assert(held.totalMinor === 0, `held order total=${held.totalMinor}`);
  assert(held.returnStatus === "COMPLETED", `held order return=${held.returnStatus}`);

  const reviewer = REVIEWER_ORDER ? await operator.pilotOrder(REVIEWER_ORDER) : undefined;
  if (reviewer) {
  assert(reviewer.status === "BOOKED", `reviewer order status=${reviewer.status}`);
  assert(reviewer.paymentStatus === "UNPAID", `reviewer order payment=${reviewer.paymentStatus}`);
  assert(reviewer.version === 1, `reviewer order version=${reviewer.version}`);
  assert(reviewer.timeZone === "Asia/Kolkata", `reviewer order timezone=${reviewer.timeZone}`);
  assert(reviewer.pickupEnd && reviewer.returnEnd, "reviewer order windows missing");
  }

  const result = {
    checkedAt: new Date().toISOString(),
    apiUrl: API_URL,
    paidOrder: {
      id: paid.id,
      status: paid.status,
      paymentStatus: paid.paymentStatus,
      totalMinor: paid.totalMinor,
      returnStatus: paid.returnStatus,
      trackingAfterDelivery: tracking,
    },
    heldOrder: {
      id: held.id,
      status: held.status,
      paymentStatus: held.paymentStatus,
      totalMinor: held.totalMinor,
      returnStatus: held.returnStatus,
    },
    reviewerOrder: reviewer ? {
      id: reviewer.id,
      status: reviewer.status,
      paymentStatus: reviewer.paymentStatus,
      version: reviewer.version,
      timeZone: reviewer.timeZone,
      pickupEnd: reviewer.pickupEnd,
      returnEnd: reviewer.returnEnd,
    } : null,
  };
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error("[persistence] FAILED:", error);
  process.exit(1);
}
