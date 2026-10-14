import { describe, expect, it } from "vitest";
import { defaultSchedule, localToInstant, instantToLocal, scheduleError } from "../src/schedule";
describe("India pickup scheduling", () => {
  it("offers tomorrow in India even when the UTC calendar date differs", () => {
    const schedule = defaultSchedule(new Date("2026-10-14T20:00:00Z"));
    expect(schedule.pickupStart).toBe("2026-10-16 09:00");
    expect(schedule.pickupEnd).toBe("2026-10-16 10:00");
    expect(Date.parse(localToInstant(schedule.pickupStart))).toBeGreaterThan(Date.parse("2026-10-14T20:00:00Z"));
  });
  it("rolls tomorrow across month and year boundaries", () => {
    expect(defaultSchedule(new Date("2026-12-31T18:00:00Z")).pickupStart).toBe("2027-01-01 09:00");
  });
  it("converts India time to timezone qualified UTC regardless of host timezone", () => {
    expect(localToInstant("2026-10-15 09:00")).toBe("2026-10-15T03:30:00.000Z");
    expect(instantToLocal("2026-10-15T03:30:00.000Z")).toBe("2026-10-15 09:00");
  });
  it("rejects invalid calendar dates and ambiguous date text", () => {
    expect(() => localToInstant("2026-02-30 09:00")).toThrow();
    expect(() => localToInstant("15/10/2026 09:00")).toThrow();
    expect(() => localToInstant("2026-10-15 25:00")).toThrow();
  });
  it("blocks past pickups, reversed windows and return deadlines before pickup", () => {
    const now = new Date("2026-10-14T10:00:00Z");
    const schedule = defaultSchedule(now);
    expect(scheduleError(schedule, now)).toBeNull();
    expect(scheduleError({ ...schedule, pickupStart: "2026-10-14 09:00" }, now)).toContain("future");
    expect(scheduleError({ ...schedule, pickupEnd: schedule.pickupStart }, now)).toContain("after");
    expect(scheduleError({ ...schedule, returnBy: schedule.pickupStart }, now)).toContain("return");
  });
});
