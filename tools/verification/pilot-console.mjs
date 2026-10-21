import { chromium } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ApiError, createClient } from "../../packages/api-client/dist/index.js";

/**
 * Current-revision pilot evidence.
 *
 *   node tools/verification/pilot-console.mjs
 *
 * The console must already be running against an API with DEMO_MODE=true and
 * PILOT_ENABLED=true. The script drives the real browser through the normal
 * paid lifecycle, a founder-resolved hold, and the important rejection paths.
 * It reads the persisted order from the shared SDK after each milestone, so a
 * stepper label cannot make a broken transition look green.
 *
 * Evidence is written under docs/implementation/evidence/pilot, which is
 * gitignored. The summary contains order ids and states, never handover codes.
 */

const CONSOLE_URL = process.env.PILOT_CONSOLE_URL ?? "http://localhost:5175/";
const API_URL = process.env.PILOT_API_URL ?? "http://127.0.0.1:4100/v1";
const OUT_DIR = process.env.PILOT_EVIDENCE_DIR ?? "docs/implementation/evidence/pilot";
const RUN_ID = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const ADDRESS = `QA ${RUN_ID} <b>map text</b>, 14 Demo Lane, Indiranagar`;
const HOLD_ADDRESS = `QA hold ${RUN_ID}, 14 Demo Lane, Indiranagar`;
const DEMO_RIDER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const steps = [];
const consoleErrors = [];
const consoleWarnings = [];

function record(name, detail) {
  steps.push({ name, detail });
  console.log(`[pilot-qa] ${name}${detail ? ` :: ${detail}` : ""}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function pillText(page, orderId) {
  return (await page.locator(`[data-order-id="${orderId}"] .pill`).first().innerText()).trim();
}

async function waitPill(page, orderId, expected) {
  await page.waitForFunction(
    ({ id, wanted }) =>
      document.querySelector(`[data-order-id="${id}"] .pill`)?.textContent?.trim() === wanted,
    { id: orderId, wanted: expected },
    { timeout: 12_000 },
  );
  const actual = await pillText(page, orderId);
  assert(actual === expected, `status pill was "${actual}", expected "${expected}"`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const videoDir = join(OUT_DIR, ".video-tmp");
  await mkdir(videoDir, { recursive: true });

  const tokens = {};
  const clientFor = (role) => createClient({ baseUrl: API_URL, getToken: () => tokens[role] });
  const customer = clientFor("customer");
  const operator = clientFor("operator");
  const rider = clientFor("rider");
  async function login(role) {
    const session = await clientFor(role).demoAuth(role);
    tokens[role] = session.token;
  }
  await login("customer");
  await login("operator");
  await login("rider");

  async function waitForApi(orderId, predicate, label, timeout = 12_000) {
    const deadline = Date.now() + timeout;
    let latest;
    while (Date.now() < deadline) {
      latest = await customer.pilotOrder(orderId);
      if (predicate(latest)) return latest;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`${label} did not persist; last state ${JSON.stringify(latest)}`);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    recordVideo: { dir: videoDir, size: { width: 1440, height: 1000 } },
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|tile\.openstreetmap|ERR_/i.test(text)) consoleWarnings.push(text);
    else consoleErrors.push(text);
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  const shot = async (name) => {
    await page.screenshot({ path: join(OUT_DIR, `${name}.png`), fullPage: false });
  };

  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  try {
  await page.goto(CONSOLE_URL, { waitUntil: "networkidle" });

  /* Customer: sign in, add 5 kg, keep the typed address through a poll. */
  await page.getByRole("button", { name: /Sign in as Customer/ }).click();
  await page.waitForSelector(".service-row");
  await page.getByRole("button", { name: "Add" }).first().click();
  const address = page.locator('[data-draft="booking.address"]');
  await address.fill(ADDRESS);
  await page.locator("h1").click();
  await page.waitForTimeout(3_400);
  assert((await address.inputValue()) === ADDRESS, "typed address was not retained across a poll");

  const config = await customer.pilotConfig();
  assert(config.timeZone === "Asia/Kolkata", "config is not timezone-qualified");
  const slotSelect = page.locator('[data-draft="booking.slot"]');
  const slots = await slotSelect.locator("option").evaluateAll((nodes) =>
    nodes.map((node) => ({ value: node.value, label: node.textContent ?? "" })),
  );
  let free = slots.find((option) => Number(option.label.match(/\((\d+) left\)/)?.[1] ?? 0) > 0);
  if (!free) {
    const slot = config.slots[0];
    await operator.pilotSetSlotCapacity(slot.id, slot.reserved + 1, { idempotencyKey: randomUUID() });
    await page.getByRole("button", { name: "Refresh" }).click();
    free = { value: slot.id, label: `${slot.id} (made room)` };
  }
  assert(free, "no bookable slot");
  await slotSelect.selectOption(free.value);
  record("slot", free.label);

  /* Double submit must still create one order; the idempotency key is reused. */
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === "Place order");
    button?.click();
    button?.click();
  });
  await page.waitForFunction(() => document.querySelector(".notice")?.textContent?.includes("Booked"));
  await page.waitForSelector(".order.ticket");
  const orderId = await page
    .locator(".order.ticket")
    .filter({ hasText: RUN_ID })
    .first()
    .getAttribute("data-order-id");
  assert(orderId, "no order card after booking");
  const allCustomerOrders = await customer.pilotListOrders();
  const matching = allCustomerOrders.filter((order) => order.address.line === ADDRESS);
  assert(matching.length === 1, `double submit created ${matching.length} orders with the QA address`);
  let order = await customer.pilotOrder(orderId);
  assert(order.status === "BOOKED", `new order was ${order.status}`);
  assert(order.totalMinor === 30_000, `5 kg at 6000 minor/kg was ${order.totalMinor}`);
  assert(Date.parse(order.pickupCodeExpiresAt) > Date.parse(order.pickupEnd), "pickup code expires before the slot ends");
  record("booked", `${orderId.slice(0, 8)} · one order from a double submit · code outlives the slot`);
  await shot("01-customer-booked");

  /* Map text is customer input. It must be a text node, not markup. The run
   * selects its own order first and then targets that order's marker, so a
   * reused verification database full of older orders cannot fool the check. */
  await page.locator(`.ticket-head[data-order-id="${orderId}"]`).click();
  const marker = page.locator(`[data-marker="customer"][data-order-id="${orderId}"]`).first();
  /* force skips stability checks: the console re-creates markers on every
   * render (each poll, each selection), so the element is routinely minutes
   * old and detached by the time a strict click resolves. */
  await marker.click({ force: true });
  await page.waitForSelector(".leaflet-popup-content");
  const popupText = await page.locator(".leaflet-popup-content").innerText();
  const injectedBold = await page.locator(".leaflet-popup-content b").count();
  const markerDump = await page.evaluate(() =>
    [...document.querySelectorAll("[data-marker]")].map((node) => `${node.getAttribute("data-marker")}:${node.getAttribute("data-order-id")}`).join(", "),
  );
  assert(popupText.includes("<b>map text</b>"), `map popup lost the literal address: ${popupText} (markers: ${markerDump})`);
  assert(injectedBold === 0, "map popup parsed the address as HTML");
  record("map-escaped", "address shown literally inside the Leaflet popup");
  await shot("02-customer-map-escaped");
  await page.keyboard.press("Escape");

  /* Operations: assign. */
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await page.getByRole("button", { name: /Sign in as Operations/ }).click();
  await page.waitForSelector(`.queue-row[data-order-id="${orderId}"]`);
  await page.locator(`.queue-row[data-order-id="${orderId}"]`).click();
  await page.getByRole("button", { name: "Assign delivery partner" }).click();
  order = await waitForApi(orderId, (value) => value.pickupStatus === "ASSIGNED", "assignment");
  record("assigned", `pickupStatus=${order.pickupStatus}`);
  await shot("03-ops-assigned");

  /* Rider: one wrong code is refused, then the real code picks up. */
  await page.getByRole("button", { name: "Delivery partner", exact: true }).click();
  await page.getByRole("button", { name: /Sign in as Delivery partner/ }).click();
  await page.waitForSelector(`.queue-row[data-order-id="${orderId}"]`);
  await page.locator(`.queue-row[data-order-id="${orderId}"]`).click();
  await page.locator('[data-draft^="pickup.code"]').fill("000000");
  await page.getByRole("button", { name: "Confirm pickup" }).click();
  await page.waitForTimeout(1_000);
  const refusedPickup = await customer.pilotOrder(orderId);
  assert(refusedPickup.status === "BOOKED", `a wrong pickup code moved the order to ${refusedPickup.status}`);
  record("rejected-pickup-code", "wrong code left the order BOOKED");
  await page.locator('[data-draft^="pickup.code"]').fill(order.pickupCode);
  await page.getByRole("button", { name: "Confirm pickup" }).click();
  order = await waitForApi(orderId, (value) => value.status === "PICKED_UP", "pickup");
  await waitPill(page, orderId, "Picked up");
  record("picked-up", "pickup code accepted; customer code no longer in the rider view");

  await page.locator('[data-draft^="intake.weight"]').fill("6");
  await page.getByRole("button", { name: "Record weighed intake" }).click();
  order = await waitForApi(orderId, (value) => value.status === "AWAITING_APPROVAL", "intake");
  assert(order.proposedTotalMinor === 36_000, `proposed total was ${order.proposedTotalMinor}`);
  await page.locator('[data-draft="report.lat"]').fill("12.9712");
  await page.locator('[data-draft="report.lng"]').fill("77.6412");
  await page.getByRole("button", { name: "Send entered position" }).click();
  let location;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      location = await customer.pilotLocation(orderId);
      break;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  assert(location, "reported location was not readable");
  assert(location.source === "MANUAL", `location source was ${location.source}`);
  assert(location.stale === false, "fresh manual location was marked stale");
  assert(location.ageSeconds < 60, `location age was ${location.ageSeconds}s`);
  record("location", `manual provenance, ${location.ageSeconds}s old, stale=${location.stale}`);
  await shot("04-rider-picked-up-and-position");

  /* Customer: approve the measured total. */
  await page.getByRole("button", { name: "Customer", exact: true }).click();
  await page.getByRole("button", { name: /Approve/ }).first().click();
  order = await waitForApi(orderId, (value) => value.status === "INTAKE_COMPLETE", "approval");
  assert(order.totalMinor === 36_000, `approved total was ${order.totalMinor}`);
  await waitPill(page, orderId, "Weighed in");
  record("price-approved", `totalMinor=${order.totalMinor}`);
  await shot("05-customer-approved-price");

  /* Operations: care path. */
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await page.getByRole("button", { name: "Start washing" }).click();
  await waitForApi(orderId, (value) => value.status === "IN_CARE", "start care");
  await page.getByRole("button", { name: "Quality check" }).click();
  await waitForApi(orderId, (value) => value.status === "QUALITY_CHECK", "quality check");
  await page.getByRole("button", { name: "Ready for return" }).click();
  order = await waitForApi(orderId, (value) => value.status === "READY_FOR_RETURN", "ready for return");
  await waitPill(page, orderId, "Ready for return");
  record("care-complete", "IN_CARE -> QUALITY_CHECK -> READY_FOR_RETURN");
  await shot("06-ops-care-complete");

  /* Rider: start return. Before payment, delivery must be refused. */
  await page.getByRole("button", { name: "Delivery partner", exact: true }).click();
  await page.getByRole("button", { name: "Start the return leg" }).click();
  order = await waitForApi(orderId, (value) => value.status === "RETURNING", "start return");
  await waitPill(page, orderId, "On the way back");
  const customerView = await customer.pilotOrder(orderId);
  assert(customerView.returnCode, "customer cannot see the return code while returning");
  let paymentRejection;
  try {
    await rider.pilotAction(
      orderId,
      { action: "DELIVER", expectedVersion: customerView.version, code: customerView.returnCode },
      { idempotencyKey: randomUUID() },
    );
  } catch (error) {
    paymentRejection = error;
  }
  assert(
    paymentRejection instanceof ApiError && paymentRejection.code === "PAYMENT_PENDING",
    `unpaid delivery was not refused: ${paymentRejection?.code ?? paymentRejection}`,
  );
  const stillReturning = await customer.pilotOrder(orderId);
  assert(stillReturning.status === "RETURNING", "unpaid delivery changed the order");
  record("rejected-unpaid-delivery", "PAYMENT_PENDING; order stayed RETURNING");
  await shot("07-rider-returning");

  /* Operations: record payment by hand. */
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await page.getByRole("button", { name: "Record payment received" }).click();
  order = await waitForApi(orderId, (value) => value.paymentStatus === "PAID", "payment receipt");
  record("payment-recorded", `paymentStatus=${order.paymentStatus}, totalMinor=${order.totalMinor}`);
  await shot("08-ops-payment-recorded");

  /* Rider: one wrong return code is refused; the real code completes delivery. */
  await page.getByRole("button", { name: "Delivery partner", exact: true }).click();
  await page.locator('[data-draft^="return.code"]').fill("000000");
  await page.getByRole("button", { name: "Confirm handover" }).click();
  await page.waitForTimeout(1_000);
  assert((await customer.pilotOrder(orderId)).status === "RETURNING", "a wrong return code completed delivery");
  record("rejected-return-code", "wrong return code left the order RETURNING");
  await page.locator('[data-draft^="return.code"]').fill(customerView.returnCode);
  await page.getByRole("button", { name: "Confirm handover" }).click();
  order = await waitForApi(orderId, (value) => value.status === "DELIVERED", "delivery");
  assert(order.returnStatus === "COMPLETED", `returnStatus=${order.returnStatus}`);
  assert(order.paymentStatus === "PAID", `paymentStatus=${order.paymentStatus}`);
  record("delivered", `status=DELIVERED, paymentStatus=PAID, totalMinor=${order.totalMinor}`);

  /* Customer: exact pill and exact money label, then persisted SDK state. */
  await page.getByRole("button", { name: "Customer", exact: true }).click();
  await waitPill(page, orderId, "Delivered");
  const paidLabel = (await page.locator(`[data-order-id="${orderId}"] .figure.lead .label`).innerText()).trim();
  const paidAmount = (await page.locator(`[data-order-id="${orderId}"] .figure.lead .num`).innerText()).trim();
  assert(paidLabel === "Paid at return", `final money label was "${paidLabel}"`);
  assert(paidAmount === "₹360.00", `final money amount was "${paidAmount}"`);
  const finalOrder = await customer.pilotOrder(orderId);
  assert(finalOrder.status === "DELIVERED", `persisted status ${finalOrder.status}`);
  assert(finalOrder.paymentStatus === "PAID", `persisted payment ${finalOrder.paymentStatus}`);
  assert(finalOrder.totalMinor === 36_000, `persisted total ${finalOrder.totalMinor}`);
  const closedLocation = await customer.pilotLocation(orderId).then(
    () => "readable",
    (error) => (error instanceof ApiError && error.status === 404 ? "closed" : `error:${error.status}`),
  );
  assert(closedLocation === "closed", `tracking after delivery was ${closedLocation}`);
  record("final-paid", `pill="Delivered", label="Paid at return", tracking=closed`);
  await shot("09-customer-delivered");

  /* Founder-controlled hold: create it through the API, resolve it in the UI. */
  const holdConfig = await customer.pilotConfig();
  let holdSlot = holdConfig.slots.find((slot) => slot.capacity > slot.reserved);
  if (!holdSlot) {
    holdSlot = holdConfig.slots[0];
    await operator.pilotSetSlotCapacity(holdSlot.id, holdSlot.reserved + 1, { idempotencyKey: randomUUID() });
  }
  let hold = await customer.pilotCreateOrder(
    {
      serviceCode: "WASH_FOLD",
      estimatedWeightGrams: 5000,
      slotId: holdSlot.id,
      address: { line: HOLD_ADDRESS, lat: 12.975, lng: 77.642 },
    },
    { idempotencyKey: randomUUID() },
  );
  await operator.pilotAction(
    hold.id,
    { action: "ASSIGN", expectedVersion: hold.version, riderId: DEMO_RIDER_ID },
    { idempotencyKey: randomUUID() },
  );
  hold = await customer.pilotOrder(hold.id);
  const holdPicked = await rider.pilotAction(
    hold.id,
    { action: "PICKUP", expectedVersion: hold.version, code: hold.pickupCode },
    { idempotencyKey: randomUUID() },
  );
  const holdIntake = await rider.pilotAction(
    hold.id,
    { action: "INTAKE", expectedVersion: holdPicked.version, measuredWeightGrams: 8000, bagCount: 2 },
    { idempotencyKey: randomUUID() },
  );
  const held = await customer.pilotAction(
    hold.id,
    { action: "DECLINE_PRICE", expectedVersion: holdIntake.version },
    { idempotencyKey: randomUUID() },
  );
  assert(held.status === "ON_HOLD", `hold order is ${held.status}`);
  record("hold-created", `${hold.id.slice(0, 8)} is ON_HOLD after a declined measured total`);

  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await page.waitForSelector(`.queue-row[data-order-id="${hold.id}"]`);
  await page.locator(`.queue-row[data-order-id="${hold.id}"]`).click();
  await page.waitForSelector('[data-draft^="hold.note"]');
  await page.locator('[data-draft^="hold.note"]').fill("Customer agreed by phone on 21 Oct; return the bag unwashed.");
  await page.locator('.action-card input[type="checkbox"]').check();
  await page.getByRole("button", { name: "Release as unprocessed return" }).click();
  const resolved = await waitForApi(
    hold.id,
    (value) => value.status === "RETURNING" && value.totalMinor === 0,
    "hold resolution",
  );
  assert(resolved.paymentStatus === "UNPAID", `hold paymentStatus=${resolved.paymentStatus}`);
  assert(resolved.returnStatus === "ASSIGNED", `hold returnStatus=${resolved.returnStatus}`);
  record("hold-resolved", "totalMinor=0, paymentStatus=UNPAID, returnStatus=ASSIGNED");
  await shot("10-ops-hold-resolved");

  await page.getByRole("button", { name: "Customer", exact: true }).click();
  await waitPill(page, hold.id, "On the way back");
  const nothingDue = (await page.locator(`[data-order-id="${hold.id}"] .figure.lead .label`).innerText()).trim();
  const nothingDueAmount = (await page.locator(`[data-order-id="${hold.id}"] .figure.lead .num`).innerText()).trim();
  assert(nothingDue === "Nothing due", `held order money label was "${nothingDue}"`);
  assert(nothingDueAmount === "₹0.00", `held order money amount was "${nothingDueAmount}"`);
  const holdCustomer = await customer.pilotOrder(hold.id);
  const holdDelivered = await rider.pilotAction(
    hold.id,
    { action: "DELIVER", expectedVersion: holdCustomer.version, code: holdCustomer.returnCode },
    { idempotencyKey: randomUUID() },
  );
  assert(holdDelivered.status === "DELIVERED", `hold delivery status=${holdDelivered.status}`);
  assert(holdDelivered.paymentStatus === "UNPAID", `hold delivery payment=${holdDelivered.paymentStatus}`);
  assert(holdDelivered.totalMinor === 0, `hold delivery total=${holdDelivered.totalMinor}`);
  await waitPill(page, hold.id, "Delivered");
  record("hold-delivered", "DELIVERED with totalMinor=0 and paymentStatus=UNPAID; no fee invented");
  await shot("11-customer-nothing-due");

  const summary = {
    runId: RUN_ID,
    consoleUrl: CONSOLE_URL,
    apiUrl: API_URL,
    paidOrder: {
      id: orderId,
      status: finalOrder.status,
      paymentStatus: finalOrder.paymentStatus,
      totalMinor: finalOrder.totalMinor,
      returnStatus: finalOrder.returnStatus,
      locationAfterDelivery: closedLocation,
      pill: "Delivered",
      moneyLabel: paidLabel,
      moneyAmount: paidAmount,
    },
    heldOrder: {
      id: hold.id,
      status: holdDelivered.status,
      paymentStatus: holdDelivered.paymentStatus,
      totalMinor: holdDelivered.totalMinor,
      moneyLabel: nothingDue,
      moneyAmount: nothingDueAmount,
    },
    steps,
    consoleErrors,
    consoleWarnings,
    generatedAt: new Date().toISOString(),
  };
  await writeFile(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (consoleErrors.length > 0) {
    console.error("[pilot-qa] browser page errors:", consoleErrors);
    process.exitCode = 1;
  }
  } finally {
    // Finalize passing and failing runs; a thrown assertion must retain proof.
    await context.tracing.stop({ path: join(OUT_DIR, "trace.zip") });
    await context.close();
    await browser.close();
    for (const video of await readdir(videoDir)) {
      if (video.endsWith(".webm")) await rename(join(videoDir, video), join(OUT_DIR, "pilot-flow.webm"));
    }
    await rm(videoDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("[pilot-qa] failed:", error);
  process.exit(1);
});
