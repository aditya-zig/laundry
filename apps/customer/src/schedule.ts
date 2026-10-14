// Customer-entered dates are always India time, independent of browser/device timezone.
const INDIA_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export interface ScheduleDraft { pickupStart: string; pickupEnd: string; returnBy: string }
export function instantToLocal(instant: string): string {
  return new Date(Date.parse(instant) + INDIA_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");
}
export function localToInstant(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(local)) throw new Error("Use YYYY-MM-DD HH:mm in India time.");
  const [year, month, day, hour, minute] = local.split(/[- T:]/).map(Number);
  const instant = new Date(Date.UTC(year, month - 1, day, hour, minute) - INDIA_OFFSET_MS).toISOString();
  if (instantToLocal(instant) !== local.replace("T", " ")) throw new Error("Enter a valid date and time.");
  return instant;
}
export function defaultSchedule(now = new Date()): ScheduleDraft {
  const indiaDay = new Date(now.getTime() + INDIA_OFFSET_MS);
  const tomorrow = Date.UTC(indiaDay.getUTCFullYear(), indiaDay.getUTCMonth(), indiaDay.getUTCDate() + 1);
  const day = new Date(tomorrow).toISOString().slice(0, 10);
  const returnDay = new Date(tomorrow + 5 * DAY_MS).toISOString().slice(0, 10);
  return { pickupStart: `${day} 09:00`, pickupEnd: `${day} 10:00`, returnBy: `${returnDay} 18:00` };
}
export function scheduleError(schedule: ScheduleDraft, now = new Date()): string | null {
  try {
    const start = Date.parse(localToInstant(schedule.pickupStart));
    const end = Date.parse(localToInstant(schedule.pickupEnd));
    const deadline = Date.parse(localToInstant(schedule.returnBy));
    if (start <= now.getTime()) return "Choose a pickup time in the future.";
    if (end <= start) return "Pickup end must be after pickup start.";
    if (deadline <= end) return "Requested return must be after your pickup window.";
    return null;
  } catch (error) { return error instanceof Error ? error.message : "Check your dates and times."; }
}
export function scheduleSummary(local: string): string {
  try { return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(localToInstant(local))) + " IST"; }
  catch { return "Enter a valid date and time"; }
}
