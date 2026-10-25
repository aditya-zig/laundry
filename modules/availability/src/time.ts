/**
 * Timezone-correct slot arithmetic without a date library.
 *
 * Instants are UTC; operating hours are local wall-clock times in the area's
 * IANA zone. The conversions below resolve the zone offset at the candidate
 * instant twice, which also covers DST transitions.
 */
export interface LocalDay {
  year: number;
  month: number;
  day: number;
}

export interface OpenWindow {
  start: Date;
  end: Date;
}

export interface Slot {
  start: Date;
  end: Date;
}

interface HourRule {
  dayOfWeek: number;
  start: string;
  end: string;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutesOf(value: string): number {
  const match = HHMM.exec(value);
  if (!match) throw new Error(`Invalid local time ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function zonedParts(instant: Date, timezone: string): LocalDay & { hour: number; minute: number; second: number } {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const part of format.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour) % 24, minute: Number(parts.minute), second: Number(parts.second),
  };
}

function offsetMs(instant: Date, timezone: string): number {
  const parts = zonedParts(instant, timezone);
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

export function zonedInstant(day: LocalDay, minutes: number, timezone: string): Date {
  const hour = Math.floor(minutes / 60), minute = minutes % 60;
  const guess = Date.UTC(day.year, day.month - 1, day.day, hour, minute);
  let instant = guess - offsetMs(new Date(guess), timezone);
  instant = guess - offsetMs(new Date(instant), timezone);
  return new Date(instant);
}

export function localDay(instant: Date, timezone: string): LocalDay {
  const parts = zonedParts(instant, timezone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

export function addDays(day: LocalDay, days: number): LocalDay {
  const moved = new Date(Date.UTC(day.year, day.month - 1, day.day + days));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

export function compareDay(left: LocalDay, right: LocalDay): number {
  return Date.UTC(left.year, left.month - 1, left.day) - Date.UTC(right.year, right.month - 1, right.day);
}

/** Hours with end <= start cross local midnight into the next day. */
export function openWindows(day: LocalDay, hours: ReadonlyArray<HourRule>, timezone: string): OpenWindow[] {
  const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
  const windows: OpenWindow[] = [];
  for (const rule of hours) {
    if (rule.dayOfWeek !== weekday) continue;
    const startMinutes = minutesOf(rule.start), endMinutes = minutesOf(rule.end);
    if (startMinutes === endMinutes) continue;
    const overnight = endMinutes < startMinutes;
    const start = zonedInstant(day, startMinutes, timezone);
    const end = zonedInstant(overnight ? addDays(day, 1) : day, endMinutes, timezone);
    if (end > start) windows.push({ start, end });
  }
  return windows.sort((left, right) => left.start.getTime() - right.start.getTime());
}

/** Every slot start on the grid is anchored to local midnight of its own day. */
export function slotsForWindows(windows: ReadonlyArray<OpenWindow>, slotMinutes: number): Slot[] {
  if (!Number.isSafeInteger(slotMinutes) || slotMinutes < 15 || slotMinutes > 1440) throw new Error('Invalid slot length');
  const length = slotMinutes * 60_000;
  const slots: Slot[] = [];
  for (const window of windows) {
    for (let start = window.start.getTime(); start + length <= window.end.getTime(); start += length) {
      slots.push({ start: new Date(start), end: new Date(start + length) });
    }
  }
  return slots.sort((left, right) => left.start.getTime() - right.start.getTime());
}

/** All open slots from the first local day through `days` calendar days. */
export function openSlots(from: LocalDay, days: number, hours: ReadonlyArray<HourRule>, timezone: string, slotMinutes: number): Slot[] {
  const seen = new Set<number>();
  const slots: Slot[] = [];
  for (let offset = 0; offset < days; offset++) {
    for (const slot of slotsForWindows(openWindows(addDays(from, offset), hours, timezone), slotMinutes)) {
      if (seen.has(slot.start.getTime())) continue;
      seen.add(slot.start.getTime());
      slots.push(slot);
    }
  }
  return slots.sort((left, right) => left.start.getTime() - right.start.getTime());
}
