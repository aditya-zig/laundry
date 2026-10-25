import { describe, expect, it } from "vitest";
import { v2, type v2 as v2Types } from "@laundry/contracts";
import {
  defaultPair,
  formatDateLabel,
  formatTime,
  groupSlotPairs,
  pairPickupLabel,
  pairReturnLabel,
  requestedReturnFor,
  searchRange,
  unavailableLabel,
} from "./schedule";

const TZ = "Asia/Kolkata";

function pair(startUtc: string, returnEndUtc: string, available = true): v2Types.SlotPair {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    pickupWindow: { start: startUtc, end: new Date(Date.parse(startUtc) + 2 * 3600 * 1000).toISOString(), timezone: TZ },
    returnWindow: { start: new Date(Date.parse(returnEndUtc) - 3600 * 1000).toISOString(), end: returnEndUtc, timezone: TZ },
    available,
    ...(available ? {} : { unavailableReason: "NO_CAPACITY" as const }),
  };
}

const MORNING = pair("2026-10-30T03:30:00.000Z", "2026-10-30T05:00:00.000Z");
const NOON = pair("2026-10-30T08:00:00.000Z", "2026-10-31T09:30:00.000Z");
const NEXT_DAY = pair("2026-10-31T03:30:00.000Z", "2026-10-31T05:00:00.000Z");
const FULL = pair("2026-10-30T11:00:00.000Z", "2026-10-30T13:00:00.000Z", false);

describe("F01-03 schedule comes from server slot pairs only", () => {
  it("searches a forward range from now", () => {
    const now = new Date("2026-10-29T10:00:00.000Z");
    const range = searchRange(now);
    expect(range.from).toBe("2026-10-29T10:00:00.000Z");
    expect(range.to).toBe("2026-11-05T10:00:00.000Z");
    expect(Date.parse(range.to)).toBeGreaterThan(Date.parse(range.from));
  });

  it("groups pairs by the area timezone local date", () => {
    const groups = groupSlotPairs([NEXT_DAY, MORNING, NOON, FULL], TZ);
    expect(groups.map((group) => group.localDate)).toEqual(["2026-10-30", "2026-10-31"]);
    expect(groups[0]?.pairs).toHaveLength(3);
    expect(groups[0]?.pairs.map((p) => p.pickupWindow.start)).toEqual(["2026-10-30T03:30:00.000Z", "2026-10-30T08:00:00.000Z", "2026-10-30T11:00:00.000Z"]);
    expect(v2.localDateInZone(MORNING.pickupWindow.start, TZ)).toBe("2026-10-30");
    expect(v2.localDateInZone(NEXT_DAY.pickupWindow.start, TZ)).toBe("2026-10-31");
  });

  it("defaults to the first available pair", () => {
    expect(defaultPair([FULL, MORNING, NOON])).toBe(MORNING);
    expect(defaultPair([FULL])).toBeNull();
    expect(defaultPair([])).toBeNull();
  });

  it("labels unavailable pairs honestly", () => {
    expect(unavailableLabel("NO_CAPACITY")).toMatch(/booked/i);
    expect(unavailableLabel("DEADLINE_UNAVAILABLE")).toMatch(/return/i);
    expect(unavailableLabel("CLOSED")).toMatch(/closed/i);
  });

  it("formats windows in the area timezone", () => {
    expect(formatTime(MORNING.pickupWindow.start, TZ)).toBe("09:00");
    expect(formatTime(MORNING.returnWindow.end, TZ)).toBe("10:30");
    expect(pairPickupLabel(MORNING, TZ)).toBe("09:00–11:00");
    expect(pairReturnLabel(MORNING, TZ)).toBe("Return by 10:30");
    expect(formatDateLabel(MORNING.pickupWindow.start, TZ)).toContain("30 Oct");
  });

  it("keeps the requested return deadline equal to the server return window end", () => {
    expect(requestedReturnFor(MORNING)).toBe("2026-10-30T05:00:00.000Z");
  });
});
