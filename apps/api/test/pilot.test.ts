import { beforeAll, beforeEach, afterAll, test, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "../src/app.module";
import { EnvelopeFilter } from "../src/filters/http-exception.filter";
import { initializeDb, closePool, getPool } from "../../../modules/shared/src/db";

const base = "http://127.0.0.1:4112/v1";
let app: NestExpressApplication;
let customer: string;
let operator: string;
let rider: string;
async function request(method: string, path: string, token?: string, body?: unknown, key?: string) {
  const response = await fetch(base + path, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { "Idempotency-Key": key } : {}) },
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
  if (!/^postgres(?:ql)?:\/\/[^@]+@(?:localhost|127\.0\.0\.1):\d+\/laundry_verify_/.test(process.env.DATABASE_URL ?? "")) throw Error("An isolated local laundry_verify_ database is required");
  process.env.PILOT_ENABLED = "true";
  await initializeDb();
  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  app.useGlobalFilters(new EnvelopeFilter());
  await app.listen(4112, "127.0.0.1");
  customer = await login("customer");
  operator = await login("operator");
  rider = await login("rider");
});
beforeEach(async () => { await getPool().query("TRUNCATE pilot_events,pilot_orders,pilot_slots RESTART IDENTITY CASCADE"); });
afterAll(async () => { await app?.close(); await closePool(); });

test("pilot explicitly labels demo rates and exposes future capacity-backed slots", async () => {
  const config = await request("GET", "/pilot/config", customer);
  expect(config.status).toBe(200);
  expect(config.body.demo).toBe(true);
  expect(config.body.services[0]).toMatchObject({ code: "WASH_FOLD", rateMinorPerKg: 6000 });
  expect(config.body.slots.length).toBeGreaterThan(0);
  expect(config.body.timeZone).toBe("Asia/Kolkata");
  expect(config.body.slots[0].timeZone).toBe("Asia/Kolkata");
  expect(Date.parse(config.body.slots[0].pickupStart)).toBeGreaterThan(Date.now());
  expect(Date.parse(config.body.slots[0].pickupEnd)).toBeGreaterThan(Date.parse(config.body.slots[0].pickupStart));
  expect(Date.parse(config.body.slots[0].returnStart)).toBeGreaterThan(Date.parse(config.body.slots[0].pickupEnd));
  expect(Date.parse(config.body.slots[0].returnEnd)).toBeGreaterThan(Date.parse(config.body.slots[0].returnStart));
});

async function createBooking() {
  const result = await request("POST", "/pilot/orders", customer, await bookingBody(), randomUUID());
  expect(result.status).toBe(201);
  return result.body;
}
async function action(order: { id: string; version: number }, token: string, input: Record<string, unknown>, key = randomUUID()) {
  return request("POST", `/pilot/orders/${order.id}/actions`, token, { expectedVersion: order.version, ...input }, key);
}
test("kg order completes pickup, customer-approved intake, care, manual payment and return", async () => {
  let order = await createBooking();
  const assigned = await action(order, operator, { action: "ASSIGN", riderId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
  expect(assigned.status).toBe(201);
  order = (await request("GET", `/pilot/orders/${order.id}`, customer)).body;
  expect(order.pickupStatus).toBe("ASSIGNED");
  const picked = await action(order, rider, { action: "PICKUP", code: order.pickupCode });
  expect(picked.status).toBe(201);
  expect(picked.body.pickupCode).toBeUndefined();
  const intake = await action(picked.body, rider, { action: "INTAKE", measuredWeightGrams: 6000, bagCount: 1 });
  expect(intake.status).toBe(201);
  expect(intake.body).toMatchObject({ status: "AWAITING_APPROVAL", totalMinor: 30000, proposedTotalMinor: 36000 });
  const approved = await action(intake.body, customer, { action: "APPROVE_PRICE" });
  expect(approved.status).toBe(201);
  expect(approved.body).toMatchObject({ status: "INTAKE_COMPLETE", totalMinor: 36000, paymentStatus: "UNPAID" });
  order = approved.body;
  for (const next of ["START_CARE", "QUALITY_CHECK", "READY_FOR_RETURN"]) {
    const changed = await action(order, operator, { action: next });
    expect(changed.status).toBe(201); order = changed.body;
  }
  const returning = await action(order, rider, { action: "START_RETURN" });
  expect(returning.status).toBe(201);
  const paid = await action(returning.body, operator, { action: "CONFIRM_PAYMENT", amountMinor: 36000, method: "CASH", reference: "cash-receipt-test-01" });
  expect(paid.status).toBe(201);
  expect(paid.body.paymentStatus).toBe("PAID");
  const customerView = (await request("GET", `/pilot/orders/${order.id}`, customer)).body;
  const delivered = await action(paid.body, rider, { action: "DELIVER", code: customerView.returnCode });
  expect(delivered.status).toBe(201);
  expect(delivered.body).toMatchObject({ status: "DELIVERED", pickupStatus: "COMPLETED", returnStatus: "COMPLETED", paymentStatus: "PAID" });
  expect(delivered.body.events.map((e: { action: string }) => e.action)).toEqual(["BOOKED", "ASSIGN", "PICKUP", "INTAKE", "APPROVE_PRICE", "START_CARE", "QUALITY_CHECK", "READY_FOR_RETURN", "START_RETURN", "CONFIRM_PAYMENT", "DELIVER"]);
});

async function bookingBody() {
  const config = await request("GET", "/pilot/config", customer);
  return { serviceCode: "WASH_FOLD", estimatedWeightGrams: 5000, slotId: config.body.slots[0].id,
    address: { line: "Pilot test address, Indiranagar", lat: 12.975, lng: 77.642 } };
}
test("customer books kg service without prepayment and replay creates only one reservation", async () => {
  const body = await bookingBody();
  const key = randomUUID();
  const first = await request("POST", "/pilot/orders", customer, body, key);
  expect(first.status).toBe(201);
  expect(first.body).toMatchObject({ status: "BOOKED", totalMinor: 30000, paymentStatus: "UNPAID", pickupStatus: "PENDING" });
  const replay = await request("POST", "/pilot/orders", customer, body, key);
  expect(replay.body.id).toBe(first.body.id);
  expect(replay.body.version).toBe(first.body.version);
  const read = await request("GET", `/pilot/orders/${first.body.id}`, customer);
  expect(read.status).toBe(200);
  expect(read.body.totalMinor).toBe(30000);
  const conflict = await request("POST", "/pilot/orders", customer, { ...body, estimatedWeightGrams: 6000 }, key);
  expect(conflict.status).toBe(409);
  expect(conflict.body.code).toBe("IDEMPOTENCY_CONFLICT");
});

test("last-slot booking is atomic and cancellation releases exactly one place", async () => {
  const body = await bookingBody();
  const configured = await request("PUT", `/pilot/slots/${body.slotId}`, operator, { capacity: 1 }, randomUUID());
  expect(configured.status).toBe(200);
  const competing = await Promise.all([request("POST", "/pilot/orders", customer, body, randomUUID()), request("POST", "/pilot/orders", customer, body, randomUUID())]);
  expect(competing.map(r => r.status).sort()).toEqual([201, 409]);
  expect(competing.find(r => r.status === 409)!.body.code).toBe("NO_CAPACITY");
  const order = competing.find(r => r.status === 201)!.body;
  const cancelled = await action(order, customer, { action: "CANCEL" });
  expect(cancelled.status).toBe(201);
  expect(cancelled.body.status).toBe("CANCELLED");
  expect((await request("POST", "/pilot/orders", customer, body, randomUUID())).status).toBe(201);
});

test("five incorrect handover codes block further attempts without completing pickup", async () => {
  let order = await createBooking();
  await action(order, operator, { action: "ASSIGN", riderId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
  order = (await request("GET", `/pilot/orders/${order.id}`, customer)).body;
  for (let i = 0; i < 5; i++) expect((await action(order, rider, { action: "PICKUP", code: "000000" })).status).toBe(409);
  const locked = await action(order, rider, { action: "PICKUP", code: order.pickupCode });
  expect(locked.status).toBe(409);
  expect(locked.body.message).toMatch(/attempt|founder/i);
  expect((await request("GET", `/pilot/orders/${order.id}`, customer)).body.status).toBe("BOOKED");
});

test("a booking carries full timezone-qualified windows and codes that outlive the slot", async () => {
  const order = await createBooking();
  expect(order.timeZone).toBe("Asia/Kolkata");
  for (const field of ["pickupStart", "pickupEnd", "returnStart", "returnEnd", "pickupCodeExpiresAt", "returnCodeExpiresAt"]) {
    expect(Number.isFinite(Date.parse(order[field]))).toBe(true);
  }
  expect(Date.parse(order.pickupEnd)).toBeGreaterThan(Date.parse(order.pickupStart));
  expect(Date.parse(order.returnStart)).toBeGreaterThan(Date.parse(order.pickupEnd));
  expect(Date.parse(order.pickupCodeExpiresAt)).toBeGreaterThan(Date.parse(order.pickupEnd));
  expect(Date.parse(order.returnCodeExpiresAt)).toBeGreaterThan(Date.parse(order.returnEnd));
});

test("an expired pickup code is refused and the customer can reissue it without staff SQL", async () => {
  let order = await createBooking();
  await action(order, operator, { action: "ASSIGN", riderId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
  order = (await request("GET", `/pilot/orders/${order.id}`, customer)).body;
  await getPool().query(
    `UPDATE pilot_orders SET data = data || jsonb_build_object('pickupCodeExpiresAt', $2::text) WHERE id=$1`,
    [order.id, new Date(Date.now() - 60_000).toISOString()],
  );
  const expired = await action(order, rider, { action: "PICKUP", code: order.pickupCode });
  expect(expired.status).toBe(409);
  expect(expired.body.code).toBe("HANDOVER_CODE_EXPIRED");

  const reissued = await action(order, customer, { action: "REISSUE_HANDOVER_CODE", leg: "PICKUP" });
  expect(reissued.status).toBe(201);
  expect(reissued.body.pickupCode).toBeTruthy();
  expect(reissued.body.pickupCode).not.toBe(order.pickupCode);
  expect(Date.parse(reissued.body.pickupCodeExpiresAt)).toBeGreaterThan(Date.now());
  expect(reissued.body.events.map((e: { action: string }) => e.action)).toContain("REISSUE_HANDOVER_CODE");

  const picked = await action(reissued.body, rider, { action: "PICKUP", code: reissued.body.pickupCode });
  expect(picked.status).toBe(201);
  expect(picked.body.status).toBe("PICKED_UP");
});

test("a customer reissue clears a five-attempt handover lock", async () => {
  let order = await createBooking();
  await action(order, operator, { action: "ASSIGN", riderId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
  order = (await request("GET", `/pilot/orders/${order.id}`, customer)).body;
  for (let i = 0; i < 5; i++) expect((await action(order, rider, { action: "PICKUP", code: "000000" })).status).toBe(409);
  expect((await action(order, rider, { action: "PICKUP", code: order.pickupCode })).body.message).toMatch(/attempt|code/i);

  const reissued = await action(order, customer, { action: "REISSUE_HANDOVER_CODE", leg: "PICKUP" });
  expect(reissued.status).toBe(201);
  const picked = await action(reissued.body, rider, { action: "PICKUP", code: reissued.body.pickupCode });
  expect(picked.status).toBe(201);
});

test("only an operator can release a held order, and only as an agreed unprocessed return", async () => {
  let order = await createBooking();
  await action(order, operator, { action: "ASSIGN", riderId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
  order = (await request("GET", `/pilot/orders/${order.id}`, customer)).body;
  const picked = await action(order, rider, { action: "PICKUP", code: order.pickupCode });
  const intake = await action(picked.body, rider, { action: "INTAKE", measuredWeightGrams: 8000, bagCount: 2 });
  const declined = await action(intake.body, customer, { action: "DECLINE_PRICE" });
  expect(declined.body.status).toBe("ON_HOLD");

  const denied = await action(declined.body, customer, {
    action: "RESOLVE_HOLD", resolution: "RETURN_UNPROCESSED", customerAgreed: true,
    note: "Customer asked to stop the wash by phone today.",
  });
  expect(denied.status).toBe(403);

  const resolved = await action(declined.body, operator, {
    action: "RESOLVE_HOLD", resolution: "RETURN_UNPROCESSED", customerAgreed: true,
    note: "Customer agreed by phone on 21 Oct; return the bag unwashed.",
  });
  expect(resolved.status).toBe(201);
  expect(resolved.body).toMatchObject({
    status: "RETURNING", totalMinor: 0, proposedTotalMinor: null,
    paymentStatus: "UNPAID", returnStatus: "ASSIGNED",
  });
  expect(resolved.body.events.map((e: { action: string }) => e.action)).toContain("RESOLVE_HOLD");

  const customerView = (await request("GET", `/pilot/orders/${order.id}`, customer)).body;
  expect(customerView.returnCode).toBeTruthy();
  const delivered = await action(resolved.body, rider, { action: "DELIVER", code: customerView.returnCode });
  expect(delivered.status).toBe(201);
  expect(delivered.body).toMatchObject({ status: "DELIVERED", totalMinor: 0, paymentStatus: "UNPAID" });
});
