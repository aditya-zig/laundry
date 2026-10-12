// Demo draft parser ported from modules/conversations/src/conversations.ts.
// Pure functions only. Dates resolve in Asia/Kolkata. Never guesses: missing
// or ambiguous fields are returned as missingFields for the caller to ask.

const SERVICE_WORDS: { words: string[]; serviceId: string; garmentTypeId: string }[] = [
  {
    words: ["wash and press", "wash & press", "wash press", "wash and iron", "wash & iron", "wash iron"],
    serviceId: "11111111-1111-4111-8111-111111111111",
    garmentTypeId: "22222222-2222-4222-8222-222222222222",
  },
  {
    words: ["dry clean", "dry-clean", "dryclean"],
    serviceId: "44444444-4444-4444-8444-444444444444",
    garmentTypeId: "55555555-5555-4555-8555-555555555555",
  },
  {
    words: ["wash and fold", "wash & fold", "laundry"],
    serviceId: "aaaa1111-1111-4111-8111-111111111112",
    garmentTypeId: "aaaa2222-2222-4222-8222-222222222223",
  },
  {
    words: ["press only", "press", "iron", "steam"],
    serviceId: "bbbb1111-1111-4111-8111-111111111113",
    garmentTypeId: "bbbb2222-2222-4222-8222-222222222224",
  },
];

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

const GARMENT_WORD =
  "(?:shirts?|trousers?|blazers?|t-?shirts?|cloths|clothes|garments?|pieces?|kurtas?|sarees?|dress shirts?)";

export function parseCount(text: string): number | null {
  const digit = text.match(new RegExp(`(\\d{1,3})\\s*${GARMENT_WORD}`, "i"));
  if (digit) return Math.min(100, parseInt(digit[1], 10));
  const wordAlt = Object.keys(NUMBER_WORDS).join("|");
  const worded = text.match(new RegExp(`\\b(${wordAlt})\\b\\s*${GARMENT_WORD}`, "i"));
  if (worded) return NUMBER_WORDS[worded[1].toLowerCase()];
  return null;
}

export function parseService(text: string) {
  const lower = text.toLowerCase();
  for (const s of SERVICE_WORDS) if (s.words.some((w) => lower.includes(w))) return s;
  return null;
}

function kolkataDay(base: Date, addDays: number, hour: number, minute: number): Date {
  const utc = new Date(base.getTime() + addDays * 86400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(utc);
  const [y, m, d] = parts.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour - 5, minute - 30, 0));
}

export function parseTime(text: string, receivedAt: Date): { start: Date; end: Date } | null {
  const pickupClause = text.toLowerCase().split(/\breturn\b/)[0];
  const lower = pickupClause;
  let dayOffset: number | null = null;
  if (lower.includes("day after tomorrow")) dayOffset = 2;
  else if (lower.includes("tomorrow")) dayOffset = 1;
  else if (lower.includes("today")) dayOffset = 0;
  const absDate = lower.match(/(\d{4})-(\d{2})-(\d{2})/);
  const between = lower.match(/between\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*and\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  const atHour = lower.match(/(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  const to24 = (h: number, ap?: string) => {
    if (!ap) return h;
    if (ap === "pm" && h < 12) return h + 12;
    if (ap === "am" && h === 12) return 0;
    return h;
  };
  if (between && dayOffset !== null) {
    const sH = to24(parseInt(between[1], 10), between[3] as string | undefined);
    const sM = between[2] ? parseInt(between[2], 10) : 0;
    const eH = to24(parseInt(between[4], 10), (between[6] as string | undefined) ?? (between[3] as string | undefined));
    const eM = between[5] ? parseInt(between[5], 10) : 0;
    if (sM > 59 || eM > 59) return null;
    const start = kolkataDay(receivedAt, dayOffset, sH, sM);
    const end = kolkataDay(receivedAt, dayOffset, eH, eM);
    return end > start ? { start, end } : null;
  }
  if (atHour && dayOffset !== null) {
    const h = to24(parseInt(atHour[1], 10), atHour[3]);
    const m = atHour[2] ? parseInt(atHour[2], 10) : 0;
    if (m > 59) return null;
    const start = kolkataDay(receivedAt, dayOffset, h, m);
    return { start, end: new Date(start.getTime() + 3600_000) };
  }
  if (absDate) {
    const start = new Date(Date.UTC(Number(absDate[1]), Number(absDate[2]) - 1, Number(absDate[3]), 3, 30, 0));
    return { start, end: new Date(start.getTime() + 3600_000) };
  }
  if (dayOffset !== null) {
    const start = kolkataDay(receivedAt, dayOffset, 9, 0);
    return { start, end: new Date(start.getTime() + 3600_000) };
  }
  return null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function parseReturnDeadline(
  text: string,
  receivedAt: Date
): { at: Date } | { ambiguous: true } | null {
  const idx = text.toLowerCase().indexOf("return");
  if (idx < 0) return null;
  const clause = text.toLowerCase().slice(idx);
  const dayHit = WEEKDAYS.find((d) => clause.includes(d));
  const timeHit = clause.match(/(?:before|by|at)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  const absHit = clause.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (absHit) {
    return { at: new Date(Date.UTC(Number(absHit[1]), Number(absHit[2]) - 1, Number(absHit[3]), 12, 30, 0)) };
  }
  if (dayHit && timeHit) {
    const want = WEEKDAYS.indexOf(dayHit);
    const kolkataNow = new Date(receivedAt.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const have = kolkataNow.getDay();
    let delta = (want - have + 7) % 7;
    if (delta === 0) delta = 7;
    let h = parseInt(timeHit[1], 10);
    const m = timeHit[2] ? parseInt(timeHit[2], 10) : 0;
    const ap = timeHit[3] as string | undefined;
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (m > 59 || h > 23) return { ambiguous: true };
    return { at: kolkataDay(receivedAt, delta, h, m) };
  }
  return { ambiguous: true };
}

export interface DraftFields {
  serviceId?: string;
  garmentTypeId?: string;
  quantity?: number;
  pickupStart?: string;
  pickupEnd?: string;
  addressId?: string;
  requestedReturnBy?: string;
  returnNeedsClarification?: boolean;
  uncertainSpans?: string[];
}

export function exactSummary(f: DraftFields): string {
  const qty = f.quantity ? `${f.quantity}` : "?";
  const pickup =
    f.pickupStart && f.pickupEnd
      ? `${new Date(f.pickupStart).toISOString()} to ${new Date(f.pickupEnd).toISOString()} Asia/Kolkata`
      : "pickup time TBD";
  const ret = f.requestedReturnBy ? ` Return by ${new Date(f.requestedReturnBy).toISOString()}.` : "";
  return `Draft: ${qty} garment(s), pickup ${pickup}.${ret}`;
}
