import { v2 } from "@laundry/contracts";

export interface SlotGroup {
  localDate: string;
  pairs: v2.SlotPair[];
}

export const SEARCH_DAYS = 7;

export function searchRange(now: Date, days = SEARCH_DAYS): { from: string; to: string } {
  return {
    from: now.toISOString(),
    to: new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
  };
}

export function requestedReturnFor(pair: v2.SlotPair): string {
  return pair.returnWindow.end;
}

function formatter(timezone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, ...options });
}

export function formatTime(instant: string, timezone: string): string {
  return formatter(timezone, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(instant));
}

export function formatDateLabel(instant: string, timezone: string): string {
  return formatter(timezone, { weekday: "short", day: "numeric", month: "short" }).format(new Date(instant));
}

export function pairPickupLabel(pair: v2.SlotPair, timezone: string): string {
  return `${formatTime(pair.pickupWindow.start, timezone)}–${formatTime(pair.pickupWindow.end, timezone)}`;
}

export function pairReturnLabel(pair: v2.SlotPair, timezone: string): string {
  return `Return by ${formatTime(pair.returnWindow.end, timezone)}`;
}

export function groupSlotPairs(pairs: v2.SlotPair[], timezone: string): SlotGroup[] {
  const groups = new Map<string, v2.SlotPair[]>();
  const sorted = [...pairs].sort((a, b) => Date.parse(a.pickupWindow.start) - Date.parse(b.pickupWindow.start));
  for (const pair of sorted) {
    const localDate = v2.localDateInZone(pair.pickupWindow.start, timezone);
    const existing = groups.get(localDate);
    if (existing) existing.push(pair);
    else groups.set(localDate, [pair]);
  }
  return [...groups.entries()].map(([groupDate, groupPairs]) => ({ localDate: groupDate, pairs: groupPairs }));
}

export function defaultPair(pairs: v2.SlotPair[]): v2.SlotPair | null {
  return pairs.find((pair) => pair.available) ?? null;
}

export function unavailableLabel(reason: NonNullable<v2.SlotPair["unavailableReason"]>): string {
  switch (reason) {
    case "NO_CAPACITY":
      return "Fully booked";
    case "DEADLINE_UNAVAILABLE":
      return "Too late for this return promise";
    case "CLOSED":
      return "Closed";
  }
}
