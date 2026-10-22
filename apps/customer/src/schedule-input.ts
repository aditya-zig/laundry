/** Human-friendly schedule fields for India. Never substitutes for server availability. */
const IST_OFFSET_MS = 330 * 60 * 1000;

export interface ISTFields {
  date: string; // YYYY-MM-DD in Asia/Kolkata
  time: string; // HH:mm in Asia/Kolkata
}

export function toISTFields(value: string): ISTFields {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) throw new Error("Invalid schedule date");
  const local = new Date(instant + IST_OFFSET_MS).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

/** Parse India-local fields strictly, then serialize UTC for the current quote API. */
export function fromISTFields(date: string, time: string): string | null {
  const day = date.trim();
  const clock = time.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) return null;
  const candidate = day + "T" + clock + ":00+05:30";
  if (!Number.isFinite(Date.parse(candidate))) return null;
  const roundTrip = toISTFields(candidate);
  return roundTrip.date === day && roundTrip.time === clock ? new Date(candidate).toISOString() : null;
}
