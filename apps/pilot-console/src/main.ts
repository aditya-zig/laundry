import "./styles.css";
import {
  ApiFailure,
  PilotApi,
  type PilotAction,
  type PilotBooking,
  type PilotConfig,
  type PilotLocation,
  type PilotLocationReport,
  type PilotOrder,
  type PilotRider,
  type Role,
} from "./api";
import { PilotMap, type MarkerSpec } from "./map";
import { fmtDateTime, fmtTime, h, kg, money, shortId, statusLabel } from "./ui";

/** Every surface here is a demo: demo sign-in, unapproved per-kg rates, a
 * manually recorded payment receipt and no real delivery. The banner in the
 * shell says so on every screen. */

const params = new URLSearchParams(globalThis.location.search);
// The console talks to its own /v1 proxy. A URL parameter must not be able to
// point a reviewer's session at another host.
const baseUrl = "/v1";

/** Seeded demo delivery partner. modules/shared/src/db.ts DEMO_IDS.riderId. */
const DEMO_RIDER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

interface Intent {
  key: string;
  payload: string;
}

interface RoleState {
  role: Role;
  api: PilotApi;
  signedIn: boolean;
  orders: PilotOrder[];
  config?: PilotConfig;
  riders: PilotRider[];
  selectedId?: string;
  /** The position currently shown, and the order it belongs to. A position
   * from a previously selected order must never stay on the map. */
  location: PilotLocation | null;
  locationOrderId?: string;
  notice?: { kind: "error" | "ok"; text: string };
  busy: boolean;
  /** Typed values, kept so a re-render never eats what someone half typed. */
  drafts: Record<string, string>;
  /** One idempotency key per intent, reused until the server answers. */
  intents: Map<string, Intent>;
  /** Fingerprint of what is on screen. The panel is only rebuilt when this
   * changes, so a poll cannot replace the button somebody is about to click. */
  fingerprint?: string;
  /** When the last successful read landed, shown as the screen's stamp. */
  updatedAt?: string;
  /** The last refresh failure. Kept until a read succeeds so the screen can
   * mark the visible data as last known instead of current. */
  refreshError?: string;
}

function emptyState(role: Role): RoleState {
  return {
    role,
    api: new PilotApi(baseUrl),
    signedIn: false,
    orders: [],
    riders: [],
    location: null,
    busy: false,
    drafts: {},
    intents: new Map(),
  };
}

const state: Record<Role, RoleState> = {
  customer: emptyState("customer"),
  operator: emptyState("operator"),
  rider: emptyState("rider"),
};

let activeRole: Role = "customer";
let pilotMap: PilotMap | undefined;
let noticeEl: HTMLElement | undefined;
let panelEl: HTMLElement | undefined;

/* ---------------------------------------------------------------- helpers */

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

function showNotice(kind: "error" | "ok", text: string): void {
  const current = state[activeRole];
  current.notice = { kind, text };
  renderNotice();
  if (noticeTimer) clearTimeout(noticeTimer);
  if (kind === "ok") {
    noticeTimer = setTimeout(() => {
      if (state[activeRole].notice?.text === text) {
        state[activeRole].notice = undefined;
        renderNotice();
      }
    }, 8000);
  }
}

function renderNotice(): void {
  if (!noticeEl) return;
  const current = state[activeRole];
  noticeEl.textContent = "";
  noticeEl.className = current.notice ? `notice ${current.notice.kind}` : "notice";
  if (current.notice) noticeEl.append(current.notice.text);
}

/** One key per intent. A double click, a retry after an unknown network
 * outcome or a reconnect all reuse the key, so the server can replay the
 * first answer instead of booking twice. */
function intentKey(current: RoleState, scope: string, payload: unknown): string {
  const fingerprint = JSON.stringify(payload ?? null);
  const existing = current.intents.get(scope);
  if (existing && existing.payload === fingerprint) return existing.key;
  const key = crypto.randomUUID();
  current.intents.set(scope, { key, payload: fingerprint });
  return key;
}

function clearIntent(current: RoleState, scope: string): void {
  current.intents.delete(scope);
}

async function withBusy(fn: () => Promise<void>): Promise<void> {
  const current = state[activeRole];
  if (current.busy) return;
  current.busy = true;
  renderPanel();
  try {
    await fn();
  } catch (error) {
    if (error instanceof ApiFailure) {
      const trace = error.traceId ? ` (trace ${error.traceId})` : "";
      showNotice("error", `${error.code}: ${error.message}${trace}`);
    } else {
      showNotice("error", error instanceof Error ? error.message : String(error));
    }
  } finally {
    current.busy = false;
    renderPanel();
  }
}

function draftValue(current: RoleState, key: string, fallback: string): string {
  return current.drafts[key] ?? fallback;
}

function draftInput(
  current: RoleState,
  key: string,
  fallback: string,
  attrs: Record<string, string | number> = {},
): HTMLInputElement {
  const input = h("input", { type: "text", ...attrs });
  input.value = draftValue(current, key, fallback);
  input.setAttribute("data-draft", key);
  input.addEventListener("input", () => {
    current.drafts[key] = input.value;
  });
  return input;
}

function draftTextarea(
  current: RoleState,
  key: string,
  fallback: string,
  attrs: Record<string, string | number> = {},
): HTMLTextAreaElement {
  const area = h("textarea", { rows: "3", ...attrs });
  area.value = draftValue(current, key, fallback);
  area.setAttribute("data-draft", key);
  area.addEventListener("input", () => {
    current.drafts[key] = area.value;
  });
  return area;
}

function draftSelect(
  current: RoleState,
  key: string,
  options: { value: string; label: string }[],
  fallback?: string,
): HTMLSelectElement {
  const select = h("select", {});
  for (const option of options) select.append(h("option", { value: option.value }, option.label));
  const wanted = draftValue(current, key, fallback ?? options[0]?.value ?? "");
  if ([...select.options].some((option) => option.value === wanted)) select.value = wanted;
  select.setAttribute("data-draft", key);
  select.addEventListener("change", () => {
    current.drafts[key] = select.value;
  });
  return select;
}

/** True while someone is typing. The poll must not replace the panel then. */
function isEditing(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  if (!["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName)) return false;
  return !!panelEl?.contains(active);
}

function captureFocus(): { key?: string; start?: number | null; end?: number | null } {
  const active = document.activeElement as HTMLInputElement | null;
  const key = active?.dataset?.draft;
  if (!active || !key) return {};
  return { key, start: active.selectionStart, end: active.selectionEnd };
}

function restoreFocus(saved: { key?: string; start?: number | null; end?: number | null }): void {
  if (!saved.key || !panelEl) return;
  const el = panelEl.querySelector(`[data-draft="${saved.key}"]`) as HTMLInputElement | null;
  if (!el) return;
  el.focus();
  if (saved.start !== undefined && saved.start !== null && typeof el.setSelectionRange === "function") {
    try {
      el.setSelectionRange(saved.start, saved.end ?? saved.start);
    } catch {
      // Select elements do not support a text selection.
    }
  }
}

async function loadLocation(current: RoleState, orderId: string): Promise<void> {
  const location = await current.api.location(orderId);
  // A late answer for an order the user already left must not land on the map.
  if (current.selectedId !== orderId) return;
  current.location = location;
  current.locationOrderId = location ? orderId : undefined;
}

function refreshFailureMessage(error: unknown): string {
  const text =
    error instanceof ApiFailure
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : String(error);
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

async function refresh(): Promise<void> {
  const current = state[activeRole];
  if (!current.signedIn) return;
  try {
    const [config, orders] = await Promise.all([current.api.config(), current.api.listOrders()]);
    current.config = config;
    current.orders = orders;
    if (current.role === "operator") current.riders = await current.api.riders();
    if (!current.selectedId || !orders.some((o) => o.id === current.selectedId)) {
      current.selectedId = orders[0]?.id;
      current.location = null;
      current.locationOrderId = undefined;
    }
    const selected = orders.find((order) => order.id === current.selectedId);
    if (selected && trackingClosed(selected)) {
      current.location = null;
      current.locationOrderId = undefined;
    } else if (current.selectedId) {
      await loadLocation(current, current.selectedId);
    }
    current.refreshError = undefined;
    current.updatedAt = new Date().toISOString();
  } catch (error) {
    const message = refreshFailureMessage(error);
    current.refreshError = message;
    console.error("[pilot] refresh failed", error);
    const errorFingerprint = `refresh-error:${message}`;
    if (!isEditing() && current.fingerprint !== errorFingerprint) {
      current.fingerprint = errorFingerprint;
      const focus = captureFocus();
      renderPanel();
      restoreFocus(focus);
      renderMap();
    }
    return;
  }
  const fingerprint = JSON.stringify([
    current.orders.map((o) => [o.id, o.version, o.status, o.pickupStatus, o.returnStatus, o.paymentStatus, o.events.length]),
    current.config?.slots.map((s) => [s.id, s.capacity, s.reserved]),
  ]);
  if (!isEditing() && fingerprint !== current.fingerprint) {
    current.fingerprint = fingerprint;
    const focus = captureFocus();
    renderPanel();
    restoreFocus(focus);
  }
  renderMap();
}

async function signIn(role: Role): Promise<void> {
  await withBusy(async () => {
    const current = state[role];
    await current.api.demoLogin(role);
    current.signedIn = true;
    current.notice = undefined;
    await refresh();
    showNotice("ok", `Signed in as ${current.api.user?.name ?? role} (demo session)`);
  });
}

async function runAction(
  order: PilotOrder,
  action: PilotAction["action"],
  extra: Record<string, unknown> = {},
): Promise<void> {
  const current = state[activeRole];
  const scope = `action:${order.id}:${action}`;
  const payload = { action, expectedVersion: order.version, ...extra };
  const key = intentKey(current, scope, payload);
  await withBusy(async () => {
    await current.api.action(order.id, payload as PilotAction, key);
    clearIntent(current, scope);
    await refresh();
    showNotice("ok", `${action.replace(/_/g, " ").toLowerCase()} recorded`);
  });
}

function selectOrder(current: RoleState, id: string): void {
  current.selectedId = id;
  current.location = null;
  current.locationOrderId = undefined;
  renderPanel();
  renderMap();
  if (!trackingClosed(selectedOrder(current))) {
    void loadLocation(current, id).then(() => {
      renderPanel();
      renderMap();
    });
  }
}

function selectedOrder(current: RoleState): PilotOrder | undefined {
  return current.orders.find((o) => o.id === current.selectedId);
}

/* ------------------------------------------------------------------- shell */

const ROLES: Role[] = ["customer", "operator", "rider"];

function roleLabel(role: Role): string {
  return role === "operator" ? "Operations" : role === "rider" ? "Delivery partner" : "Customer";
}

function roleTitle(role: Role): string {
  return role === "operator" ? "Order queue" : role === "rider" ? "My jobs" : "Book a wash";
}

let navEl: HTMLElement | undefined;
let sessionEl: HTMLElement | undefined;
let mapCard: HTMLElement | undefined;

/** The order each role has to move next. Drives the nav count and the
 * subline, so both say the same number. */
function needsAction(role: Role, orders: PilotOrder[]): number {
  if (role === "customer") return orders.filter((order) => order.status === "AWAITING_APPROVAL").length;
  if (role === "operator") {
    return orders.filter(
      (order) =>
        (order.status === "BOOKED" && !order.riderId) ||
        ["INTAKE_COMPLETE", "IN_CARE", "QUALITY_CHECK", "RETURNING"].includes(order.status),
    ).length;
  }
  return orders.filter((order) => order.status === "BOOKED" || order.status === "RETURNING").length;
}

function buildShell(): void {
  const app = document.getElementById("app");
  if (!app) return;
  app.textContent = "";

  const mark = h("span", { class: "mark", "aria-hidden": "true" });
  // A laundry tag: the product's own object, drawn once in ink.
  mark.innerHTML =
    '<svg viewBox="0 0 24 24" width="28" height="28" focusable="false"><path d="M13 3h6.5A1.5 1.5 0 0 1 21 4.5v15a1.5 1.5 0 0 1-1.5 1.5H13L4.5 14.2V9.8L13 3Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="16.6" cy="6.6" r="1.3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

  navEl = h("nav", { class: "nav", "aria-label": "Console role" }, h("p", { class: "nav-label" }, "Console"));
  for (const role of ROLES) {
    const button = h("button", { class: "nav-item", type: "button", "data-role": role, "aria-label": roleLabel(role) });
    button.append(
      h("span", { class: "nav-full" }, roleLabel(role)),
      h("span", { class: "nav-short" }, role === "operator" ? "Operations" : role === "rider" ? "Delivery" : "Customer"),
    );
    const count = h("span", { class: "nav-count", hidden: true, "aria-hidden": "true" });
    button.append(count);
    button.addEventListener("click", () => {
      if (activeRole === role) return;
      activeRole = role;
      renderPanel();
      renderMap();
      void refresh();
    });
    navEl.append(button);
  }

  sessionEl = h("p", { class: "session" }, "Not signed in.");

  const sidebar = h(
    "aside",
    { class: "sidebar" },
    h(
      "div",
      { class: "brand" },
      mark,
      h("div", {}, h("strong", {}, "Laundry"), h("span", {}, "Laundry pilot · Indiranagar")),
    ),
    navEl,
    h(
      "div",
      { class: "sidebar-foot" },
      sessionEl,
      h(
        "p",
        { class: "demo-note" },
        "Demo build: demo sign-in, per-kg rates that are not approved, payment recorded by hand at return, no SMS, payment gateway or real delivery.",
      ),
    ),
  );

  noticeEl = h("div", { class: "notice" });
  panelEl = h("div", { class: "panel" });

  const mapEl = h("div", {
    class: "map",
    role: "img",
    "aria-label": "Map with the facility, the customer address and the latest position reported for the selected order",
  });
  const mapNote = h("div", { class: "map-note" });
  mapCard = h(
    "section",
    { class: "card map-card" },
    h("div", { class: "map-head" }, h("h2", {}, "Position"), h("span", { class: "stamp" }, "reported, not live tracking")),
    mapEl,
    mapNote,
  );

  app.append(
    h(
      "div",
      { class: "shell" },
      sidebar,
      h(
        "main",
        { class: "canvas" },
        h(
          "div",
          { class: "canvas-inner" },
          h(
            "p",
            { class: "mobile-demo" },
            "Demo: demo sign-in, unapproved per-kg rates, payment recorded by hand, no real SMS or delivery.",
          ),
          noticeEl,
          panelEl,
        ),
      ),
    ),
  );

  pilotMap = new PilotMap(mapEl, [12.9784, 77.6408]);
  pilotMap.onTileFailure = () => {
    mapNote.textContent =
      "Map tiles did not load. The markers are still the coordinates that were reported, but the street background is missing.";
  };
}

function renderSidebar(): void {
  if (!navEl) return;
  for (const button of navEl.querySelectorAll<HTMLButtonElement>("button[data-role]")) {
    const role = button.dataset.role as Role;
    button.classList.toggle("active", role === activeRole);
    const count = button.querySelector<HTMLElement>(".nav-count");
    if (!count) continue;
    const current = state[role];
    const value = current.signedIn ? needsAction(role, current.orders) : 0;
    count.hidden = value === 0;
    count.textContent = value > 0 ? String(value) : "";
  }
  if (sessionEl) {
    const current = state[activeRole];
    sessionEl.textContent = current.signedIn
      ? `Signed in as ${current.api.user?.name ?? roleLabel(activeRole)} (demo session).`
      : "Not signed in. Sign in with the demo session to open this role.";
  }
}

/* ------------------------------------------------------------------ panels */

function pageHead(title: string, sub: string, current: RoleState): HTMLElement {
  const stale = current.refreshError !== undefined;
  const stamp = current.updatedAt
    ? `Updated ${fmtTime(current.updatedAt)}${stale ? " · stale" : ""}`
    : stale
      ? "No successful read · stale"
      : "Not loaded yet";
  const refreshButton = h("button", { class: "ghost", type: "button" }, "Refresh");
  refreshButton.disabled = current.busy;
  refreshButton.addEventListener("click", () => void refresh());
  const header = h(
    "header",
    { class: "page-head" },
    h("div", {}, h("h1", {}, title), h("p", {}, sub)),
    h("div", { class: "head-tools" }, h("span", { class: stale ? "stamp stale" : "stamp" }, stamp), refreshButton),
  );
  if (!stale) return header;
  const lastKnown = current.updatedAt
    ? `Showing last known data from ${fmtTime(current.updatedAt)}.`
    : "Showing the signed-in shell because no read has succeeded yet.";
  return h(
    "div",
    {},
    header,
    h(
      "p",
      { class: "callout warn refresh-error", role: "alert", "data-refresh-error": "true" },
      `Refresh failed. ${lastKnown} Error: ${current.refreshError}. Use Refresh to retry.`,
    ),
  );
}

function figure(label: string, value: string, lead = false): HTMLElement {
  return h("div", { class: lead ? "figure lead" : "figure" }, h("span", { class: "label" }, label), h("span", { class: "num" }, value));
}

function renderPanel(): void {
  if (!panelEl) return;
  renderNotice();
  renderSidebar();
  panelEl.textContent = "";
  const current = state[activeRole];
  if (!current.signedIn) {
    panelEl.append(signInPanel(current.role, current));
    return;
  }
  if (current.role === "customer") panelEl.append(customerPanel(current));
  if (current.role === "operator") panelEl.append(operatorPanel(current));
  if (current.role === "rider") panelEl.append(riderPanel(current));
  requestAnimationFrame(() => pilotMap?.invalidate());
}

function signInPanel(role: Role, current: RoleState): HTMLElement {
  const button = h("button", { class: "primary", type: "button" }, `Sign in as ${roleLabel(role)} (demo)`);
  button.disabled = current.busy;
  button.addEventListener("click", () => void signIn(role));
  return h(
    "div",
    {},
    pageHead("Laundry pilot console", "A kilogram-priced laundry run for Indiranagar, Bengaluru.", current),
    h(
      "div",
      { class: "card signin" },
      h("h2", {}, `${roleLabel(role)} view`),
      h("p", {}, "This console signs in with the demo session for the seeded demo accounts. Nothing here is a production login."),
      button,
    ),
  );
}

function pill(text: string, kind = "neutral"): HTMLElement {
  return h("span", { class: `pill ${kind}` }, text);
}

function statusPill(order: PilotOrder): HTMLElement {
  const kind =
    order.status === "DELIVERED"
      ? "ok"
      : order.status === "ON_HOLD"
        ? "warn"
        : order.status === "CANCELLED"
          ? "bad"
          : "info";
  return pill(statusLabel(order.status), kind);
}

/* Seven states fold into five stages for the progress bar. The pill still
 * names the exact state; the bar only says how far the bag has travelled. */
const STAGES = ["Booked", "Picked up", "In care", "On the way back", "Delivered"];

function stageIndex(order: PilotOrder): number {
  switch (order.status) {
    case "BOOKED":
      return 0;
    case "PICKED_UP":
    case "AWAITING_APPROVAL":
    case "INTAKE_COMPLETE":
    case "ON_HOLD":
      return 1;
    case "IN_CARE":
    case "QUALITY_CHECK":
      return 2;
    case "READY_FOR_RETURN":
    case "RETURNING":
      return 3;
    case "DELIVERED":
      return 4;
    default:
      return 0;
  }
}

/** A compact stage strip on each rider job row: the first viewport carries
 * the same data hue as the detail card without opening a job. */
function rowProgress(order: PilotOrder): HTMLElement {
  const reached = stageIndex(order);
  const bar = h("span", { class: "progress-bar row-progress" });
  for (let index = 0; index < STAGES.length; index += 1) {
    bar.append(h("span", { class: index <= reached ? "done" : "" }));
  }
  return bar;
}

function progressBar(order: PilotOrder): HTMLElement {
  if (order.status === "CANCELLED") {
    return h("div", { class: "progress" }, h("p", { class: "progress-meta" }, h("span", {}, "Cancelled before pickup")));
  }
  const reached = stageIndex(order);
  const bar = h("div", { class: "progress-bar" });
  for (let index = 0; index < STAGES.length; index += 1) {
    bar.append(h("span", { class: index <= reached ? "done" : "" }));
  }
  return h(
    "div",
    { class: "progress" },
    bar,
    h(
      "p",
      { class: "progress-meta" },
      h("span", {}, `Step ${reached + 1} of ${STAGES.length} · `, h("strong", {}, statusLabel(order.status))),
      h("span", {}, STAGES[reached]),
    ),
  );
}

function timeline(order: PilotOrder): HTMLElement {
  const list = h("ol", { class: "timeline" });
  for (const event of order.events) {
    list.append(h("li", {}, h("span", { class: "when" }, fmtTime(event.at)), event.label));
  }
  return list;
}

function historyCard(order: PilotOrder): HTMLElement {
  return h("details", {}, h("summary", {}, `History · ${order.events.length} events`), timeline(order));
}

function locationLine(current: RoleState): HTMLElement {
  const location = current.location;
  if (!location) return h("p", { class: "muted" }, "No position reported for this order yet.");
  const provenance = location.source === "BROWSER_GEOLOCATION"
    ? "self-reported browser location (not attested GPS)"
    : "position entered by hand (self-reported)";
  return h(
    "p",
    { class: location.stale ? "callout warn" : "muted" },
    `Delivery partner at ${location.lat}, ${location.lng} · ${provenance} · captured ${fmtTime(location.capturedAt)} (${location.ageSeconds}s ago${location.stale ? ", stale" : ""})`,
  );
}

function gramsFromKg(value: number): number {
  return Math.round(value * 1000);
}

/** Quote in integer grams, exactly as the API does. Multiplying a decimal kg
 * value by a rate can produce 600.0000000000001; the server never sees that
 * float, so the console must not show a different price. */
function quoteMinor(grams: number, rateMinorPerKg: number): number {
  return Math.ceil((grams * rateMinorPerKg) / 1000);
}

function directionsUrl(order: PilotOrder): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${order.address.lat},${order.address.lng}`;
}

function trackingClosed(order: PilotOrder | undefined): boolean {
  return !!order && (order.status === "DELIVERED" || order.status === "CANCELLED");
}

/* customer */

function customerPanel(current: RoleState): HTMLElement {
  const config = current.config;
  const services = config?.services ?? [];

  const search = draftInput(current, "shop.search", "", { type: "search", placeholder: "Search services" });
  const searchBar = h("div", { class: "searchbar" }, search);

  const activeChip = current.drafts["shop.chip"] ?? "ALL";
  const chips = h("div", { class: "chips" });
  const chipOptions = [{ code: "ALL", name: "All services" }, ...services.map((s) => ({ code: s.code, name: s.name }))];
  for (const option of chipOptions) {
    const chip = h("button", { class: option.code === activeChip ? "chip-item active" : "chip-item", type: "button" }, option.name);
    chip.addEventListener("click", () => {
      current.drafts["shop.chip"] = option.code;
      renderPanel();
    });
    chips.append(chip);
  }

  const needle = (current.drafts["shop.search"] ?? "").toLowerCase();
  const visible = services.filter(
    (service) =>
      (activeChip === "ALL" || activeChip === service.code) &&
      (needle === "" || service.name.toLowerCase().includes(needle) || service.code.toLowerCase().includes(needle)),
  );

  const list = h("div", { class: "service-list" });
  for (const service of visible) {
    const kgKey = `kg.${service.code}`;
    const kgValue = Number(draftValue(current, kgKey, "5"));
    const price = quoteMinor(gramsFromKg(kgValue), service.rateMinorPerKg);
    const minus = h("button", { class: "step", type: "button", "aria-label": `One half kilogram less of ${service.name}` }, "−");
    minus.disabled = current.busy || kgValue <= 0.5;
    minus.addEventListener("click", () => {
      current.drafts[kgKey] = String(Math.max(0.5, kgValue - 0.5));
      renderPanel();
    });
    const plus = h("button", { class: "step", type: "button", "aria-label": `One half kilogram more of ${service.name}` }, "+");
    plus.disabled = current.busy;
    plus.addEventListener("click", () => {
      current.drafts[kgKey] = String(kgValue + 0.5);
      renderPanel();
    });
    const kgLabel = h("span", { class: "kg" }, `${kgValue} kg`);
    const add = h("button", { class: "primary", type: "button" }, "Add");
    add.disabled = current.busy;
    add.addEventListener("click", () => {
      current.drafts["basket.service"] = service.code;
      current.drafts["basket.kg"] = String(kgValue);
      current.drafts["checkout.open"] = "1";
      renderPanel();
      showNotice("ok", `${service.name} · ${kgValue} kg added. Pick a slot and confirm below.`);
    });
    list.append(
      h(
        "div",
        { class: "service-row" },
        h(
          "div",
          { class: "service-text" },
          h("strong", {}, service.name),
          h("p", {}, `${money(service.rateMinorPerKg)} per kg · about 5-6 shirts per kg`),
        ),
        h("div", { class: "service-price" }, h("span", { class: "num" }, money(price)), h("span", {}, `${kgValue} kg`)),
        h("div", { class: "stepper" }, minus, kgLabel, plus),
        add,
      ),
    );
  }
  if (visible.length === 0) list.append(h("p", { class: "empty" }, "No service matches that search."));

  /* Basket and checkout live inside the services card: one card, one column,
   * so no short side card has to pretend to fill a row. */
  const basketService = services.find((s) => s.code === current.drafts["basket.service"]);
  const basketKg = Number(current.drafts["basket.kg"] ?? "5");
  const basketTotal = basketService ? quoteMinor(gramsFromKg(basketKg), basketService.rateMinorPerKg) : 0;

  const basketPanel = h("div", { class: "basket-panel" });

  if (!basketService) {
    basketPanel.append(
      h(
        "div",
        { class: "row between" },
        h("p", { class: "muted" }, "Nothing in the bag yet. Choose a service and a weight."),
        h("p", { class: "basket-hint" }, "Weighed at pickup · paid at return"),
      ),
    );
  } else {
    basketPanel.append(
      h(
        "div",
        { class: "row between" },
        h(
          "div",
          {},
          h("strong", {}, `${basketService.name} · ${basketKg} kg`),
          h("p", { class: "muted small" }, `${money(basketService.rateMinorPerKg)} per kg · estimate ${money(basketTotal)}`),
        ),
        h("div", { class: "basket-total" }, h("span", {}, "Due at return"), h("span", { class: "num" }, money(basketTotal))),
      ),
    );

    if (current.drafts["checkout.open"] !== "1") {
      const checkoutButton = h("button", { class: "primary", type: "button" }, "Choose slot and address");
      checkoutButton.addEventListener("click", () => {
        current.drafts["checkout.open"] = "1";
        renderPanel();
      });
      const clear = h("button", { class: "text", type: "button" }, "Remove");
      clear.addEventListener("click", () => {
        current.drafts["basket.service"] = "";
        current.drafts["checkout.open"] = "0";
        renderPanel();
      });
      basketPanel.append(h("div", { class: "row" }, checkoutButton, clear));
    } else {
      const slots = draftSelect(
        current,
        "booking.slot",
        (config?.slots ?? []).map((slot) => ({
          value: slot.id,
          label: `Pickup ${fmtDateTime(slot.pickupStart)} - return ${fmtDateTime(slot.returnStart)} (${slot.capacity - slot.reserved} left)`,
        })),
      );
      const facility = config?.facility;
      const address = draftInput(current, "booking.address", "14 Demo Lane, Indiranagar, Bengaluru");
      const lat = draftInput(current, "booking.lat", String(facility?.lat ?? 12.9784), { type: "number", step: "0.0001" });
      const lng = draftInput(current, "booking.lng", String(facility?.lng ?? 77.6408), { type: "number", step: "0.0001" });

      const geo = h("button", { type: "button", class: "ghost" }, "Use my browser location");
      geo.addEventListener("click", () => {
        if (!navigator.geolocation) {
          showNotice("error", "This browser has no geolocation API. Type the coordinates instead.");
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (position) => {
            lat.value = position.coords.latitude.toFixed(5);
            lng.value = position.coords.longitude.toFixed(5);
            current.drafts["booking.lat"] = lat.value;
            current.drafts["booking.lng"] = lng.value;
            showNotice("ok", "Browser location copied into the address form.");
          },
          (error) => showNotice("error", `Browser location unavailable: ${error.message}. Type the coordinates instead.`),
          { timeout: 8000 },
        );
      });

      const place = h("button", { class: "primary", type: "button" }, current.busy ? "Placing order…" : "Place order");
      place.disabled = current.busy;
      place.addEventListener("click", () => {
        const body: PilotBooking = {
          serviceCode: basketService.code,
          estimatedWeightGrams: Math.round(basketKg * 1000),
          slotId: slots.value,
          address: { line: address.value, lat: Number(lat.value), lng: Number(lng.value) },
        };
        // One key per booking intent: a double click or a retry after an
        // unknown outcome replays the first answer instead of booking twice.
        const key = intentKey(current, "booking", body);
        void withBusy(async () => {
          const order = await current.api.createOrder(body, key);
          clearIntent(current, "booking");
          current.selectedId = order.id;
          current.drafts["checkout.open"] = "0";
          current.drafts["basket.service"] = "";
          await refresh();
          showNotice("ok", `Booked. Pickup code ${order.pickupCode ?? ""}: read it out to your delivery partner.`);
        });
      });

      const close = h("button", { class: "text", type: "button" }, "Keep browsing");
      close.addEventListener("click", () => {
        current.drafts["checkout.open"] = "0";
        renderPanel();
      });

      basketPanel.append(
        h(
          "div",
          { class: "checkout-grid" },
          h("label", {}, "Pickup slot", slots),
          h("label", {}, "Address", address),
          h("label", {}, "Latitude", lat),
          h("label", {}, "Longitude", lng),
        ),
        h("div", { class: "row" }, place, geo, close),
        h("p", { class: "note" }, "Nothing is charged now. Payment is collected at return, after the measured weight is settled."),
      );
    }
  }

  const servicesCard = h(
    "section",
    { class: "card shop-services" },
    h(
      "div",
      { class: "section-head" },
      h("div", {}, h("h2", {}, "Services"), h("p", {}, "Priced per kilogram. The bag is weighed at pickup, before any washing.")),
    ),
    searchBar,
    chips,
    list,
    basketPanel,
  );

  /* Orders live in one ledger card, one ticket per order, so the list reads
   * as a list instead of a stack of small cards. */
  const ordersBox = h("div", { class: "card orders-card" });
  for (const order of current.orders) {
    /* A click on the head selects the order: the map, a loaded position and
     * the selection parity with the operations queue follow it. The body
     * stays read-only content with its own controls. */
    const ticketHead = h(
      "button",
      { class: order.id === current.selectedId ? "ticket-head selected" : "ticket-head", type: "button", "data-order-id": order.id },
      h("div", { class: "ticket-id" }, h("span", { class: "num" }, `Order ${shortId(order.id)}`), h("span", { class: "service" }, order.serviceCode.replace("_", " "))),
      statusPill(order),
    );
    ticketHead.addEventListener("click", () => selectOrder(current, order.id));
    const ticket = h(
      "article",
      { class: "order ticket", "data-order-id": order.id },
      ticketHead,
      h(
        "div",
        { class: "ticket-body" },
        h(
          "div",
          { class: "figures" },
          figure("Estimated", kg(order.estimatedWeightGrams)),
          figure("Measured", kg(order.measuredWeightGrams)),
          figure(order.totalMinor === 0 ? "Nothing due" : order.paymentStatus === "PAID" ? "Paid at return" : "Due at return", money(order.totalMinor), true),
        ),
        progressBar(order),
        h(
          "div",
          { class: "ticket-meta" },
          h("span", { class: "address" }, order.address.line),
          h("span", {}, `Pickup ${fmtDateTime(order.pickupStart)} to ${fmtTime(order.pickupEnd)} · return ${fmtDateTime(order.returnStart)} to ${fmtTime(order.returnEnd)}`),
          h("a", { class: "text", href: directionsUrl(order), target: "_blank", rel: "noopener noreferrer" }, "Directions"),
        ),
      ),
    );

    const body = ticket.querySelector<HTMLElement>(".ticket-body");
    if (!body) continue;

    if (order.proposedTotalMinor !== null && order.proposedTotalMinor !== undefined) {
      body.append(
        h(
          "div",
          { class: "callout warn" },
          `Measured weight is ${kg(order.measuredWeightGrams)}. The new total is ${money(order.proposedTotalMinor)} instead of ${money(order.totalMinor)}. Nothing starts until you approve it.`,
        ),
      );
      const approve = h("button", { class: "primary", type: "button" }, `Approve ${money(order.proposedTotalMinor)}`);
      approve.disabled = current.busy;
      approve.addEventListener("click", () => void runAction(order, "APPROVE_PRICE"));
      const decline = h("button", { class: "ghost", type: "button" }, "Decline");
      decline.disabled = current.busy;
      decline.addEventListener("click", () => void runAction(order, "DECLINE_PRICE"));
      body.append(h("div", { class: "ticket-actions" }, approve, decline));
    }

    if (order.pickupCode && order.pickupStatus !== "COMPLETED") {
      const reissue = h("button", { class: "text", type: "button" }, "New code");
      reissue.disabled = current.busy;
      reissue.addEventListener("click", () => void runAction(order, "REISSUE_HANDOVER_CODE", { leg: "PICKUP" }));
      body.append(
        h("p", { class: "code" }, "Pickup code", h("span", { class: "num" }, order.pickupCode), "(share at pickup)", reissue),
      );
    }
    if (order.returnCode) {
      const reissue = h("button", { class: "text", type: "button" }, "New code");
      reissue.disabled = current.busy;
      reissue.addEventListener("click", () => void runAction(order, "REISSUE_HANDOVER_CODE", { leg: "RETURN" }));
      body.append(h("p", { class: "code" }, "Return code", h("span", { class: "num" }, order.returnCode), "(share at return)", reissue));
    }
    if (order.pickupCode || order.returnCode) {
      body.append(h("p", { class: "note" }, "A code stops working 12 hours after its slot. Use New code if it has expired; the old code is cancelled."));
    }
    if (order.holdReason) {
      body.append(h("p", { class: "callout warn" }, order.holdReason));
      if (order.status === "ON_HOLD") {
        body.append(h("p", { class: "note" }, "Nothing is charged while the order is held. Operations must record the founder's decision before the bag moves again."));
      }
    }

    if (order.status === "BOOKED") {
      const cancel = h("button", { class: "text", type: "button" }, "Cancel this order");
      cancel.disabled = current.busy;
      cancel.addEventListener("click", () => void runAction(order, "CANCEL"));
      body.append(
        h("div", { class: "ticket-actions" }, h("span", { class: "muted small" }, "Cancellation is only possible before pickup."), cancel),
      );
    }

    body.append(historyCard(order));
    ordersBox.append(ticket);
  }
  if (current.orders.length === 0) {
    ordersBox.append(h("p", { class: "empty" }, "No orders yet. Book one to start the pilot run."));
  } else if (trackingClosed(selectedOrder(current))) {
    ordersBox.append(h("p", { class: "note" }, "Position tracking is closed for this completed order."));
  } else if (mapCard) {
    ordersBox.append(mapCard);
  }

  const ordersSection = h(
    "section",
    { class: "shop-orders section" },
    h(
      "div",
      { class: "section-head" },
      h("div", {}, h("h2", {}, "My orders"), h("p", {}, `${current.orders.length} ${current.orders.length === 1 ? "order" : "orders"} · pay when the bag comes back`)),
    ),
    ordersBox,
  );
  return h(
    "div",
    {},
    pageHead(
      "Book a wash",
      "Booked by the kilogram, weighed at pickup, paid when it comes back.",
      current,
    ),
    h("div", { class: "shop-layout" }, servicesCard, ordersSection),
  );
}

/* operations */

function operatorPanel(current: RoleState): HTMLElement {
  const orders = current.orders;
  const opsSteps = needsAction("operator", orders);
  const awaiting = orders.filter((order) => order.status === "AWAITING_APPROVAL").length;
  const onHold = orders.filter((order) => order.status === "ON_HOLD").length;
  const sub =
    orders.length === 0
      ? "No orders in the queue."
      : `${opsSteps} need an operations step${awaiting ? ` · ${awaiting} waiting on the customer` : ""}${onHold ? ` · ${onHold} on hold` : ""} · ${orders.length} in the pilot.`;

  const queue = h("div", { class: "list" });
  for (const order of orders) {
    const row = h(
      "button",
      {
        class: order.id === current.selectedId ? "card clickable queue-row selected" : "card clickable queue-row",
        type: "button",
        "data-order-id": order.id,
        "aria-pressed": order.id === current.selectedId,
      },
      h("span", { class: "id" }, shortId(order.id)),
      h("span", { class: "service" }, order.serviceCode.replace("_", " ")),
      h("span", { class: "status" }, statusPill(order)),
      h(
        "span",
        { class: "meta" },
        `${kg(order.measuredWeightGrams ?? order.estimatedWeightGrams)} · ${
          order.paymentStatus === "PAID" ? "paid" : order.paymentStatus === "UNRESOLVED" ? "payment problem" : "unpaid"
        }`,
      ),
      h("span", { class: "total" }, money(order.totalMinor)),
    );
    row.addEventListener("click", () => selectOrder(current, order.id));
    queue.append(row);
  }
  if (orders.length === 0) queue.append(h("p", { class: "empty" }, "No pilot orders yet."));

  const queueSection = h(
    "section",
    { class: "queue-col" },
    h(
      "div",
      { class: "section-head" },
      h("div", {}, h("h2", {}, "Queue"), h("p", {}, "Oldest first. Select a row to act on it.")),
    ),
    queue,
  );

  const detail = h("div", { class: "detail-col" });
  const order = selectedOrder(current);
  if (!order) {
    detail.append(h("div", { class: "card" }, h("p", { class: "empty" }, "Select an order from the queue.")));
  } else {
    const info = h(
      "section",
      { class: "card" },
      h("div", { class: "detail-head" }, h("h2", {}, `Order ${shortId(order.id)}`), statusPill(order)),
      h(
        "div",
        { class: "detail-figures" },
        figure("Estimated", kg(order.estimatedWeightGrams)),
        figure("Measured", kg(order.measuredWeightGrams)),
        figure(order.totalMinor === 0 ? "Nothing due" : "Total", money(order.totalMinor), true),
      ),
      progressBar(order),
      h(
        "dl",
        { class: "detail-grid" },
        h("div", {}, h("dt", {}, "Service"), h("dd", {}, order.serviceCode.replace("_", " "))),
        h("div", {}, h("dt", {}, "Customer"), h("dd", { class: "mono" }, shortId(order.customerId))),
        h("div", {}, h("dt", {}, "Delivery partner"), h("dd", { class: "mono" }, order.riderId ? shortId(order.riderId) : "Unassigned")),
        h("div", {}, h("dt", {}, "Payment"), h("dd", {}, order.paymentStatus.toLowerCase())),
        h("div", {}, h("dt", {}, "Pickup"), h("dd", {}, `${order.pickupStatus.toLowerCase()} · ${fmtDateTime(order.pickupStart)}`)),
        h("div", {}, h("dt", {}, "Return"), h("dd", {}, `${order.returnStatus.toLowerCase()} · ${fmtDateTime(order.returnStart)}`)),
        h("div", {}, h("dt", {}, "Address"), h("dd", {}, order.address.line)),
        h("div", {}, h("dt", {}, "Version"), h("dd", { class: "mono" }, String(order.version))),
      ),
      h("div", { class: "note" }, locationLine(current)),
    );
    detail.append(info);

    if (order.status === "BOOKED" || (order.status === "RETURNING" && !order.riderId)) {
      const riderSelect = draftSelect(
        current,
        `assign.${order.id}`,
        current.riders.length > 0
          ? current.riders.map((rider) => ({ value: rider.id, label: rider.name }))
          : [{ value: DEMO_RIDER_ID, label: "Demo delivery partner" }],
      );
      const assign = h("button", { class: "primary", type: "button" }, order.status === "RETURNING" ? "Assign return partner" : "Assign delivery partner");
      assign.disabled = current.busy;
      assign.addEventListener("click", () => void runAction(order, "ASSIGN", { riderId: riderSelect.value }));
      detail.append(
        h(
          "section",
          { class: "card action-card" },
          h("h3", {}, order.status === "RETURNING" ? "Assign return" : "Assign"),
          h("p", {}, "The delivery partner can read this order only while it is assigned to them."),
          h("div", { class: "form-grid two" }, h("label", {}, "Delivery partner", riderSelect)),
          h("div", { class: "row" }, assign),
        ),
      );
    }

    if (order.status === "INTAKE_COMPLETE") {
      const start = h("button", { class: "primary", type: "button" }, "Start washing");
      start.disabled = current.busy;
      start.addEventListener("click", () => void runAction(order, "START_CARE"));
      detail.append(
        h(
          "section",
          { class: "card action-card" },
          h("h3", {}, "Processing"),
          h("p", {}, `The customer accepted the measured weight. Start the wash; the bag is due back ${fmtDateTime(order.returnStart)}.`),
          h("div", { class: "row" }, start),
        ),
      );
    }
    if (order.status === "IN_CARE") {
      const qc = h("button", { class: "primary", type: "button" }, "Quality check");
      qc.disabled = current.busy;
      qc.addEventListener("click", () => void runAction(order, "QUALITY_CHECK"));
      detail.append(
        h("section", { class: "card action-card" }, h("h3", {}, "Quality check"), h("p", {}, "Check every item before the bag goes back out."), h("div", { class: "row" }, qc)),
      );
    }
    if (order.status === "QUALITY_CHECK") {
      const ready = h("button", { class: "primary", type: "button" }, "Ready for return");
      ready.disabled = current.busy;
      ready.addEventListener("click", () => void runAction(order, "READY_FOR_RETURN"));
      detail.append(
        h("section", { class: "card action-card" }, h("h3", {}, "Ready for return"), h("p", {}, "The delivery partner starts the return leg and the customer shares the return code."), h("div", { class: "row" }, ready)),
      );
    }
    if (order.status === "RETURNING") {
      const amount = draftInput(current, `pay.amount.${order.id}`, String(order.totalMinor / 100), {
        type: "number",
        step: "0.01",
      });
      const method = draftSelect(current, `pay.method.${order.id}`, [
        { value: "CASH", label: "Cash" },
        { value: "UPI", label: "UPI" },
      ]);
      const reference = draftInput(current, `pay.reference.${order.id}`, `manual-${shortId(order.id)}`);
      const record = h("button", { class: "primary", type: "button" }, "Record payment received");
      record.disabled = current.busy;
      record.addEventListener("click", () =>
        void runAction(order, "CONFIRM_PAYMENT", {
          amountMinor: Math.round(Number(amount.value) * 100),
          method: method.value,
          reference: reference.value,
        }),
      );
      const issue = h("button", { class: "ghost", type: "button" }, "Record a payment problem");
      issue.disabled = current.busy;
      issue.addEventListener("click", () =>
        void runAction(order, "PAYMENT_ISSUE", { reason: "Payment not collected at return" }),
      );
      detail.append(
        h(
          "section",
          { class: "card action-card" },
          h("h3", {}, "Payment at return"),
          h("p", {}, "Money is confirmed by hand. No payment gateway is called and no receipt is sent by message."),
          h("div", { class: "form-grid" }, h("label", {}, "Amount", amount), h("label", {}, "Method", method), h("label", {}, "Reference", reference)),
          h("div", { class: "row" }, record, issue),
        ),
      );
    }
    if (order.status === "ON_HOLD") {
      const note = draftTextarea(current, `hold.note.${order.id}`, "");
      const agreed = h("input", { type: "checkbox" });
      agreed.checked = current.drafts[`hold.agreed.${order.id}`] === "1";
      const resolve = h("button", { class: "primary", type: "button" }, "Release as unprocessed return");
      const sync = () => {
        resolve.disabled = current.busy || !agreed.checked || note.value.trim().length < 10;
      };
      agreed.addEventListener("change", () => {
        current.drafts[`hold.agreed.${order.id}`] = agreed.checked ? "1" : "0";
        sync();
      });
      note.addEventListener("input", sync);
      sync();
      resolve.addEventListener("click", () => {
        if (!agreed.checked || note.value.trim().length < 10) {
          showNotice("error", "Record the customer's agreement and a case note of at least 10 characters.");
          return;
        }
        void runAction(order, "RESOLVE_HOLD", {
          resolution: "RETURN_UNPROCESSED",
          customerAgreed: true,
          note: note.value.trim(),
        });
      });
      detail.append(
        h(
          "section",
          { class: "card action-card" },
          h("h3", {}, "Held order"),
          h("p", {}, "No fee is invented here. Record the customer's agreement to take the bag back unwashed, then hand it over through the normal return leg. The total becomes zero and stays unpaid."),
          h("label", {}, "Founder case note", note),
          h("label", { class: "check" }, agreed, "Customer agreed to an unprocessed return"),
          h("div", { class: "row" }, resolve),
        ),
      );
    }
    if (order.holdReason) detail.append(h("section", { class: "card callout warn" }, order.holdReason));
    detail.append(h("section", { class: "card" }, h("h3", {}, "History"), timeline(order)));
  }
  if (selectedOrder(current) && trackingClosed(selectedOrder(current))) {
    detail.append(h("p", { class: "note" }, "Position tracking is closed for this order."));
  } else if (mapCard) {
    detail.append(mapCard);
  }

  const slots = h("div", {});
  for (const slot of current.config?.slots ?? []) {
    const input = draftInput(current, `slot.capacity.${slot.id}`, String(slot.capacity), {
      type: "number",
      min: "0",
      max: "100",
    });
    const save = h("button", { class: "ghost", type: "button" }, "Save");
    save.disabled = current.busy;
    save.addEventListener("click", () => {
      const capacity = Number(input.value);
      const key = intentKey(current, `slot:${slot.id}`, { capacity });
      void withBusy(async () => {
        await current.api.setSlotCapacity(slot.id, capacity, key);
        clearIntent(current, `slot:${slot.id}`);
        await refresh();
        showNotice("ok", `Slot capacity set to ${capacity}`);
      });
    });
    slots.append(
      h(
        "div",
        { class: "slot-row" },
        h(
          "div",
          { class: "slot-detail" },
          h("p", { class: "slot-when" }, `Pickup ${fmtDateTime(slot.pickupStart)}`),
          h("p", { class: "slot-meta" }, `back ${fmtDateTime(slot.returnStart)}`),
        ),
        h("span", { class: "usage" }, `${slot.reserved} / ${slot.capacity}`),
        h("label", {}, "Capacity", input),
        save,
      ),
    );
  }
  const slotsSection = h(
    "section",
    { class: "card slots-col" },
    h(
      "div",
      { class: "section-head" },
      h("div", {}, h("h2", {}, "Slot capacity"), h("p", {}, "Booked out of capacity. A full slot refuses new bookings.")),
    ),
    slots,
  );

  return h("div", {}, pageHead("Order queue", sub, current), h("div", { class: "ops-layout" }, queueSection, detail, slotsSection));
}

/* delivery partner */

function riderPanel(current: RoleState): HTMLElement {
  const orders = current.orders;
  const handovers = orders.filter((order) => order.status === "BOOKED" || order.status === "RETURNING").length;
  const sub =
    orders.length === 0
      ? "No jobs assigned to you."
      : `${orders.length} ${orders.length === 1 ? "job" : "jobs"} assigned${handovers ? ` · ${handovers} need a handover code` : ""}.`;

  const jobs = h("div", { class: "card jobs-card" });
  for (const order of orders) {
    const row = h(
      "button",
      {
        class: order.id === current.selectedId ? "queue-row selected" : "queue-row",
        type: "button",
        "data-order-id": order.id,
        "aria-pressed": order.id === current.selectedId,
      },
      h("span", { class: "id" }, shortId(order.id)),
      h("span", { class: "service" }, order.address.line),
      h("span", { class: "status" }, statusPill(order)),
      h("span", { class: "meta" }, `${kg(order.measuredWeightGrams ?? order.estimatedWeightGrams)} · ${order.serviceCode.replace("_", " ")}`),
      h("span", { class: "total" }, money(order.totalMinor)),
      rowProgress(order),
    );
    row.addEventListener("click", () => selectOrder(current, order.id));
    jobs.append(row);
  }
  if (orders.length === 0) jobs.append(h("p", { class: "empty" }, "No jobs assigned to you yet."));

  const jobsSection = h(
    "section",
    { class: "jobs-col" },
    h(
      "div",
      { class: "section-head" },
      h("div", {}, h("h2", {}, "Jobs"), h("p", {}, "Every job assigned to the demo delivery partner.")),
    ),
    jobs,
  );

  const detail = h("div", { class: "job-col" });
  const order = selectedOrder(current);
  if (order) {
    const card = h(
      "section",
      { class: "card" },
      h("div", { class: "detail-head" }, h("h2", {}, `Job ${shortId(order.id)}`), statusPill(order)),
      h(
        "div",
        { class: "detail-figures" },
        figure("Estimated", kg(order.estimatedWeightGrams)),
        figure("Measured", kg(order.measuredWeightGrams)),
        figure(order.totalMinor === 0 ? "Nothing to collect" : "Collect at return", money(order.totalMinor), true),
      ),
      progressBar(order),
      h(
        "dl",
        { class: "detail-grid" },
        h("div", {}, h("dt", {}, "Address"), h("dd", {}, order.address.line)),
        h("div", {}, h("dt", {}, "Coordinates"), h("dd", { class: "mono" }, `${order.address.lat}, ${order.address.lng}`)),
        h("div", {}, h("dt", {}, "Pickup"), h("dd", {}, fmtDateTime(order.pickupStart))),
        h("div", {}, h("dt", {}, "Return"), h("dd", {}, fmtDateTime(order.returnStart))),
        h("div", {}, h("dt", {}, "Directions"), h("dd", {}, h("a", { class: "text", href: directionsUrl(order), target: "_blank", rel: "noopener noreferrer" }, "Open in maps"))),
      ),
      h("div", { class: "note" }, "The customer reads out the handover code. It is never shown in this view."),
      h("div", { class: "note" }, locationLine(current)),
    );

    if (order.status === "BOOKED" && order.pickupStatus === "ASSIGNED") {
      const code = draftInput(current, `pickup.code.${order.id}`, "", { type: "text", inputmode: "numeric", maxlength: "6" });
      const pickup = h("button", { class: "primary", type: "button" }, "Confirm pickup");
      pickup.disabled = current.busy;
      pickup.addEventListener("click", () => void runAction(order, "PICKUP", { code: code.value.trim() }));
      card.append(
        h("div", { class: "form-grid two" }, h("label", {}, "Handover code", code)),
        h("div", { class: "row" }, pickup),
      );
    }
    if (order.status === "PICKED_UP") {
      const weight = draftInput(current, `intake.weight.${order.id}`, String((order.estimatedWeightGrams ?? 0) / 1000), {
        type: "number",
        step: "0.1",
        min: "0.1",
      });
      const bags = draftInput(current, `intake.bags.${order.id}`, "1", { type: "number", step: "1", min: "1" });
      const intake = h("button", { class: "primary", type: "button" }, "Record weighed intake");
      intake.disabled = current.busy;
      intake.addEventListener("click", () =>
        void runAction(order, "INTAKE", {
          measuredWeightGrams: Math.round(Number(weight.value) * 1000),
          bagCount: Number(bags.value),
        }),
      );
      card.append(
        h("div", { class: "form-grid two" }, h("label", {}, "Measured weight (kg)", weight), h("label", {}, "Bags", bags)),
        h("div", { class: "row" }, intake),
        h("p", { class: "note" }, "A heavier bag waits for the customer's approval before any washing starts."),
      );
    }
    if (order.status === "READY_FOR_RETURN") {
      const start = h("button", { class: "primary", type: "button" }, "Start the return leg");
      start.disabled = current.busy;
      start.addEventListener("click", () => void runAction(order, "START_RETURN"));
      card.append(h("div", { class: "row" }, start));
    }
    if (order.status === "RETURNING") {
      const code = draftInput(current, `return.code.${order.id}`, "", { type: "text", inputmode: "numeric", maxlength: "6" });
      const deliver = h("button", { class: "primary", type: "button" }, "Confirm handover");
      deliver.disabled = current.busy;
      deliver.addEventListener("click", () => void runAction(order, "DELIVER", { code: code.value.trim() }));
      const issue = h("button", { class: "ghost", type: "button" }, "Payment not collected");
      issue.disabled = current.busy;
      issue.addEventListener("click", () =>
        void runAction(order, "PAYMENT_ISSUE", { reason: "Customer did not pay at the door" }),
      );
      card.append(
        h("div", { class: "form-grid two" }, h("label", {}, "Return code", code)),
        h("div", { class: "row" }, deliver, ...(order.totalMinor === 0 ? [] : [issue])),
      );
    }
    card.append(historyCard(order));
    detail.append(card);
  } else {
    detail.append(h("section", { class: "card" }, h("p", { class: "empty" }, "Select a job from the list.")));
  }
  const lat = draftInput(current, "report.lat", "12.9784", { type: "number", step: "0.0001" });
  const lng = draftInput(current, "report.lng", "77.6408", { type: "number", step: "0.0001" });
  const geo = h("button", { class: "ghost", type: "button" }, "Send my browser location");
  geo.disabled = current.busy;
  geo.addEventListener("click", () => {
    if (!navigator.geolocation) {
      showNotice("error", "This browser has no geolocation API. Enter coordinates instead.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        lat.value = position.coords.latitude.toFixed(5);
        lng.value = position.coords.longitude.toFixed(5);
        current.drafts["report.lat"] = lat.value;
        current.drafts["report.lng"] = lng.value;
        void sendLocation(Number(lat.value), Number(lng.value), "BROWSER_GEOLOCATION");
      },
      (error) => showNotice("error", `Browser location unavailable: ${error.message}. Enter coordinates instead.`),
      { timeout: 8000 },
    );
  });
  const manual = h("button", { class: "primary", type: "button" }, "Send entered position");
  manual.disabled = current.busy;
  manual.addEventListener("click", () => void sendLocation(Number(lat.value), Number(lng.value), "MANUAL"));

  async function sendLocation(latValue: number, lngValue: number, source: PilotLocationReport["source"]): Promise<void> {
    const orderId = current.selectedId;
    if (!orderId) {
      showNotice("error", "Select a job first.");
      return;
    }
    const payload = { lat: latValue, lng: lngValue, capturedAt: new Date().toISOString(), source };
    const key = intentKey(current, `location:${orderId}`, payload);
    await withBusy(async () => {
      await current.api.reportLocation(orderId, payload, key);
      clearIntent(current, `location:${orderId}`);
      await refresh();
      showNotice("ok", "Position reported");
    });
  }

  const reportSection = h(
    "section",
    { class: "card report-col" },
    h("h2", {}, "Report position"),
    h(
      "p",
      { class: "note" },
      "Only report a position you actually know. A browser position is self-reported, not attested GPS. The customer sees this point with its timestamp, and a stale point is marked as stale rather than shown as live tracking.",
    ),
    h("div", { class: "form-grid two" }, h("label", {}, "Latitude", lat), h("label", {}, "Longitude", lng)),
    h("div", { class: "row" }, manual, geo),
  );

  const layout = h("div", { class: "rider-layout" }, jobsSection, detail, reportSection);
  if (selectedOrder(current) && trackingClosed(selectedOrder(current))) {
    layout.append(h("p", { class: "note" }, "Position tracking is closed for this completed job."));
  } else if (mapCard) {
    layout.append(mapCard);
  }
  return h("div", {}, pageHead("My jobs", sub, current), layout);
}


/* -------------------------------------------------------------------- map */

function renderMap(): void {
  if (!pilotMap) return;
  const current = state[activeRole];
  const markers: MarkerSpec[] = [];
  const facility = current.config?.facility;
  if (facility) {
    markers.push({ lat: facility.lat, lng: facility.lng, label: `${facility.name} (demo facility)`, kind: "facility" });
  }
  const order = selectedOrder(current);
  if (order) {
    markers.push({ lat: order.address.lat, lng: order.address.lng, label: `Customer · ${order.address.line}`, kind: "customer", orderId: order.id });
  }
  // Only a position reported for the order on screen is drawn.
  if (current.location && current.locationOrderId === current.selectedId) {
    const location = current.location;
    markers.push({
      lat: location.lat,
      lng: location.lng,
      label: `Delivery partner · ${location.source === "BROWSER_GEOLOCATION" ? "self-reported browser location, not attested GPS" : "position entered by hand"} captured ${location.capturedAt} (${location.ageSeconds}s ago${location.stale ? ", stale" : ""})`,
      kind: "rider",
      orderId: current.selectedId,
      stale: location.stale,
    });
  }
  pilotMap.setMarkers(markers);
  pilotMap.focus(markers);
}

/* ------------------------------------------------------------------- boot */

buildShell();
renderPanel();
renderMap();

/* A deep link opens one role for screenshots and review: ?as=customer.
 * Without it the console starts signed out, as a person would find it. */
const asRole = params.get("as");
if (asRole === "customer" || asRole === "operator" || asRole === "rider") {
  activeRole = asRole;
  renderPanel();
  void signIn(asRole);
}

setInterval(() => {
  const current = state[activeRole];
  if (current.signedIn && !current.busy) void refresh();
}, 3000);

// Leaving a field resumes live updates.
document.addEventListener("focusout", () => {
  setTimeout(() => {
    if (!isEditing()) void refresh();
  }, 150);
});
