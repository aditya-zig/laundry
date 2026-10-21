import { chromium } from "@playwright/test";

/**
 * Read-only regression for the operations refresh path.
 *
 * The console must make a failed refresh visible, keep the last known order
 * state on screen, and recover when the next manual refresh succeeds. This
 * script does not change an order. It only signs in, selects an order, aborts
 * the API route in the browser, and reloads the same view.
 *
 * Environment:
 *   PILOT_CONSOLE_URL           default http://localhost:5175/
 *   PILOT_ORDER_ID              optional. Without it the first queue row is used.
 *   PILOT_EXPECTED_STATUS_LABEL optional visible label, for example "On the way back".
 *   PILOT_EXPECTED_VERSION      optional expected detail version.
 */

const CONSOLE_URL = process.env.PILOT_CONSOLE_URL ?? "http://localhost:5175/";
const ORDER_ID = process.env.PILOT_ORDER_ID;
const EXPECTED_STATUS_LABEL = process.env.PILOT_EXPECTED_STATUS_LABEL;
const EXPECTED_VERSION = process.env.PILOT_EXPECTED_VERSION;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function log(message) {
  console.log(`[pilot-offline] ${message}`);
}

async function selectedVersion(page) {
  return (
    await page
      .locator(".detail-grid > div")
      .filter({ hasText: "Version" })
      .locator("dd")
      .innerText()
  ).trim();
}

async function selectedStatus(page) {
  return (await page.locator(".detail-head .pill").innerText()).trim();
}

async function refresh(page) {
  await page.getByRole("button", { name: "Refresh" }).click();
}

async function waitForBanner(page, timeout = 5_000) {
  await page.waitForSelector("[data-refresh-error]", { state: "visible", timeout });
}

async function waitForRecovery(page, timeout = 8_000) {
  await page.waitForSelector("[data-refresh-error]", { state: "detached", timeout });
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  const failedRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (request.url().includes("/v1/")) {
      failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`);
    }
  });

  try {
    const url = new URL(CONSOLE_URL);
    url.searchParams.set("as", "operator");
    await page.goto(url.toString(), { waitUntil: "networkidle" });
    await page.waitForSelector(".queue-row", { timeout: 10_000 });

    const row = ORDER_ID
      ? page.locator(`.queue-row[data-order-id="${ORDER_ID}"]`)
      : page.locator(".queue-row").first();
    assert((await row.count()) === 1, ORDER_ID ? `order ${ORDER_ID} is not in the operations queue` : "operations queue is empty");
    const selectedId = await row.getAttribute("data-order-id");
    assert(selectedId, "selected order has no data-order-id");
    await row.click();
    await page.waitForSelector(`.detail-head h2:text("Order ${selectedId.slice(0, 8)}")`);

    const pillBefore = await selectedStatus(page);
    const versionBefore = await selectedVersion(page);
    const stampBefore = (await page.locator(".head-tools .stamp").innerText()).trim();
    log(`before outage: order ${selectedId}, ${pillBefore}, version ${versionBefore}, ${stampBefore}`);
    if (EXPECTED_STATUS_LABEL) {
      assert(
        pillBefore.toLowerCase() === EXPECTED_STATUS_LABEL.toLowerCase(),
        `expected status "${EXPECTED_STATUS_LABEL}", got "${pillBefore}"`,
      );
    }
    if (EXPECTED_VERSION) {
      assert(versionBefore === EXPECTED_VERSION, `expected version ${EXPECTED_VERSION}, got "${versionBefore}"`);
    }

    await page.route("**/v1/**", (route) => route.abort("failed"));
    await refresh(page);
    try {
      await waitForBanner(page);
    } catch (error) {
      const stampAfter = (await page.locator(".head-tools .stamp").innerText()).trim();
      const bannerCount = await page.locator("[data-refresh-error]").count();
      const notice = (await page.locator(".notice").innerText()).trim();
      log(`red: stamp after failed refresh "${stampAfter}", banner count ${bannerCount}`);
      log(`red: notice "${notice || "(empty)"}"`);
      log(`red: failed requests ${JSON.stringify(failedRequests.slice(-4))}`);
      throw new Error(`failed refresh was not shown in the UI: ${error.message}`);
    }
    const bannerText = (await page.locator("[data-refresh-error]").innerText()).replace(/\s+/g, " ").trim();
    const stampAfter = (await page.locator(".head-tools .stamp").innerText()).trim();
    const versionAfter = await selectedVersion(page);
    const pillAfter = await selectedStatus(page);
    assert(/Refresh failed/i.test(bannerText), `banner did not name the failure: "${bannerText}"`);
    assert(/last known/i.test(bannerText), `banner did not mark the data as last known: "${bannerText}"`);
    assert(/stale/i.test(stampAfter), `stamp did not mark the view stale: "${stampAfter}"`);
    assert(versionAfter === versionBefore, `last known version changed from ${versionBefore} to ${versionAfter}`);
    assert(pillAfter === pillBefore, `last known status changed from "${pillBefore}" to "${pillAfter}"`);
    log(`offline state: ${stampAfter}; ${bannerText}`);

    await page.unroute("**/v1/**");
    await refresh(page);
    await waitForRecovery(page);
    const versionRecovered = await selectedVersion(page);
    const stampRecovered = (await page.locator(".head-tools .stamp").innerText()).trim();
    assert(versionRecovered === versionBefore, `version changed after recovery: ${versionRecovered}`);
    assert(!/stale/i.test(stampRecovered), `stamp stayed stale after recovery: "${stampRecovered}"`);
    log(`network recovery: version ${versionRecovered}, ${stampRecovered}`);

    await page.route("**/v1/pilot/orders", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) }),
    );
    await refresh(page);
    await waitForBanner(page);
    const parseBanner = (await page.locator("[data-refresh-error]").innerText()).replace(/\s+/g, " ").trim();
    assert(/Refresh failed/i.test(parseBanner), `parse failure was not named: "${parseBanner}"`);
    log(`parse failure visible: ${parseBanner}`);

    await page.unroute("**/v1/pilot/orders");
    await refresh(page);
    await waitForRecovery(page);
    assert((await selectedVersion(page)) === versionBefore, "version changed after parse recovery");
    log(`parse recovery: version ${versionBefore}`);

    if (consoleErrors.length > 0) {
      log(`browser console errors observed during outage: ${consoleErrors.length}`);
      for (const line of consoleErrors.slice(0, 3)) log(line);
    }
    log("PASS");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`[pilot-offline] FAIL: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
