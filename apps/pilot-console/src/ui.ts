/** Small DOM helpers for the console. No framework: the pilot console is a
 * thin shell over the pilot API and stays easy to read in a browser session. */

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === "class") el.className = String(value);
    else if (key === "text") el.textContent = String(value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

export function money(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return "-";
  return `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function kg(grams: number | null | undefined): string {
  if (grams === null || grams === undefined) return "-";
  return `${(grams / 1000).toFixed(2)} kg`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

const STATUS_LABELS: Record<string, string> = {
  BOOKED: "Booked",
  PICKED_UP: "Picked up",
  AWAITING_APPROVAL: "Waiting for your approval",
  INTAKE_COMPLETE: "Weighed in",
  IN_CARE: "Being washed",
  QUALITY_CHECK: "Quality check",
  READY_FOR_RETURN: "Ready for return",
  RETURNING: "On the way back",
  DELIVERED: "Delivered",
  ON_HOLD: "On hold",
  CANCELLED: "Cancelled",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function fmtTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function fmtDateTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function fmtWindow(startIso: string, endIso: string): string {
  return `${fmtDateTime(startIso)} - ${fmtTime(endIso)}`;
}
