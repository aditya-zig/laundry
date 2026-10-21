/** Consumer contract for the UI agent: shared SDK + real Nest API/PostgreSQL. */
import { afterAll, beforeAll, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createClient, type WandaryClient } from "../../../packages/api-client/src/index";
import { AppModule } from "../src/app.module";
import { EnvelopeFilter } from "../src/filters/http-exception.filter";
import { closePool, getPool, initializeDb } from "../../../modules/shared/src/db";

const baseUrl = "http://127.0.0.1:4114/v1";
let app: NestExpressApplication;

async function clientFor(role: "customer" | "operator" | "rider"): Promise<WandaryClient> {
  const { token } = await createClient({ baseUrl }).demoAuth(role);
  return createClient({ baseUrl, getToken: () => token });
}

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.startsWith("/laundry_verify_") || process.env.NODE_ENV === "production") {
    throw new Error("Consumer acceptance requires an isolated local laundry_verify_ database");
  }
  process.env.PILOT_ENABLED = "true";
  await initializeDb();
  await getPool().query("TRUNCATE pilot_events,pilot_orders,pilot_slots RESTART IDENTITY CASCADE");
  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  app.useGlobalFilters(new EnvelopeFilter());
  await app.listen(4114, "127.0.0.1");
});

afterAll(async () => { await app?.close(); await closePool(); });

test("customer SDK preserves kg booking, replay, versioned price consent and payment-at-return semantics", async () => {
  const customer = await clientFor("customer");
  const operator = await clientFor("operator");
  const rider = await clientFor("rider");
  const config = await customer.pilotConfig();
  expect(config).toMatchObject({ demo: true, ratesApproved: false, timeZone: "Asia/Kolkata" });
  const slot = config.slots.find(value => value.reserved < value.capacity)!;
  expect(slot).toBeDefined();
  const booking = {
    serviceCode: "WASH_FOLD" as const, estimatedWeightGrams: 5000, slotId: slot.id,
    address: { line: "SDK handoff fixture, Indiranagar", lat: 12.975, lng: 77.642 },
  };
  const key = randomUUID();
  const booked = await customer.pilotCreateOrder(booking, { idempotencyKey: key });
  const replay = await customer.pilotCreateOrder(booking, { idempotencyKey: key });
  expect(replay.id).toBe(booked.id);
  expect(booked).toMatchObject({
    status: "BOOKED", paymentStatus: "UNPAID", currency: "INR", totalMinor: 30000,
    estimatedWeightGrams: 5000, measuredWeightGrams: null, timeZone: "Asia/Kolkata",
    pickupStart: slot.pickupStart, pickupEnd: slot.pickupEnd, returnStart: slot.returnStart, returnEnd: slot.returnEnd,
  });
  expect(booked.pickupCode).toMatch(/^\d{6}$/);
  expect(booked.returnCode).toBeUndefined();
  expect((await customer.pilotListOrders()).filter(order => order.id === booked.id)).toHaveLength(1);
  expect((await customer.pilotConfig()).slots.find(value => value.id === slot.id)?.reserved).toBe(slot.reserved + 1);
  await expect(customer.pilotCreateOrder({ ...booking, estimatedWeightGrams: 6000 }, { idempotencyKey: key }))
    .rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });

  const assigned = await operator.pilotAction(booked.id, { action: "ASSIGN", expectedVersion: booked.version, riderId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
  expect(assigned.pickupCode).toBeUndefined();
  expect((await rider.pilotOrder(booked.id)).pickupCode).toBeUndefined();
  const picked = await rider.pilotAction(booked.id, { action: "PICKUP", expectedVersion: assigned.version, code: booked.pickupCode! });
  const intake = await rider.pilotAction(booked.id, { action: "INTAKE", expectedVersion: picked.version, measuredWeightGrams: 6000, bagCount: 1 });
  expect(intake).toMatchObject({ status: "AWAITING_APPROVAL", totalMinor: 30000, proposedTotalMinor: 36000, paymentStatus: "UNPAID" });
  await expect(operator.pilotAction(booked.id, { action: "START_CARE", expectedVersion: intake.version }))
    .rejects.toMatchObject({ status: 409 });
  await expect(customer.pilotAction(booked.id, { action: "APPROVE_PRICE", expectedVersion: picked.version }))
    .rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
  expect((await customer.pilotOrder(booked.id)).status).toBe("AWAITING_APPROVAL");

  const decisionKey = randomUUID();
  const action = { action: "APPROVE_PRICE" as const, expectedVersion: intake.version };
  const approved = await customer.pilotAction(booked.id, action, { idempotencyKey: decisionKey });
  expect(approved).toMatchObject({ status: "INTAKE_COMPLETE", totalMinor: 36000, proposedTotalMinor: null, paymentStatus: "UNPAID" });
  expect((await customer.pilotAction(booked.id, action, { idempotencyKey: decisionKey })).version).toBe(approved.version);
  const inCare = await operator.pilotAction(booked.id, { action: "START_CARE", expectedVersion: approved.version });
  expect(inCare.status).toBe("IN_CARE");
  // Pilot orders must never silently enter the legacy prepayment flow.
  await expect(customer.createCheckout(booked.id)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  const stored = (await getPool().query("SELECT data FROM pilot_orders WHERE id=$1", [booked.id])).rows[0].data;
  expect(stored).toMatchObject({ status: "IN_CARE", paymentStatus: "UNPAID", totalMinor: 36000 });
  expect(Number((await getPool().query("SELECT COUNT(*) AS n FROM payments WHERE order_id=$1", [booked.id])).rows[0].n)).toBe(0);
});
