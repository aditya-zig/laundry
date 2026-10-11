import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { ApiError, assertUuid } from "../../shared/src/errors";
import type { Actor } from "../../shared/src/auth";
import { createQuote } from "../../orders/src/quotes";
import { createCheckout } from "../../orders/src/orders";

/**
 * Demo draft engine. Same parser backs the demo conversation endpoint and the
 * WhatsApp text intake path. Dates resolve in Asia/Kolkata.
 */
const SERVICE_WORDS: { words: string[]; serviceId: string; garmentTypeId: string; garment: string }[] = [
  { words: ["wash and press", "wash & press", "wash press", "wash and iron", "wash & iron", "wash iron", "wash and press", "wash, and iron"], serviceId: "11111111-1111-4111-8111-111111111111", garmentTypeId: "22222222-2222-4222-8222-222222222222", garment: "Shirt" },
  { words: ["dry clean", "dry-clean", "dryclean"], serviceId: "44444444-4444-4444-8444-444444444444", garmentTypeId: "55555555-5555-4555-8555-555555555555", garment: "Blazer" },
  { words: ["wash and fold", "wash & fold", "laundry"], serviceId: "aaaa1111-1111-4111-8111-111111111112", garmentTypeId: "aaaa2222-2222-4222-8222-222222222223", garment: "T-shirt" },
  { words: ["press only", "press", "iron", "steam"], serviceId: "bbbb1111-1111-4111-8111-111111111113", garmentTypeId: "bbbb2222-2222-4222-8222-222222222224", garment: "Shirt press" },
];

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

const GARMENT_WORD = "(?:shirts?|trousers?|blazers?|t-?shirts?|cloths|clothes|garments?|pieces?|kurtas?|sarees?|dress shirts?)";

function parseCount(text: string): number | null {
  // Count only when a number is adjacent to a garment word, so pickup times
  // like "between nine and ten" are never mistaken for garment counts.
  const digit = text.match(new RegExp(`(\\d{1,3})\\s*${GARMENT_WORD}`, "i"));
  if (digit) return Math.min(100, parseInt(digit[1], 10));
  const wordAlt = Object.keys(NUMBER_WORDS).join("|");
  const worded = text.match(new RegExp(`\\b(${wordAlt})\\b\\s*${GARMENT_WORD}`, "i"));
  if (worded) return NUMBER_WORDS[worded[1].toLowerCase()];
  // Bare "five clothes" style still counts: "clothes" matches GARMENT_WORD above.
  // Anything else (times, dates) is not a count; ask instead of guessing.
  return null;
}

function parseService(text: string) {
  const lower = text.toLowerCase();
  for (const s of SERVICE_WORDS) if (s.words.some((w) => lower.includes(w))) return s;
  return null;
}

function kolkataDay(base: Date, addDays: number, hour: number, minute: number): Date {
  // Asia/Kolkata is UTC+5:30 with no DST. Build the wall time, convert to UTC.
  const utc = new Date(base.getTime() + addDays * 86400_000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(utc);
  const [y, m, d] = parts.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour - 5, minute - 30, 0));
}

function parseTime(text: string, receivedAt: Date): { start: Date; end: Date } | null {
  // Pickup window only. Return-deadline phrases ("return ... Friday") are
  // parsed separately so the two dates are never confused.
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

/** Parse "return ... Friday before six" style deadlines. Null = no return phrase. */
export function parseReturnDeadline(text: string, receivedAt: Date): { at: Date } | { ambiguous: true } | null {
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
    // Current weekday in Asia/Kolkata.
    const kolkataNow = new Date(receivedAt.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const have = kolkataNow.getDay();
    let delta = (want - have + 7) % 7;
    if (delta === 0) delta = 7; // "Friday" after a Friday means next week.
    let h = parseInt(timeHit[1], 10);
    const m = timeHit[2] ? parseInt(timeHit[2], 10) : 0;
    const ap = timeHit[3] as string | undefined;
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (!ap && h < 12 && /before|by/.test(clause)) {
      // "before six" without am/pm in a laundry context means evening; keep
      // the literal hour but let the caller confirm rather than guessing.
    }
    if (m > 59 || h > 23) return { ambiguous: true };
    return { at: kolkataDay(receivedAt, delta, h, m) };
  }
  // A return phrase without a usable date/time is ambiguous: ask, do not default.
  return { ambiguous: true };
}

interface DraftFields { serviceId?: string; garmentTypeId?: string; quantity?: number; pickupStart?: string; pickupEnd?: string; addressId?: string; requestedReturnBy?: string; uncertainSpans?: string[]; returnNeedsClarification?: boolean }

export async function postMessage(
  db: Pool, actor: Actor | null, text: string, opts?: { receivedAt?: string; draftId?: string; idempotencyKey?: string; providerMessageId?: string; conversationKey?: string; uncertainSpans?: string[] },
) {
  if (!text || text.length > 4000) throw new ApiError("INVALID_INPUT", "Text must be 1..4000 chars", { status: 400 });
  // Model output and message text are untrusted: never execute URLs, SQL, or
  // tool names found in the text. This parser only reads dates/counts/services.
  const receivedAt = opts?.receivedAt ? new Date(opts.receivedAt) : new Date();
  const customerId = actor?.role === "customer" ? actor.id : null;
  const conversationKey = opts?.conversationKey ?? (customerId ? `customer:${customerId}` : "demo");

  // Durable provider message dedupe.
  if (opts?.providerMessageId) {
    const seen = (await db.query(`SELECT * FROM conversation_messages WHERE provider_message_id = $1`, [opts.providerMessageId])).rows[0];
    if (seen) {
      const draft = (await db.query(`SELECT * FROM conversation_drafts WHERE id = $1`, [seen.draft_id])).rows[0];
      return shape(db, draft, "Already handled that message; nothing booked twice.", null);
    }
  }

  let draft = opts?.draftId
    ? (await db.query(`SELECT * FROM conversation_drafts WHERE id = $1`, [opts.draftId])).rows[0]
    : (await db.query(
        `SELECT * FROM conversation_drafts WHERE conversation_key = $1 AND state IN ('COLLECTING','QUOTED') AND expires_at > now() ORDER BY updated_at DESC LIMIT 1`,
        [conversationKey],
      )).rows[0];
  if (opts?.draftId && !draft) throw new ApiError("NOT_FOUND", "Draft not found", { status: 404 });
  if (draft && opts?.draftId) {
    // Explicit draft IDs are private: a customer may only touch their own
    // draft, and a channel sender only its channel-scoped draft. Return 404
    // (not 403) so IDs cannot be probed across users.
    const ownsByCustomer = customerId && draft.customer_id === customerId;
    const ownsByChannel = !customerId && draft.conversation_key === conversationKey;
    if (!ownsByCustomer && !ownsByChannel) throw new ApiError("NOT_FOUND", "Draft not found", { status: 404 });
  }
  if (!draft) {
    draft = (await db.query(
      `INSERT INTO conversation_drafts (customer_id, conversation_key, fields) VALUES ($1,$2,$3) RETURNING *`,
      [customerId, conversationKey, JSON.stringify({})],
    )).rows[0];
  }
  if (new Date(draft.expires_at).getTime() < Date.now()) {
    await db.query(`UPDATE conversation_drafts SET state = 'EXPIRED' WHERE id = $1`, [draft.id]);
    throw new ApiError("INVALID_INPUT", "Draft expired; start over", { status: 400 });
  }

  const fields = (draft.fields ?? {}) as DraftFields;
  const svc = parseService(text);
  if (svc) { fields.serviceId = svc.serviceId; fields.garmentTypeId = svc.garmentTypeId; }
  const count = parseCount(text);
  if (count) fields.quantity = count;
  const window = parseTime(text, receivedAt);
  if (window) { fields.pickupStart = window.start.toISOString(); fields.pickupEnd = window.end.toISOString(); }
  const returnParsed = parseReturnDeadline(text, receivedAt);
  let returnAmbiguous = false;
  if (returnParsed && "at" in returnParsed) {
    fields.requestedReturnBy = (returnParsed.at as Date).toISOString();
    delete fields.returnNeedsClarification;
  } else if (returnParsed && "ambiguous" in returnParsed) {
    returnAmbiguous = true;
    fields.returnNeedsClarification = true;
  }
  if (opts?.uncertainSpans?.length) {
    fields.uncertainSpans = opts.uncertainSpans.slice(0, 20);
  }
  if (!fields.addressId && customerId) {
    const addr = (await db.query(`SELECT id FROM addresses WHERE owner_id = $1 AND deleted = FALSE ORDER BY created_at LIMIT 1`, [customerId])).rows[0];
    if (addr) fields.addressId = addr.id as string;
  }

  const missing: string[] = [];
  if (!fields.serviceId) missing.push("service");
  if (!fields.quantity) missing.push("garment count");
  if (!fields.pickupStart) missing.push("pickup time");
  if (returnAmbiguous) missing.push("return deadline (exact date and time)");
  if (!fields.addressId) missing.push("addressId");

  // A bare "confirm" never books: it echoes the exact dated summary and
  // requires the bound draft/revision/quote confirmation endpoint.
  if (/^\s*confirms?\b/i.test(text) && draft.state === "QUOTED" && draft.quote_id) {
    const summary = exactSummary(fields);
    const updatedConfirm = (await db.query(
      `UPDATE conversation_drafts SET fields = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [JSON.stringify(fields), draft.id],
    )).rows[0];
    return shape(db, updatedConfirm, `${summary} Reply CONFIRM only via the app confirmation for this exact draft revision; nothing is booked yet.`, null);
  }

  let state = missing.length === 0 ? "QUOTED" : "COLLECTING";
  let quote: Record<string, unknown> | null = null;
  if (missing.length === 0 && customerId) {
    try {
      const requestedReturnBy = (fields.requestedReturnBy as string | undefined)
        ?? new Date(new Date(fields.pickupStart as string).getTime() + 5 * 86400_000).toISOString();
      const q = await createQuote(db, { id: customerId, role: "customer", scopes: [] }, {
        addressId: fields.addressId as string,
        lines: [{ serviceId: fields.serviceId as string, garmentTypeId: fields.garmentTypeId as string, quantity: fields.quantity as number }],
        pickupWindow: { start: fields.pickupStart as string, end: fields.pickupEnd as string, timezone: "Asia/Kolkata" },
        requestedReturnBy,
        timezone: "Asia/Kolkata",
      }, { idempotencyKey: `draft:${draft.id}:rev${draft.revision}` });
      quote = q as unknown as Record<string, unknown>;
      await db.query(`UPDATE conversation_drafts SET quote_id = $1 WHERE id = $2`, [(q as { id: string }).id, draft.id]);
    } catch (e) {
      state = "COLLECTING";
      if ((e as ApiError).code === "DEADLINE_UNAVAILABLE" || (e as ApiError).code === "NO_CAPACITY") throw e;
    }
  }

  const updated = (await db.query(
    `UPDATE conversation_drafts SET fields = $1, revision = revision + 1, state = $2, updated_at = now() WHERE id = $3 RETURNING *`,
    [JSON.stringify(fields), state, draft.id],
  )).rows[0];
  const msgId = randomUUID();
  await db.query(
    `INSERT INTO conversation_messages (id, provider_message_id, draft_id, sender, text, transcript) VALUES ($1,$2,$3,'customer',$4,$5)`,
    [msgId, opts?.providerMessageId ?? null, draft.id, text.slice(0, 1000), opts?.uncertainSpans ? JSON.stringify({ uncertainSpans: opts.uncertainSpans }) : null],
  );
  const uncertainNote = fields.uncertainSpans?.length
    ? ` Some words were unclear (${fields.uncertainSpans.slice(0, 3).join("; ")}). Please confirm the exact summary below.`
    : "";
  const reply = missing.length === 0
    ? `${exactSummary(fields)} Confirm this exact draft to pay; nothing is booked yet.${uncertainNote}`
    : `Got it. I still need: ${missing.join(", ")}. A voice note alone never books an order.${uncertainNote}`;
  return shape(db, updated, reply, quote);
}

function exactSummary(f: DraftFields): string {
  const qty = f.quantity ? `${f.quantity}` : "?";
  const pickup = f.pickupStart && f.pickupEnd
    ? `${new Date(f.pickupStart).toISOString()} to ${new Date(f.pickupEnd).toISOString()} Asia/Kolkata`
    : "pickup time TBD";
  const ret = f.requestedReturnBy ? ` Return by ${new Date(f.requestedReturnBy).toISOString()}.` : "";
  return `Draft: ${qty} garment(s), pickup ${pickup}.${ret}`;
}

async function shape(db: Pool, draft: Record<string, unknown>, reply: string, quote: Record<string, unknown> | null) {
  void db;
  const missing: string[] = [];
  const f = (draft.fields ?? {}) as DraftFields;
  if (!f.serviceId) missing.push("service");
  if (!f.quantity) missing.push("garment count");
  if (!f.pickupStart) missing.push("pickup time");
  if (f.returnNeedsClarification) missing.push("return deadline (exact date and time)");
  if (!f.addressId) missing.push("addressId");
  const result: Record<string, unknown> = {
    draft: {
      draftId: draft.id, revision: draft.revision, state: draft.state,
      ...(draft.quote_id ? { quoteId: draft.quote_id } : quote?.id ? { quoteId: quote.id } : {}),
      expiresAt: new Date(draft.expires_at as string).toISOString(), missingFields: missing,
    },
    reply, missingFields: missing,
    ...(quote ? { quote } : {}),
  };
  return result;
}

export async function confirmDraft(
  db: Pool, actor: Actor, draftId: string, revision: number, quoteId: string, meta: { idempotencyKey?: string },
) {
  if (actor.role !== "customer") throw new ApiError("FORBIDDEN", "Only customers", { status: 403 });
  assertUuid(draftId, "draftId");
  assertUuid(quoteId, "quoteId");
  const draft = (await db.query(`SELECT * FROM conversation_drafts WHERE id = $1`, [draftId])).rows[0];
  if (!draft) throw new ApiError("NOT_FOUND", "Draft not found", { status: 404 });
  if (draft.customer_id && draft.customer_id !== actor.id) throw new ApiError("NOT_FOUND", "Draft not found", { status: 404 });
  if (!draft.customer_id) throw new ApiError("FORBIDDEN", "Link this chat to your account before confirming", { status: 403 });
  if (Number(draft.revision) !== revision) throw new ApiError("VERSION_CONFLICT", `Draft revision ${revision} is stale; current is ${draft.revision}`, { status: 409 });
  if (draft.quote_id && draft.quote_id !== quoteId) throw new ApiError("VERSION_CONFLICT", "Quote does not match this draft revision", { status: 409 });
  if (new Date(draft.expires_at).getTime() < Date.now()) throw new ApiError("INVALID_INPUT", "Draft expired", { status: 400 });
  const checkout = await createCheckout(db, actor, quoteId, undefined, { idempotencyKey: meta.idempotencyKey ?? `draft-confirm:${draftId}:${revision}` });
  await db.query(`UPDATE conversation_drafts SET state = 'CHECKOUT_CREATED', updated_at = now() WHERE id = $1`, [draftId]);
  return checkout;
}
