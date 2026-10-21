import { beforeAll, beforeEach, afterAll, test, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "../src/app.module";
import { EnvelopeFilter } from "../src/filters/http-exception.filter";
import { initializeDb, closePool, getPool } from "../../../modules/shared/src/db";

/** Access and custody rules of the pilot API: who may read an order, what
 * happens to a delivery partner who loses the order, and what a reported
 * position may claim. */

const base = "http://127.0.0.1:4113/v1";
const RIDER_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const RIDER_B = "22222222-2222-4222-8222-222222222222";
const RIDER_B_TOKEN = "sess_pilot_test_rider_b";

let app: NestExpressApplication;
let customer: string;
let operator: string;
let riderA: string;
let riderB: string;
let otherCustomer: string;

async function request(method: string, path: string, token?: string, body?: unknown, key?: string) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function login(role: string) {
  const result = await request("POST", "/auth/demo", undefined, { role });
  expect(result.status).toBe(201);
  return result.body.token as string;
}

beforeAll(async () => {
  if (!/^postgres(?:ql)?:\/\/[^@]+@(?:localhost|127\.0\.0\.1):\d+\/laundry_verify_/.test(process.env.DATABASE_URL ?? "")) {
    throw Error("An isolated local laundry_verify_ database is required");
  }
  process.env.PILOT_ENABLED = "true";
  await initializeDb();
  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  app.useGlobalFilters(new EnvelopeFilter());
  await app.listen(4113, "127.0.0.1");
  customer = await login("customer");
  operator = await login("operator");
  riderA = await login("rider");
  // A second delivery partner and a second customer are created directly so
  // the test can act as somebody who holds no part of the order.
  await getPool().query(
    `INSERT INTO users (id,role,name,phone) VALUES ($1,'rider','Second Rider','+91-90000-00009')
     ON CONFLICT (id) DO UPDATE SET role='rider', name=EXCLUDED.name`,
    [RIDER_B],
  );
  await getPool().query(`INSERT INTO sessions (token,user_id) VALUES ($1,$2) ON CONFLICT (token) DO NOTHING`, [RIDER_B_TOKEN, RIDER_B]);
  riderB = RIDER_B_TOKEN;
  const otp = await request("POST", "/auth/otp/request", undefined, { phone: "+91-90000-00021" });
  expect(otp.status).toBe(201);
  const verified = await request("POST", "/auth/otp/verify", undefined, { challengeId: otp.body.challengeId, code: otp.body.demoCode });
  expect(verified.status).toBe(201);
  expect(verified.body.token).toBeTruthy();
  otherCustomer = verified.body.token as string;
});

beforeEach(async () => {
  await getPool().query(
    "TRUNCATE pilot_location_reports,pilot_locations,pilot_events,pilot_orders,pilot_slots,pilot_receipts,pilot_handover_attempts RESTART IDENTITY CASCADE",
  );
});

afterAll(async () => {
  await app?.close();
  await closePool();
});

async function bookingBody() {
  const config = await request("GET", "/pilot/config", customer);
  return {
    serviceCode: "WASH_FOLD",
    estimatedWeightGrams: 5000,
    slotId: config.body.slots[0].id,
    address: { line: "Pilot test address, Indiranagar", lat: 12.975, lng: 77.642 },
  };
}

async function createBooking() {
  const result = await request("POST", "/pilot/orders", customer, await bookingBody(), randomUUID());
  expect(result.status).toBe(201);
  return result.body;
}

async function action(order: { id: string; version: number }, token: string, input: Record<string, unknown>, key = randomUUID()) {
  return request("POST", `/pilot/orders/${order.id}/actions`, token, { expectedVersion: order.version, ...input }, key);
}

/** Takes an order to the point where the return leg is about to start. The
 * intake request is returned exactly as it was sent, so a test can replay it
 * with the same key and the same body. */
async function orderReadyForReturn() {
  let order = await createBooking();
  const assigned = await action(order, operator, { action: "ASSIGN", riderId: RIDER_A });
  expect(assigned.status).toBe(201);
  order = (await request("GET", `/pilot/orders/${order.id}`, customer)).body;
  const picked = await action(order, riderA, { action: "PICKUP", code: order.pickupCode });
  expect(picked.status).toBe(201);
  expect(picked.body.status).toBe("PICKED_UP");
  const intakeKey = randomUUID();
  const intakeRequest = {
    action: "INTAKE",
    expectedVersion: picked.body.version,
    measuredWeightGrams: 6000,
    bagCount: 1,
  };
  const intake = await action(picked.body, riderA, intakeRequest, intakeKey);
  expect(intake.status).toBe(201);
  expect(intake.body.status).toBe("AWAITING_APPROVAL");
  const approved = await action(intake.body, customer, { action: "APPROVE_PRICE" });
  expect(approved.status).toBe(201);
  expect(approved.body.status).toBe("INTAKE_COMPLETE");
  for (const next of ["START_CARE", "QUALITY_CHECK", "READY_FOR_RETURN"]) {
    const changed = await action(approved.body, operator, { action: next });
    expect(changed.status).toBe(201);
    approved.body = changed.body;
  }
  expect(approved.body.status).toBe("READY_FOR_RETURN");
  return { order: approved.body, intakeKey, intakeRequest };
}

test("a delivery partner who loses the order cannot read it or replay an earlier action", async () => {
  const { order, intakeKey, intakeRequest } = await orderReadyForReturn();
  expect(order.status).toBe("READY_FOR_RETURN");

  // Operations hands the order to another partner.
  const reassigned = await action(order, operator, { action: "ASSIGN", riderId: RIDER_B });
  expect(reassigned.status).toBe(201);
  expect(reassigned.body.riderId).toBe(RIDER_B);

  // The first partner can no longer read the order.
  const read = await request("GET", `/pilot/orders/${order.id}`, riderA);
  expect(read.status).toBe(404);

  // Replaying the intake request with the same key and the same body must not
  // hand back the stored response with the customer's address and history.
  const replay = await request(
    "POST",
    `/pilot/orders/${order.id}/actions`,
    riderA,
    intakeRequest,
    intakeKey,
  );
  expect(replay.status).toBe(404);
  expect(replay.body.address).toBeUndefined();
  expect(replay.body.events).toBeUndefined();

  // The new partner can read it.
  expect((await request("GET", `/pilot/orders/${order.id}`, riderB)).status).toBe(200);
});

test("a customer who is not the owner of an order cannot read it", async () => {
  const order = await createBooking();
  const read = await request("GET", `/pilot/orders/${order.id}`, otherCustomer);
  expect(read.status).toBe(404);
  expect(read.body.code).toBe("NOT_FOUND");
  const list = await request("GET", "/pilot/orders", otherCustomer);
  expect(list.status).toBe(200);
  expect(list.body).toEqual([]);
});

test("pilot routes need a session", async () => {
  expect((await request("GET", "/pilot/config")).status).toBe(401);
  expect((await request("GET", "/pilot/orders")).status).toBe(401);
  expect((await request("POST", "/pilot/orders", undefined, await bookingBody(), randomUUID())).status).toBe(401);
});

test("the assigned partner reports a position and the customer reads it with provenance and age", async () => {
  let order = await createBooking();
  await action(order, operator, { action: "ASSIGN", riderId: RIDER_A });
  order = (await request("GET", `/pilot/orders/${order.id}`, customer)).body;

  const beforeReport = await request("GET", `/pilot/orders/${order.id}/location`, customer);
  expect(beforeReport.status).toBe(404);

  const reported = await request(
    "POST",
    `/pilot/orders/${order.id}/location`,
    riderA,
    { lat: 12.9784, lng: 77.6408, capturedAt: new Date().toISOString(), source: "BROWSER_GEOLOCATION" },
    randomUUID(),
  );
  expect(reported.status).toBe(201);
  expect(reported.body).toMatchObject({ lat: 12.9784, lng: 77.6408, source: "BROWSER_GEOLOCATION", stale: false });
  expect(reported.body.ageSeconds).toBeLessThan(10);
  expect(reported.body.reportedAt).toBeTruthy();

  const customerRead = await request("GET", `/pilot/orders/${order.id}/location`, customer);
  expect(customerRead.status).toBe(200);
  expect(customerRead.body.source).toBe("BROWSER_GEOLOCATION");

  // Another customer and an unassigned partner are both refused.
  expect((await request("GET", `/pilot/orders/${order.id}/location`, otherCustomer)).status).toBe(404);
  expect((await request("GET", `/pilot/orders/${order.id}/location`, riderB)).status).toBe(404);
  expect((await request("POST", `/pilot/orders/${order.id}/location`, customer, { lat: 1, lng: 1, capturedAt: new Date().toISOString(), source: "MANUAL" }, randomUUID())).status).toBe(403);
});

test("a position that claims a time far in the future is refused", async () => {
  const order = await createBooking();
  await action(order, operator, { action: "ASSIGN", riderId: RIDER_A });
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const result = await request(
    "POST",
    `/pilot/orders/${order.id}/location`,
    riderA,
    { lat: 12.9784, lng: 77.6408, capturedAt: future, source: "MANUAL" },
    randomUUID(),
  );
  expect(result.status).toBe(400);
  expect(result.body.code).toBe("INVALID_INPUT");
});

test("an old position is returned as stale rather than as live tracking", async () => {
  const order = await createBooking();
  await action(order, operator, { action: "ASSIGN", riderId: RIDER_A });
  const old = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await request(
    "POST",
    `/pilot/orders/${order.id}/location`,
    riderA,
    { lat: 12.9784, lng: 77.6408, capturedAt: old, source: "MANUAL" },
    randomUUID(),
  );
  const read = await request("GET", `/pilot/orders/${order.id}/location`, customer);
  expect(read.status).toBe(200);
  expect(read.body.stale).toBe(true);
  expect(read.body.ageSeconds).toBeGreaterThan(120);
});

test("slot capacity cannot drop below the bookings it already holds", async () => {
  const body = await bookingBody();
  await request("POST", "/pilot/orders", customer, body, randomUUID());
  const tooLow = await request("PUT", `/pilot/slots/${body.slotId}`, operator, { capacity: 0 }, randomUUID());
  expect(tooLow.status).toBe(409);
  expect(tooLow.body.code).toBe("NO_CAPACITY");
  const raised = await request("PUT", `/pilot/slots/${body.slotId}`, operator, { capacity: 5 }, randomUUID());
  expect(raised.status).toBe(200);
  expect(raised.body).toMatchObject({ id: body.slotId, capacity: 5, reserved: 1 });
  expect(raised.body.pickupStart).toBeTruthy();
  // A customer may not change capacity.
  expect((await request("PUT", `/pilot/slots/${body.slotId}`, customer, { capacity: 9 }, randomUUID())).status).toBe(403);
});

test("a customer who declines a higher price stops the work until the founder decides", async () => {
  let order = await createBooking();
  await action(order, operator, { action: "ASSIGN", riderId: RIDER_A });
  order = (await request("GET", `/pilot/orders/${order.id}`, customer)).body;
  const picked = await action(order, riderA, { action: "PICKUP", code: order.pickupCode });
  const intake = await action(picked.body, riderA, { action: "INTAKE", measuredWeightGrams: 8000, bagCount: 2 });
  expect(intake.body.status).toBe("AWAITING_APPROVAL");
  expect(intake.body.proposedTotalMinor).toBe(48000);
  const declined = await action(intake.body, customer, { action: "DECLINE_PRICE" });
  expect(declined.status).toBe(201);
  expect(declined.body.status).toBe("ON_HOLD");
  expect(declined.body.holdReason).toBeTruthy();
  const care = await action(declined.body, operator, { action: "START_CARE" });
  expect(care.status).toBe(409);
});

test("an unpaid return cannot be completed", async () => {
  const { order } = await orderReadyForReturn();
  const returning = await action(order, riderA, { action: "START_RETURN" });
  expect(returning.status).toBe(201);
  const customerView = (await request("GET", `/pilot/orders/${order.id}`, customer)).body;
  const early = await action(returning.body, riderA, { action: "DELIVER", code: customerView.returnCode });
  expect(early.status).toBe(409);
  expect(early.body.code).toBe("PAYMENT_PENDING");
});

test("a replayed position recomputes age and stale at replay time", async () => {
  const order = await createBooking();
  await action(order, operator, { action: "ASSIGN", riderId: RIDER_A });
  const capturedAt = new Date(Date.now() - 30_000).toISOString();
  const body = { lat: 12.9784, lng: 77.6408, capturedAt, source: "MANUAL" };
  const key = randomUUID();
  const first = await request("POST", `/pilot/orders/${order.id}/location`, riderA, body, key);
  expect(first.status).toBe(201);
  expect(first.body).toMatchObject({ stale: false });
  expect(first.body.ageSeconds).toBeLessThan(35);

  const spy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10 * 60 * 1000);
  try {
    const replay = await request("POST", `/pilot/orders/${order.id}/location`, riderA, body, key);
    expect(replay.status).toBe(201);
    expect(replay.body.capturedAt).toBe(capturedAt);
    expect(replay.body.ageSeconds).toBeGreaterThan(600);
    expect(replay.body.stale).toBe(true);
  } finally {
    spy.mockRestore();
  }
});

test("tracking is closed after delivery for reads and for a late rider report", async () => {
  const { order } = await orderReadyForReturn();
  const returning = await action(order, riderA, { action: "START_RETURN" });
  expect(returning.status).toBe(201);
  const report = { lat: 12.9784, lng: 77.6408, capturedAt: new Date().toISOString(), source: "MANUAL" };
  expect((await request("POST", `/pilot/orders/${order.id}/location`, riderA, report, randomUUID())).status).toBe(201);
  const paid = await action(returning.body, operator, {
    action: "CONFIRM_PAYMENT", amountMinor: 36000, method: "CASH", reference: "cash-tracking-close-01",
  });
  expect(paid.status).toBe(201);
  const customerView = (await request("GET", `/pilot/orders/${order.id}`, customer)).body;
  const delivered = await action(paid.body, riderA, { action: "DELIVER", code: customerView.returnCode });
  expect(delivered.status).toBe(201);
  expect(delivered.body.status).toBe("DELIVERED");

  const read = await request("GET", `/pilot/orders/${order.id}/location`, customer);
  expect(read.status).toBe(404);
  expect(read.body.message).toMatch(/tracking is closed/i);
  const late = await request("POST", `/pilot/orders/${order.id}/location`, riderA, report, randomUUID());
  expect(late.status).toBe(404);
  expect(late.body.message).toMatch(/tracking is closed/i);
});
