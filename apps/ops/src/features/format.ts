// Formatting helpers for the operations workspace. Every value is displayed
// from server DTO facts only — integer INR minor units, timezone-qualified
// windows and raw counts/weight. Nothing here invents a total or a promise.
export function formatInrMinor(amountMinor: number): string {
  const grouped = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
  return `₹${grouped}`;
}

export function formatSignedInrMinor(amountMinor: number): string {
  const sign = amountMinor < 0 ? "−" : "+";
  return `${sign}${formatInrMinor(Math.abs(amountMinor))}`;
}

export function formatWeight(grams: number): string {
  return `${grams.toLocaleString("en-IN")} g`;
}

export function formatCount(count: number, unit: string): string {
  return `${count.toLocaleString("en-IN")} ${unit}${count === 1 ? "" : "s"}`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

function localParts(instant: string, timezone: string | undefined) {
  const dateField = new Date(instant);
  const options = timezone
    ? { timeZone: timezone }
    : {};
  const day = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", ...options });
  const time = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, ...options });
  return { day: day.format(dateField), time: time.format(dateField) };
}

export function formatWindow(window: { start: string; end: string; timezone: string }): string {
  const start = localParts(window.start, window.timezone);
  const end = localParts(window.end, window.timezone);
  const datePart = start.day === end.day ? start.day : `${start.day} – ${end.day}`;
  return `${datePart} · ${start.time}–${end.time} · ${window.timezone}`;
}

export function formatInstantInTz(instant: string, timezone?: string): string {
  const parts = localParts(instant, timezone ?? undefined);
  return `${parts.day} ${parts.time}`;
}

export function formatClock(instant: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(instant));
}
