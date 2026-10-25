import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { v2 } from '@laundry/contracts';
import { canonicalJson, createPostgresCommandExecutor } from '../../shared/src/command-executor';
import { verifyWhatsappSignature } from './whatsapp';
import { ConversationsFault } from './v2-errors';

/**
 * Production-v2 conversations.
 *
 * A signed inbound event is authenticated over the exact received bytes before
 * anything is read that could disclose account state, then deduped by provider
 * message id so a replay changes nothing. A draft is assembled from a text
 * message or a voice transcript with a deterministic parser; no model, speech
 * provider or price guess runs in this module.
 *
 * The draft freezes the exact basket it was quoted from. Confirmation needs the
 * customer to quote the draft revision's own token on the channel, and the live
 * quote must still match the frozen snapshot line for line. A changed total, item
 * line or window expires the draft instead of booking changed terms.
 */

const KOLKATA = 'Asia/Kolkata' as const;
const DRAFT_LIFETIME_MINUTES = 120;
const MEDIA_RETENTION_MINUTES = 24 * 60;
const BOOKING_PAYMENT_MODEL = 'DUE_AT_RETURN' as const;
const STAFF = new Set<v2.ActorRole>(['OPERATOR', 'SUPPORT', 'ADMIN']);
const CUSTOMER = new Set<v2.ActorRole>(['CUSTOMER']);
const PROVIDER = /^[a-z0-9-]{1,32}$/;
const PHONE = /^\+[1-9][0-9]{7,14}$/;

/** The basket a draft was quoted from. Everything here must still be true when
 * the customer confirms. */
export interface DraftSnapshot {
  quoteId: string;
  quoteVersion: number;
  serviceCode: v2.ServiceCode;
  billingUnit: 'KG' | 'PIECE';
  quantity: number;
  lines: v2.QuoteLine[];
  totalMinor: number;
  pickupWindow: v2.ScheduleWindow;
  returnWindow: v2.ScheduleWindow;
}

export interface ConversationQuoteInput {
  customerId: string;
  addressId: string;
  serviceId: string;
  billingUnit: 'KG' | 'PIECE';
  quantity: number;
  garmentTypeId?: string;
  pickupWindow: v2.ScheduleWindow;
  requestedReturnBy: string;
  draftId: string;
  revision: number;
  idempotencyKey: string;
  traceId: string;
}

export type ConversationQuoteResult =
  | { ok: true; quote: v2.Quote }
  | { ok: false; reason: 'NO_CAPACITY' | 'DEADLINE_UNAVAILABLE' | 'SERVICE_UNAVAILABLE' | 'FAILED' };

export interface ConversationBookingInput {
  customerId: string;
  draftId: string;
  revision: number;
  quoteId: string;
  quoteVersion: number;
  paymentModel: typeof BOOKING_PAYMENT_MODEL;
  totalMinor: number;
  snapshot: DraftSnapshot;
  idempotencyKey: string;
  traceId: string;
}

export type ConversationBookingResult = { ok: true; order: v2.Order } | { ok: false; reason: string };

/**
 * Port to the order boundary. Both calls take the caller's transaction client
 * because a quote takes a capacity hold and a booking joins the draft
 * transaction; the published OrdersPort cannot express that participation.
 * The in-repo fake implements this without OrdersService.
 */
export interface ConversationOrdersPort {
  quote(tx: PoolClient, input: ConversationQuoteInput): Promise<ConversationQuoteResult>;
  book(tx: PoolClient, input: ConversationBookingInput): Promise<ConversationBookingResult>;
}

export interface ConversationsOptions {
  db: Pool;
  authenticate?: (token: string) => Promise<{ actor: v2.Actor }>;
  clock?: () => Date;
  speech: v2.SpeechPort;
  transport: v2.NotificationTransport;
  orders: ConversationOrdersPort;
  /** Defaults to the Meta Cloud API raw-body HMAC. Override only for another
   * provider scheme or a deterministic test. */
  verifySignature?: (rawBody: Buffer, header: string | undefined) => boolean;
  draftMinutes?: number;
  mediaRetentionMinutes?: number;
}

interface ThreadRow {
  id: string;
  phone: string;
  profile_id: string | null;
  state: 'AUTOMATED' | 'HUMAN_HANDOFF' | 'OPTED_OUT';
  created_at: Date;
  updated_at: Date;
}

interface DraftValues {
  serviceCode?: v2.ServiceCode;
  serviceId?: string;
  billingUnit?: 'KG' | 'PIECE';
  quantity?: number;
  garmentTypeId?: string;
  pickupWindow?: v2.ScheduleWindow;
  requestedReturnBy?: string;
  addressId?: string;
}

interface DraftFields {
  values?: DraftValues;
  lastSource?: 'TEXT' | 'SPEECH';
}

interface DraftRow {
  id: string;
  thread_id: string;
  customer_id: string | null;
  revision: number;
  state: v2.DraftState;
  fields: DraftFields;
  missing_fields: string[];
  snapshot: DraftSnapshot | null;
  confirmation_token: string | null;
  quote_id: string | null;
  quote_version: number | null;
  booking_id: string | null;
  booking: unknown;
  handoff_to: string | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

interface MessageRow {
  id: string;
  thread_id: string;
  provider_message_id: string | null;
  provider: string;
  direction: 'INBOUND' | 'OUTBOUND';
  draft_id: string | null;
  body: string | null;
  audio_media_id: string | null;
  transcript: { status: string; text?: string; confidence?: number; reason?: string } | null;
  reply_text: string | null;
  delivery: string | null;
  received_at: Date;
  retention_expires_at: Date | null;
  created_at: Date;
}

interface QuoteRow {
  id: string;
  version: number;
  customer_id: string;
  status: string;
  area_id: string;
  address_id: string;
  address_snapshot: Record<string, unknown>;
  lines: v2.QuoteLine[];
  rate_cards: v2.RateCard[];
  breakdown: v2.QuoteComponent[];
  total_minor: string | number;
  currency: 'INR';
  provisional: boolean;
  pickup_window: v2.ScheduleWindow;
  return_window: v2.ScheduleWindow;
  hold_reference: string | null;
  hold_expires_at: Date | null;
  catalog_version: number;
  expires_at: Date;
  created_at: Date;
}

interface Ingress {
  provider: string;
  phone: string;
  text: string;
  source: 'TEXT' | 'SPEECH';
  transcript: MessageRow['transcript'];
  audioFailed: boolean;
  audioMediaId?: string;
  providerMessageId: string;
  receivedAt: Date;
}

interface IngestResult {
  thread: ThreadRow;
  draft: DraftRow;
  replyText: string;
  missingFields: string[];
  handoff: boolean;
  suppressOutbound: boolean;
  quote?: v2.Quote;
}

const SERVICE_WORDS: ReadonlyArray<{ code: v2.ServiceCode; label: string; words: readonly string[] }> = [
  { code: 'WASH_FOLD', label: 'Wash and fold', words: ['wash and fold', 'wash & fold', 'washfold', 'wash-fold'] },
  { code: 'WASH_PRESS', label: 'Wash and press', words: ['wash and press', 'wash & press', 'wash and iron', 'wash & iron', 'wash and press'] },
  { code: 'PRESS_ONLY', label: 'Press only', words: ['press only', 'steam press', 'iron only', 'press'] },
  { code: 'DRY_CLEAN', label: 'Dry cleaning', words: ['dry clean', 'dry-clean', 'dryclean'] },
];

const KG_WORDS = /^(?:kg|kgs|kilo|kilos|kilogram|kilograms)$/i;
const PIECE_WORDS = /^(?:piece|pieces|shirt|shirts|trouser|trousers|garment|garments|item|items|saree|sarees|kurta|kurtas)$/i;

export function normalizePhone(phone: string | undefined): string {
  const value = (phone ?? '').trim().replace(/[\s()-]/g, '');
  if (!PHONE.test(value)) throw new ConversationsFault('INVALID_INPUT', 'A number in E.164 form is required');
  return value;
}

export function parseService(text: string): { code: v2.ServiceCode; label: string } | undefined {
  const lower = text.toLowerCase();
  for (const entry of SERVICE_WORDS) {
    if (entry.words.some(word => lower.includes(word))) return { code: entry.code, label: entry.label };
  }
  return undefined;
}

export function parseQuantity(text: string): { quantity: number; billingUnit: 'KG' | 'PIECE' } | undefined {
  const match = text.match(/(\d{1,3})\s*([a-z]+)\b/i);
  if (!match) return undefined;
  const quantity = Number(match[1]);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 200) return undefined;
  const unit = match[2];
  if (KG_WORDS.test(unit)) return { quantity, billingUnit: 'KG' };
  if (PIECE_WORDS.test(unit)) return { quantity, billingUnit: 'PIECE' };
  return undefined;
}

/** Asia/Kolkata is UTC+05:30 with no daylight saving, so the wall clock of a
 * named day converts to an instant without a timezone database lookup. */
function kolkataInstant(base: Date, addDays: number, hour: number, minute: number): Date {
  const shifted = new Date(base.getTime() + addDays * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: KOLKATA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(shifted);
  const [year, month, day] = parts.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 5, minute - 30, 0));
}

/**
 * A pickup window is only accepted when the day and both clock times are
 * explicit, including am/pm. "nine to ten" stays a clarification rather than an
 * invented slot, and a window that has already begun is never quoted.
 */
export function parsePickupWindow(text: string, now: Date): v2.ScheduleWindow | undefined {
  const lower = text.toLowerCase();
  const day = lower.includes('day after tomorrow') ? 2 : lower.includes('tomorrow') ? 1 : lower.includes('today') ? 0 : undefined;
  if (day === undefined) return undefined;
  const range = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:-|to|and|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (!range) return undefined;
  const to24 = (hour: number, meridiem: string): number => {
    if (meridiem === 'pm' && hour < 12) return hour + 12;
    if (meridiem === 'am' && hour === 12) return 0;
    return hour;
  };
  const startHour = to24(Number(range[1]), range[3]);
  const startMinute = range[2] === undefined ? 0 : Number(range[2]);
  const endHour = to24(Number(range[4]), range[6]);
  const endMinute = range[5] === undefined ? 0 : Number(range[5]);
  if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) return undefined;
  const start = kolkataInstant(now, day, startHour, startMinute);
  const end = kolkataInstant(now, day, endHour, endMinute);
  if (end.getTime() <= start.getTime()) return undefined;
  if (start.getTime() <= now.getTime()) return undefined;
  return { start: start.toISOString(), end: end.toISOString(), timezone: KOLKATA };
}

function formatWindow(window: v2.ScheduleWindow): string {
  return `${window.start} to ${window.end} (${window.timezone})`;
}

function rupees(minor: number): string {
  return `INR ${(minor / 100).toFixed(2)}`;
}

function isDraftStateActive(state: v2.DraftState): boolean {
  return state === 'COLLECTING' || state === 'QUOTED' || state === 'CONFIRMED';
}

function assertDraftTransition(from: v2.DraftState, to: v2.DraftState): void {
  if (from === to) return;
  const allowed: readonly v2.DraftState[] = v2.DRAFT_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new ConversationsFault('VERSION_CONFLICT', `A draft cannot move from ${from} to ${to}`, undefined);
  }
}

function sameWindow(left: v2.ScheduleWindow, right: v2.ScheduleWindow): boolean {
  return Date.parse(left.start) === Date.parse(right.start)
    && Date.parse(left.end) === Date.parse(right.end)
    && left.timezone === right.timezone;
}

export class ConversationsService {
  private readonly executor: ReturnType<typeof createPostgresCommandExecutor>;
  private readonly clock: () => Date;
  private readonly draftMinutes: number;
  private readonly mediaRetentionMinutes: number;

  constructor(private readonly options: ConversationsOptions) {
    this.executor = createPostgresCommandExecutor(options.db);
    this.clock = options.clock ?? (() => new Date());
    this.draftMinutes = options.draftMinutes ?? DRAFT_LIFETIME_MINUTES;
    this.mediaRetentionMinutes = options.mediaRetentionMinutes ?? MEDIA_RETENTION_MINUTES;
    if (!Number.isSafeInteger(this.draftMinutes) || this.draftMinutes < 1 || this.draftMinutes > 1440) {
      throw new Error('Draft lifetime must be between 1 and 1440 minutes');
    }
    if (!Number.isSafeInteger(this.mediaRetentionMinutes) || this.mediaRetentionMinutes < 1 || this.mediaRetentionMinutes > 43_200) {
      throw new Error('Media retention must be between 1 and 43200 minutes');
    }
  }

  private async tx<T>(work: (tx: PoolClient) => Promise<T>): Promise<T> {
    const tx = await this.options.db.connect();
    let discard = false;
    try {
      await tx.query('BEGIN');
      await tx.query("SET LOCAL statement_timeout='10s'");
      await tx.query("SET LOCAL lock_timeout='3s'");
      const value = await work(tx);
      await tx.query('COMMIT');
      return value;
    } catch (error) {
      try { await tx.query('ROLLBACK'); } catch { discard = true; }
      throw error;
    } finally { tx.release(discard); }
  }

  private actorOf(token: string, allowed: Set<v2.ActorRole>): Promise<v2.Actor> {
    return (async () => {
      if (!this.options.authenticate) throw new ConversationsFault('UNAUTHENTICATED', 'Sign in again to continue');
      const actor = (await this.options.authenticate(token)).actor;
      if (!allowed.has(actor.role)) throw new ConversationsFault('FORBIDDEN', 'This operation is not permitted for your role');
      return actor;
    })();
  }

  private callMeta(idempotencyKey: string, actorId: string): v2.CommandMeta {
    return {
      idempotencyKey,
      traceId: randomUUID(),
      requestedAt: this.clock().toISOString(),
      actor: { id: actorId, role: 'CUSTOMER', facilityIds: [], scope: { facilityIds: [] } },
    };
  }

  // ---------------------------------------------------------------- inbound

  /**
   * POST /v2/webhooks/conversations/{provider}
   * The signature is checked over the exact bytes before any database read, so
   * a forged body cannot probe whether a number is linked.
   */
  async receive(rawBody: Buffer, signature: string | undefined, provider: string): Promise<v2.ConversationReply> {
    if (!PROVIDER.test(provider)) throw new ConversationsFault('INVALID_INPUT', 'Unknown conversation provider');
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
      throw new ConversationsFault('UNAUTHENTICATED', 'A signed raw body is required');
    }
    const verify = this.options.verifySignature ?? verifyWhatsappSignature;
    if (!verify(rawBody, signature)) throw new ConversationsFault('UNAUTHENTICATED', 'Signature verification failed');

    let parsed: v2.InboundMessage;
    try {
      parsed = v2.inboundMessageSchema.parse(JSON.parse(rawBody.toString('utf8')));
    } catch {
      throw new ConversationsFault('INVALID_INPUT', 'Inbound message does not match the published schema');
    }
    if (parsed.verification !== 'VERIFIED') {
      throw new ConversationsFault('UNAUTHENTICATED', 'The provider did not verify this sender');
    }
    const phone = normalizePhone(parsed.fromPhone);

    const replay = await this.storedReply(parsed.providerMessageId);
    if (replay) return replay;

    const now = this.clock();
    let text = parsed.text?.trim() ?? '';
    let source: 'TEXT' | 'SPEECH' = 'TEXT';
    let transcript: MessageRow['transcript'] = null;
    let audioFailed = false;
    if (parsed.audioMediaId) {
      // Speech runs outside the write transaction; a provider call must never
      // hold a row lock. A voice note is untrusted input either way.
      const result = await this.options.speech.transcribe(
        this.callMeta(`inbound:${parsed.providerMessageId}`, parsed.audioMediaId),
        { mediaId: parsed.audioMediaId, language: 'en' },
      );
      if (result.ok && result.value && result.value.text.trim().length > 0) {
        text = result.value.text.trim();
        source = 'SPEECH';
        transcript = {
          status: 'TRANSCRIBED',
          text,
          ...(result.value.confidence === undefined ? {} : { confidence: result.value.confidence }),
        };
      } else {
        audioFailed = true;
        transcript = { status: 'FAILED', ...(result.reason ? { reason: result.reason } : {}) };
      }
    }
    if (!audioFailed && text.length === 0) {
      throw new ConversationsFault('INVALID_INPUT', 'A message must contain text or a readable voice note');
    }

    const ingress: Ingress = {
      provider,
      phone,
      text: text.slice(0, 4000),
      source,
      transcript,
      audioFailed,
      ...(parsed.audioMediaId === undefined ? {} : { audioMediaId: parsed.audioMediaId }),
      providerMessageId: parsed.providerMessageId,
      receivedAt: new Date(parsed.receivedAt),
    };

    const outcome = await this.tx(tx => this.ingest(tx, ingress));
    if ('replayed' in outcome) return this.replyForStored(outcome.replayed);

    if (!outcome.suppressOutbound && outcome.replyText.trim().length > 0) {
      await this.deliver(outcome);
    }
    return this.envelope(outcome);
  }

  private async ingest(tx: PoolClient, ingress: Ingress): Promise<{ replayed: MessageRow } | IngestResult> {
    // Serializes equal provider events; the unique index is the durable guard.
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [ingress.providerMessageId]);
    const seen = (await tx.query<MessageRow>('SELECT * FROM conversation_v2_messages WHERE provider_message_id=$1', [ingress.providerMessageId])).rows[0];
    if (seen) return { replayed: seen };

    const now = this.clock();
    const thread = await this.ensureThread(tx, ingress.phone);
    const latest = await this.latestDraft(tx, thread.id);

    if (thread.state === 'OPTED_OUT') {
      const draft = latest ?? await this.createDraft(tx, thread);
      const replyText = 'This number has opted out of automated messages. A support operator can restore them if you ask.';
      await this.storeInbound(tx, ingress, thread, draft.id, replyText);
      return { thread, draft, replyText, missingFields: draft.missing_fields, handoff: false, suppressOutbound: true };
    }

    if (thread.state === 'HUMAN_HANDOFF') {
      const draft = latest;
      if (!draft) throw new ConversationsFault('NOT_FOUND', 'Conversation draft not found');
      // Automation stops here: the message is kept for the operator, the draft
      // does not advance, and no automated reply is sent.
      await this.storeInbound(tx, ingress, thread, draft.id, '');
      return { thread, draft, replyText: '', missingFields: draft.missing_fields, handoff: true, suppressOutbound: true };
    }

    if (ingress.audioFailed) {
      const draft = await this.collectingDraft(tx, thread, latest);
      const replyText = 'I could not read that voice note. Please resend it, or type your service, quantity and pickup window with am or pm. Nothing is quoted from an unreadable note.';
      await this.storeInbound(tx, ingress, thread, draft.id, replyText);
      return { thread, draft, replyText, missingFields: draft.missing_fields, handoff: false, suppressOutbound: false };
    }

    const confirmation = /^\s*confir(?:m|med)\b/i.test(ingress.text);
    if (confirmation) return this.confirmOnChannel(tx, thread, latest, ingress);

    return this.applyMessage(tx, thread, latest, ingress);
  }

  private async applyMessage(tx: PoolClient, thread: ThreadRow, latest: DraftRow | undefined, ingress: Ingress): Promise<IngestResult> {
    const now = this.clock();
    let draft = latest;
    let from: v2.DraftState = draft?.state ?? 'COLLECTING';
    if (!draft || !isDraftStateActive(draft.state) || draft.expires_at.getTime() <= now.getTime()) {
      if (draft && isDraftStateActive(draft.state) && draft.expires_at.getTime() <= now.getTime()) {
        await tx.query("UPDATE conversation_v2_drafts SET state='EXPIRED', confirmation_token=NULL, updated_at=$2 WHERE id=$1", [draft.id, now]);
      }
      draft = await this.createDraft(tx, thread);
      from = 'COLLECTING';
    } else if (draft.state === 'CONFIRMED' || draft.state === 'BOOKING_CREATED') {
      // New terms after a confirmation start a fresh revision, so the old token
      // and evidence cannot confirm the changed basket.
      if (draft.state === 'BOOKING_CREATED') {
        draft = await this.createDraft(tx, thread);
        from = 'COLLECTING';
      } else {
        assertDraftTransition(draft.state, 'COLLECTING');
        from = 'CONFIRMED';
      }
    }

    const values: DraftValues = { ...(draft.fields.values ?? {}) };
    const service = parseService(ingress.text);
    if (service) values.serviceCode = service.code;
    const quantity = parseQuantity(ingress.text);
    if (quantity) {
      values.quantity = quantity.quantity;
      values.billingUnit = quantity.billingUnit;
    }
    const window = parsePickupWindow(ingress.text, now);
    if (window) {
      values.pickupWindow = window;
      // A return request is derived from the pickup the customer stated. The
      // promised window still comes from the quote, never from this estimate.
      values.requestedReturnBy = new Date(Date.parse(window.end) + 48 * 3_600_000).toISOString();
    }

    let catalog: { id: string; code: string; billing_unit: 'KG' | 'PIECE' | 'BOTH'; name: string } | undefined;
    if (values.serviceCode) {
      catalog = (await tx.query<{ id: string; code: string; billing_unit: 'KG' | 'PIECE' | 'BOTH'; name: string }>(
        'SELECT id, code, billing_unit, name FROM catalog_services WHERE code=$1 AND active',
        [values.serviceCode],
      )).rows[0];
      if (catalog) values.serviceId = catalog.id;
      else delete values.serviceId;
    }
    if (values.billingUnit && catalog && catalog.billing_unit !== 'BOTH' && catalog.billing_unit !== values.billingUnit) {
      // The service cannot bill in the unit the customer used. Ask again rather
      // than converting pieces to kilograms.
      delete values.quantity;
      delete values.billingUnit;
    }
    if (thread.profile_id) {
      const address = (await tx.query<{ id: string }>(
        'SELECT id FROM identity_addresses WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1',
        [thread.profile_id],
      )).rows[0];
      if (address) values.addressId = address.id;
      else delete values.addressId;
    } else {
      delete values.addressId;
    }

    const missing: string[] = [];
    if (!values.serviceCode) missing.push('service');
    else if (!values.serviceId) missing.push('service that is currently available');
    if (!values.quantity) missing.push('quantity');
    if (!values.pickupWindow) missing.push('pickup time with am or pm');
    if (!values.addressId) missing.push('delivery address on your account');

    const nextRevision = draft.revision + 1;
    let state: v2.DraftState = missing.length === 0 ? 'QUOTED' : 'COLLECTING';
    let quote: v2.Quote | undefined;
    let snapshot: DraftSnapshot | null = null;
    let token: string | null = null;
    let quoteId: string | null = null;
    let quoteVersion: number | null = null;
    let reason: string | undefined;

    if (missing.length === 0 && values.serviceCode && values.serviceId && values.quantity && values.billingUnit && values.pickupWindow && values.requestedReturnBy && values.addressId) {
      const result = await this.options.orders.quote(tx, {
        customerId: thread.profile_id ?? '',
        addressId: values.addressId,
        serviceId: values.serviceId,
        billingUnit: values.billingUnit,
        quantity: values.quantity,
        ...(values.garmentTypeId === undefined ? {} : { garmentTypeId: values.garmentTypeId }),
        pickupWindow: values.pickupWindow,
        requestedReturnBy: values.requestedReturnBy,
        draftId: draft.id,
        revision: nextRevision,
        idempotencyKey: `conversation-draft:${draft.id}:rev${nextRevision}`,
        traceId: randomUUID(),
      });
      if (result.ok) {
        quote = v2.quoteSchema.parse(result.quote);
        snapshot = {
          quoteId: quote.id,
          quoteVersion: quote.version,
          serviceCode: values.serviceCode,
          billingUnit: values.billingUnit,
          quantity: values.quantity,
          lines: quote.lines,
          totalMinor: quote.totalMinor,
          pickupWindow: values.pickupWindow,
          returnWindow: quote.promisedReturnWindow,
        };
        token = randomBytes(8).toString('hex');
        quoteId = quote.id;
        quoteVersion = quote.version;
      } else {
        state = 'COLLECTING';
        reason = result.reason;
      }
    }

    assertDraftTransition(from, state);
    const expiresAt = new Date(now.getTime() + this.draftMinutes * 60_000);
    const updated = (await tx.query<DraftRow>(`UPDATE conversation_v2_drafts SET
      revision=$2, state=$3, fields=$4, missing_fields=$5, snapshot=$6, confirmation_token=$7,
      quote_id=$8, quote_version=$9, handoff_to=NULL, expires_at=$10, updated_at=$11
      WHERE id=$1 RETURNING *`, [
      draft.id, nextRevision, state,
      JSON.stringify({ values, lastSource: ingress.source } satisfies DraftFields),
      JSON.stringify(missing), snapshot === null ? null : JSON.stringify(snapshot), token,
      quoteId, quoteVersion, expiresAt, now,
    ])).rows[0];

    let replyText: string;
    if (state === 'QUOTED' && snapshot && token) {
      replyText = `${service?.label ?? snapshot.serviceCode}: ${quantityLabel(snapshot)}. Pickup ${formatWindow(snapshot.pickupWindow)}. Return ${formatWindow(snapshot.returnWindow)}. Total ${rupees(snapshot.totalMinor)}. Reply CONFIRM ${token.toUpperCase()} to book exactly this. Nothing is booked yet.`;
    } else {
      replyText = `${this.clarification(missing, thread)}${reasonText(reason)} No price is quoted until the request is exact.`;
    }

    await this.storeInbound(tx, ingress, thread, updated.id, replyText);
    await this.audit(tx, thread, updated.id, 'CONVERSATION_DRAFT_UPDATED', state === 'QUOTED' ? 'Customer request quoted' : 'Customer request needs clarification', {
      revision: draft.revision, state: draft.state,
    }, { revision: nextRevision, state, missing });
    return {
      thread, draft: updated, replyText, missingFields: missing, handoff: false, suppressOutbound: false,
      ...(quote === undefined ? {} : { quote }),
    };
  }

  /**
   * The customer quotes the token of the current revision. The token is only a
   * request to confirm: the exact basket must still match, and the booking is
   * created here so a WhatsApp-only customer is not forced into the app.
   */
  private async confirmOnChannel(tx: PoolClient, thread: ThreadRow, latest: DraftRow | undefined, ingress: Ingress): Promise<IngestResult> {
    const now = this.clock();
    if (!latest) throw new ConversationsFault('NOT_FOUND', 'Conversation draft not found');
    const token = (ingress.text.replace(/^\s*confir(?:m|med)\b/i, '').trim().split(/\s+/)[0] ?? '').toUpperCase();

    if (token.length === 0) {
      const replyText = 'Send CONFIRM followed by the code in the draft summary, for example CONFIRM 1A2B3C4D5E6F7A8B.';
      await this.storeInbound(tx, ingress, thread, latest.id, replyText);
      return { thread, draft: latest, replyText, missingFields: latest.missing_fields, handoff: false, suppressOutbound: false };
    }
    if (latest.state === 'BOOKING_CREATED' && latest.booking) {
      const order = v2.orderSchema.parse(latest.booking);
      const replyText = `This draft is already booked as order ${order.id}. No second booking was created.`;
      await this.storeInbound(tx, ingress, thread, latest.id, replyText);
      return { thread, draft: latest, replyText, missingFields: [], handoff: false, suppressOutbound: false };
    }
    if (latest.state !== 'QUOTED' || !latest.confirmation_token || !latest.snapshot || !latest.quote_id || latest.quote_version === null) {
      const replyText = 'There is no current quoted draft to confirm. Send your service, quantity and pickup window to start one.';
      await this.storeInbound(tx, ingress, thread, latest.id, replyText);
      return { thread, draft: latest, replyText, missingFields: latest.missing_fields, handoff: false, suppressOutbound: false };
    }
    if (token !== latest.confirmation_token.toUpperCase()) {
      const replyText = `That confirmation code does not match draft revision ${latest.revision}. Nothing was booked and the draft did not change. Reply with the exact code from the latest summary.`;
      await this.storeInbound(tx, ingress, thread, latest.id, replyText);
      return { thread, draft: latest, replyText, missingFields: latest.missing_fields, handoff: false, suppressOutbound: false };
    }

    const quoteRow = await this.quoteRow(tx, latest.quote_id);
    const drift = this.drift(latest, quoteRow);
    if (drift !== null) {
      const expired = (await tx.query<DraftRow>(
        "UPDATE conversation_v2_drafts SET state='EXPIRED', confirmation_token=NULL, updated_at=$2 WHERE id=$1 RETURNING *",
        [latest.id, now],
      )).rows[0];
      const replyText = `The quoted terms changed (${drift}), so draft revision ${latest.revision} is no longer valid and nothing was booked. Send your request again for a new draft.`;
      await this.storeInbound(tx, ingress, thread, expired.id, replyText);
      await this.audit(tx, thread, expired.id, 'CONVERSATION_DRAFT_EXPIRED', 'Quoted terms changed before confirmation', { state: 'QUOTED' }, { state: 'EXPIRED', drift });
      return { thread, draft: expired, replyText, missingFields: [], handoff: false, suppressOutbound: false };
    }

    try {
      this.assertConfirmable(latest, quoteRow, now);
    } catch (error) {
      if (error instanceof ConversationsFault && error.code === 'QUOTE_EXPIRED') {
        const expired = (await tx.query<DraftRow>(
          "UPDATE conversation_v2_drafts SET state='EXPIRED', confirmation_token=NULL, updated_at=$2 WHERE id=$1 RETURNING *",
          [latest.id, now],
        )).rows[0];
        const replyText = 'That draft or its quote has expired, so nothing was booked. Send your request again for a new draft.';
        await this.storeInbound(tx, ingress, thread, expired.id, replyText);
        return { thread, draft: expired, replyText, missingFields: [], handoff: false, suppressOutbound: false };
      }
      throw error;
    }

    await this.recordConfirmation(tx, latest, ingress, now);
    assertDraftTransition(latest.state, 'CONFIRMED');
    const confirmed = (await tx.query<DraftRow>(
      "UPDATE conversation_v2_drafts SET state='CONFIRMED', updated_at=$2 WHERE id=$1 RETURNING *",
      [latest.id, now],
    )).rows[0];
    const booked = await this.book(tx, confirmed, thread);
    const replyText = `Confirmed exactly and booked as order ${booked.id}: ${quantityLabel(booked.snapshot)}. Pickup ${formatWindow(booked.snapshot.pickupWindow)}. Return ${formatWindow(booked.snapshot.returnWindow)}. Total ${rupees(booked.snapshot.totalMinor)}.`;
    await this.storeInbound(tx, ingress, thread, booked.draft.id, replyText);
    return {
      thread, draft: booked.draft, replyText, missingFields: [], handoff: false, suppressOutbound: false,
      ...(quoteRow === undefined ? {} : { quote: this.quoteFromRow(quoteRow) }),
    };
  }

  // --------------------------------------------------------------- commands

  /** POST /v2/conversations/drafts/{draftId}/confirm */
  async confirm(token: string, draftId: string, input: v2.DraftConfirmation, key: string): Promise<v2.Order> {
    const parsed = v2.draftConfirmationSchema.parse(input);
    v2.idSchema.parse(draftId);
    const actor = await this.actorOf(token, CUSTOMER);
    const result = await this.executor.execute(
      { actor, operation: 'conversations.confirm', idempotencyKey: key, payload: { ...parsed, draftId } as unknown as v2.JsonValue, traceId: randomUUID() },
      async () => { await this.actorOf(token, CUSTOMER); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const draft = (await tx.query<DraftRow>('SELECT * FROM conversation_v2_drafts WHERE id=$1 FOR UPDATE', [draftId])).rows[0];
        if (!draft) throw new ConversationsFault('NOT_FOUND', 'Draft not found');
        if (draft.customer_id === null || draft.customer_id !== actor.id) {
          throw new ConversationsFault('NOT_FOUND', 'Draft not found');
        }
        if (draft.state === 'BOOKING_CREATED' && draft.booking) {
          return v2.orderSchema.parse(draft.booking) as unknown as v2.JsonValue;
        }
        const evidence = (await tx.query<{ id: string }>(
          'SELECT id FROM conversation_v2_confirmations WHERE draft_id=$1 AND revision=$2',
          [draft.id, draft.revision],
        )).rows[0];
        if (!evidence) {
          throw new ConversationsFault('INVALID_INPUT', 'Confirm this exact draft on WhatsApp first; the token for this revision has not been quoted');
        }
        if (draft.quote_id === null) throw new ConversationsFault('INVALID_INPUT', 'The draft has no current quote');
        const quoteRow = await this.quoteRow(tx, draft.quote_id);
        const drift = this.drift(draft, quoteRow);
        if (drift !== null) {
          await tx.query("UPDATE conversation_v2_drafts SET state='EXPIRED', confirmation_token=NULL, updated_at=$2 WHERE id=$1", [draft.id, this.clock()]);
          throw new ConversationsFault('VERSION_CONFLICT', `The quoted terms changed (${drift}); a new draft is required`);
        }
        this.assertConfirmable(draft, quoteRow, this.clock(), parsed);
        const thread = (await tx.query<ThreadRow>('SELECT * FROM conversation_v2_threads WHERE id=$1 FOR UPDATE', [draft.thread_id])).rows[0];
        const booked = await this.book(tx, draft, thread);
        await scope.audit({
          aggregateId: draft.id,
          action: 'CONVERSATION_BOOKED',
          reason: 'Customer confirmed the exact draft revision in the app',
          before: { state: draft.state, revision: draft.revision },
          after: { state: 'BOOKING_CREATED', orderId: booked.id },
        });
        return booked.order as unknown as v2.JsonValue;
      },
    );
    return v2.orderSchema.parse(result);
  }

  /** POST /v2/ops/conversations/{draftId}/handoff */
  async handoff(token: string, draftId: string, input: v2.ConversationHandoff, key: string): Promise<v2.ConversationDraft> {
    const parsed = v2.conversationHandoffSchema.parse(input);
    v2.idSchema.parse(draftId);
    const actor = await this.actorOf(token, STAFF);
    const result = await this.executor.execute(
      { actor, operation: 'conversations.handoff', idempotencyKey: key, payload: { ...parsed, draftId } as unknown as v2.JsonValue, traceId: randomUUID() },
      async () => { await this.actorOf(token, STAFF); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const draft = (await tx.query<DraftRow>('SELECT * FROM conversation_v2_drafts WHERE id=$1 FOR UPDATE', [draftId])).rows[0];
        if (!draft) throw new ConversationsFault('NOT_FOUND', 'Draft not found');
        if (draft.revision !== parsed.expectedRevision) {
          throw new ConversationsFault('VERSION_CONFLICT', 'Draft changed since it was read', draft.revision);
        }
        const now = this.clock();
        if (draft.state !== 'HUMAN_HANDOFF') {
          assertDraftTransition(draft.state, 'HUMAN_HANDOFF');
          const assigned = (await tx.query<DraftRow>(
            "UPDATE conversation_v2_drafts SET state='HUMAN_HANDOFF', handoff_to=$2, updated_at=$3 WHERE id=$1 RETURNING *",
            [draft.id, parsed.assignedTo, now],
          )).rows[0];
          await tx.query(`INSERT INTO conversation_v2_handoffs
            (id,thread_id,draft_id,assigned_to,actor_id,actor_role,reason,assigned_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
            randomUUID(), draft.thread_id, draft.id, parsed.assignedTo, actor.id, actor.role, parsed.reason, now,
          ]);
          await tx.query("UPDATE conversation_v2_threads SET state='HUMAN_HANDOFF', updated_at=$2 WHERE id=$1", [draft.thread_id, now]);
          await scope.audit({
            aggregateId: draft.id,
            action: 'CONVERSATION_HANDED_OFF',
            reason: parsed.reason,
            before: { state: draft.state, revision: draft.revision },
            after: { state: 'HUMAN_HANDOFF', assignedTo: parsed.assignedTo },
          });
          return this.projectDraft(assigned) as unknown as v2.JsonValue;
        }
        return this.projectDraft(draft) as unknown as v2.JsonValue;
      },
    );
    return v2.conversationDraftSchema.parse(result);
  }

  /** POST /v2/conversations/opt-out */
  async optOut(token: string, input: v2.ConversationOptOut, key: string): Promise<v2.OptOutResult> {
    const parsed = v2.conversationOptOutSchema.parse(input);
    const actor = await this.actorOf(token, CUSTOMER);
    const result = await this.executor.execute(
      { actor, operation: 'conversations.optout', idempotencyKey: key, payload: parsed as unknown as v2.JsonValue, traceId: randomUUID() },
      async () => { await this.actorOf(token, CUSTOMER); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const link = (await tx.query<{ phone: string }>('SELECT phone FROM identity_whatsapp_links WHERE profile_id=$1', [actor.id])).rows[0];
        if (!link) throw new ConversationsFault('INVALID_INPUT', 'Link a verified WhatsApp number before opting out');
        const now = this.clock();
        await tx.query(`INSERT INTO conversation_v2_optouts (phone,channel,source,actor_id,opted_out_at)
          VALUES ($1,'WHATSAPP','CUSTOMER_ROUTE',$2,$3) ON CONFLICT (phone) DO NOTHING`, [link.phone, actor.id, now]);
        await tx.query(`UPDATE conversation_v2_threads SET state='OPTED_OUT', updated_at=$2 WHERE phone=$1`, [link.phone, now]);
        await scope.audit({
          aggregateId: actor.id,
          action: 'CONVERSATION_OPTED_OUT',
          reason: 'Customer opted out of automated WhatsApp messages',
          before: {},
          after: { channel: 'WHATSAPP' },
        });
        return { optedOut: true } as unknown as v2.JsonValue;
      },
    );
    return v2.optOutResultSchema.parse(result);
  }

  /**
   * Retention sweep for audio the provider left behind. Transcripts and media
   * ids are cleared together; the message row stays as a delivery record.
   */
  async redactExpiredMedia(limit = 100): Promise<number> {
    const rows = await this.options.db.query<{ id: string }>(`UPDATE conversation_v2_messages SET audio_media_id=NULL, transcript=NULL
      WHERE id IN (
        SELECT id FROM conversation_v2_messages
        WHERE audio_media_id IS NOT NULL AND retention_expires_at IS NOT NULL AND retention_expires_at <= $1
        ORDER BY retention_expires_at LIMIT $2
      ) RETURNING id`, [this.clock(), limit]);
    return rows.rowCount ?? 0;
  }

  // ---------------------------------------------------------------- helpers

  private async book(tx: PoolClient, draft: DraftRow, thread: ThreadRow): Promise<{ order: v2.Order; draft: DraftRow; id: string; snapshot: DraftSnapshot }> {
    if (!draft.snapshot || draft.quote_id === null || draft.quote_version === null) {
      throw new ConversationsFault('INVALID_INPUT', 'The draft has no frozen basket to book');
    }
    if (draft.customer_id === null) throw new ConversationsFault('FORBIDDEN', 'Link this chat to your account before booking');
    if (draft.state === 'BOOKING_CREATED' && draft.booking) {
      const stored = v2.orderSchema.parse(draft.booking);
      return { order: stored, draft, id: stored.id, snapshot: draft.snapshot };
    }
    assertDraftTransition(draft.state, 'BOOKING_CREATED');
    const idempotencyKey = `conversation-draft:${draft.id}:rev${draft.revision}`;
    const result = await this.options.orders.book(tx, {
      customerId: draft.customer_id,
      draftId: draft.id,
      revision: draft.revision,
      quoteId: draft.quote_id,
      quoteVersion: draft.quote_version,
      paymentModel: BOOKING_PAYMENT_MODEL,
      totalMinor: draft.snapshot.totalMinor,
      snapshot: draft.snapshot,
      idempotencyKey,
      traceId: randomUUID(),
    });
    if (!result.ok) {
      throw new ConversationsFault('PROVIDER_OUTCOME_UNKNOWN', 'The booking did not complete; retry the same confirmation');
    }
    const order = v2.orderSchema.parse(result.order);
    if (order.totalMinor !== draft.snapshot.totalMinor) {
      throw new ConversationsFault('PROVIDER_OUTCOME_UNKNOWN', 'The created order does not match the confirmed total');
    }
    if (order.customerId !== draft.customer_id) {
      throw new ConversationsFault('PROVIDER_OUTCOME_UNKNOWN', 'The created order belongs to another customer');
    }
    const now = this.clock();
    const updated = (await tx.query<DraftRow>(
      "UPDATE conversation_v2_drafts SET state='BOOKING_CREATED', booking_id=$2, booking=$3, updated_at=$4 WHERE id=$1 RETURNING *",
      [draft.id, order.id, JSON.stringify(order), now],
    )).rows[0];
    await this.audit(tx, thread, draft.id, 'CONVERSATION_BOOKING_CREATED', 'Exact draft confirmation created one booking', {
      quoteId: draft.quote_id, quoteVersion: draft.quote_version, revision: draft.revision,
    }, { orderId: order.id, totalMinor: order.totalMinor });
    return { order, draft: updated, id: order.id, snapshot: draft.snapshot };
  }

  private assertConfirmable(draft: DraftRow, quoteRow: QuoteRow | undefined, now: Date, confirmation?: v2.DraftConfirmation): void {
    if (!quoteRow) throw new ConversationsFault('QUOTE_EXPIRED', 'The draft quote no longer exists');
    try {
      const projected = this.projectDraft(draft);
      v2.assertDraftConfirmation({
        draft: projected,
        confirmation: confirmation ?? {
          draftId: draft.id,
          revision: draft.revision,
          quoteId: draft.quote_id ?? quoteRow.id,
          quoteVersion: draft.quote_version ?? quoteRow.version,
        },
        quote: { id: quoteRow.id, version: Number(quoteRow.version), expiresAt: quoteRow.expires_at.toISOString() },
        now: now.toISOString(),
      });
    } catch (error) {
      if (error instanceof v2.TransitionError) throw new ConversationsFault(error.code, error.message);
      throw error;
    }
  }

  /** Returns a short reason when the live quote no longer matches the frozen
   * snapshot, or null when it still matches exactly. */
  private drift(draft: DraftRow, quoteRow: QuoteRow | undefined): string | null {
    const snapshot = draft.snapshot;
    if (!snapshot) return 'no frozen basket';
    if (!quoteRow) return 'the quote no longer exists';
    if (quoteRow.id !== snapshot.quoteId) return 'a different quote';
    if (Number(quoteRow.version) !== snapshot.quoteVersion) return 'the quote version';
    if (Number(quoteRow.total_minor) !== snapshot.totalMinor) return 'the total';
    if (canonicalJson(quoteRow.lines) !== canonicalJson(snapshot.lines)) return 'the item lines';
    if (!sameWindow(quoteRow.pickup_window, snapshot.pickupWindow)) return 'the pickup window';
    if (!sameWindow(quoteRow.return_window, snapshot.returnWindow)) return 'the return window';
    return null;
  }

  private async recordConfirmation(tx: PoolClient, draft: DraftRow, ingress: Ingress, now: Date): Promise<void> {
    if (!draft.snapshot || draft.quote_id === null || draft.quote_version === null || draft.confirmation_token === null) {
      throw new ConversationsFault('INVALID_INPUT', 'The draft has no confirmation token');
    }
    await tx.query(`INSERT INTO conversation_v2_confirmations
      (id,draft_id,revision,quote_id,quote_version,token,total_minor,snapshot_hash,provider_message_id,evidence,quoted_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (draft_id,revision) DO NOTHING`, [
      randomUUID(), draft.id, draft.revision, draft.quote_id, draft.quote_version,
      draft.confirmation_token, draft.snapshot.totalMinor,
      createHash('sha256').update(canonicalJson(draft.snapshot)).digest('hex'),
      ingress.providerMessageId,
      JSON.stringify({
        provider: ingress.provider,
        providerMessageId: ingress.providerMessageId,
        textHash: createHash('sha256').update(ingress.text).digest('hex'),
        revision: draft.revision,
        quoteId: draft.quote_id,
        quoteVersion: draft.quote_version,
        totalMinor: draft.snapshot.totalMinor,
        matchedAt: now.toISOString(),
      }),
      now,
    ]);
  }

  private async ensureThread(tx: PoolClient, phone: string): Promise<ThreadRow> {
    const link = (await tx.query<{ profile_id: string }>('SELECT profile_id FROM identity_whatsapp_links WHERE phone=$1', [phone])).rows[0];
    const now = this.clock();
    const existing = (await tx.query<ThreadRow>('SELECT * FROM conversation_v2_threads WHERE phone=$1 FOR UPDATE', [phone])).rows[0];
    if (existing) {
      if (existing.profile_id === null && link) {
        // A number linked after the first draft adopts the existing thread and
        // its drafts, so a confirmed draft can still be booked by that account.
        await tx.query('UPDATE conversation_v2_drafts SET customer_id=$2, updated_at=$3 WHERE thread_id=$1 AND customer_id IS NULL', [
          existing.id, link.profile_id, now,
        ]);
        return (await tx.query<ThreadRow>(
          'UPDATE conversation_v2_threads SET profile_id=$2, updated_at=$3 WHERE id=$1 RETURNING *',
          [existing.id, link.profile_id, now],
        )).rows[0];
      }
      return existing;
    }
    return (await tx.query<ThreadRow>(`INSERT INTO conversation_v2_threads (id,phone,profile_id,state,created_at,updated_at)
      VALUES ($1,$2,$3,'AUTOMATED',$4,$4) RETURNING *`, [randomUUID(), phone, link?.profile_id ?? null, now])).rows[0];
  }

  private async latestDraft(tx: PoolClient, threadId: string): Promise<DraftRow | undefined> {
    return (await tx.query<DraftRow>(
      'SELECT * FROM conversation_v2_drafts WHERE thread_id=$1 ORDER BY updated_at DESC, created_at DESC LIMIT 1',
      [threadId],
    )).rows[0];
  }

  /** A draft that can still be edited. An expired or finished draft is replaced
   * rather than reopened, so an old token can never be reused. */
  private async collectingDraft(tx: PoolClient, thread: ThreadRow, latest: DraftRow | undefined): Promise<DraftRow> {
    const now = this.clock();
    if (latest && isDraftStateActive(latest.state) && latest.expires_at.getTime() > now.getTime()) return latest;
    if (latest && isDraftStateActive(latest.state)) {
      await tx.query("UPDATE conversation_v2_drafts SET state='EXPIRED', confirmation_token=NULL, updated_at=$2 WHERE id=$1", [latest.id, now]);
    }
    return this.createDraft(tx, thread);
  }

  private async createDraft(tx: PoolClient, thread: ThreadRow): Promise<DraftRow> {
    const now = this.clock();
    return (await tx.query<DraftRow>(`INSERT INTO conversation_v2_drafts
      (id,thread_id,customer_id,revision,state,fields,missing_fields,snapshot,confirmation_token,quote_id,
       quote_version,booking_id,booking,handoff_to,expires_at,created_at,updated_at)
      VALUES ($1,$2,$3,0,'COLLECTING',$4,$5,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$6,$7,$7) RETURNING *`, [
      randomUUID(), thread.id, thread.profile_id,
      JSON.stringify({ values: {}, lastSource: 'TEXT' } satisfies DraftFields),
      JSON.stringify(['service', 'quantity', 'pickup time with am or pm', 'delivery address on your account']),
      new Date(now.getTime() + this.draftMinutes * 60_000), now,
    ])).rows[0];
  }

  private async storeInbound(tx: PoolClient, ingress: Ingress, thread: ThreadRow, draftId: string, replyText: string): Promise<MessageRow> {
    const now = this.clock();
    // Audio is only held as long as the retention window allows; the transcript
    // is stored only when a provider actually produced one.
    const retention = ingress.transcript === null ? null : new Date(now.getTime() + this.mediaRetentionMinutes * 60_000);
    return (await tx.query<MessageRow>(`INSERT INTO conversation_v2_messages
      (id,thread_id,provider_message_id,provider,direction,draft_id,body,audio_media_id,transcript,reply_text,delivery,received_at,retention_expires_at,created_at)
      VALUES ($1,$2,$3,$4,'INBOUND',$5,$6,$7,$8,$9,NULL,$10,$11,$12) RETURNING *`, [
      randomUUID(), thread.id, ingress.providerMessageId, ingress.provider, draftId,
      ingress.text.length === 0 ? null : ingress.text,
      ingress.audioMediaId ?? null,
      ingress.transcript === null ? null : JSON.stringify(ingress.transcript),
      replyText, ingress.receivedAt, retention, now,
    ])).rows[0];
  }

  private async audit(
    tx: PoolClient,
    thread: ThreadRow,
    draftId: string,
    action: string,
    reason: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): Promise<void> {
    const actorId = thread.profile_id ?? thread.id;
    await tx.query(`INSERT INTO v2_audit (actor_id,actor_role,aggregate_id,action,reason,before_value,after_value,trace_id)
      VALUES ($1,'CUSTOMER',$2,$3,$4,$5,$6,$7)`, [
      actorId, draftId, action, reason.slice(0, 2000), canonicalJson(before), canonicalJson(after), randomUUID(),
    ]);
  }

  private async quoteRow(tx: PoolClient, quoteId: string): Promise<QuoteRow | undefined> {
    return (await tx.query<QuoteRow>('SELECT * FROM orders_v2_quotes WHERE id=$1', [quoteId])).rows[0];
  }

  private quoteFromRow(row: QuoteRow): v2.Quote {
    return v2.quoteSchema.parse({
      id: row.id,
      version: Number(row.version),
      lines: row.lines,
      totalMinor: Number(row.total_minor),
      currency: row.currency,
      provisional: row.provisional,
      expiresAt: row.expires_at.toISOString(),
      addressSnapshotId: row.address_id,
      pickupWindow: row.pickup_window,
      promisedReturnWindow: row.return_window,
      ...(row.hold_reference === null ? {} : { holdReference: row.hold_reference }),
      ...(row.hold_expires_at === null ? {} : { holdExpiresAt: row.hold_expires_at.toISOString() }),
      catalogVersion: row.catalog_version,
      breakdown: row.breakdown,
    });
  }

  private projectDraft(draft: DraftRow): v2.ConversationDraft {
    const values = draft.fields.values ?? {};
    const source = draft.fields.lastSource ?? 'TEXT';
    const quantityValue = values.quantity === undefined
      ? undefined
      : `${values.quantity} ${values.billingUnit === 'KG' ? 'kg' : 'pieces'}`;
    const field = (name: v2.DraftField['name'], value: string | undefined): v2.DraftField => ({
      name,
      ...(value === undefined ? {} : { value }),
      confidence: value === undefined ? 'MISSING' : 'HIGH',
      source,
    });
    return v2.conversationDraftSchema.parse({
      draftId: draft.id,
      revision: draft.revision,
      state: draft.state,
      fields: [
        field('SERVICE', values.serviceCode),
        field('QUANTITY', quantityValue),
        // The saved address is never echoed; the customer sees only that one is on file.
        field('ADDRESS', values.addressId === undefined ? undefined : 'saved address on file'),
        field('PICKUP_WINDOW', values.pickupWindow === undefined ? undefined : formatWindow(values.pickupWindow)),
        field('RETURN_BY', values.requestedReturnBy),
        field('CARE_NOTES', undefined),
      ],
      ...(draft.quote_id === null || draft.quote_version === null ? {} : { quoteId: draft.quote_id, quoteVersion: draft.quote_version }),
      expiresAt: draft.expires_at.toISOString(),
      missingFields: draft.missing_fields,
      ...(draft.state === 'HUMAN_HANDOFF' && draft.handoff_to !== null ? { handoffTo: draft.handoff_to } : {}),
    });
  }

  private clarification(missing: string[], thread: ThreadRow): string {
    const list = missing.length === 0 ? '' : `I still need: ${missing.join(', ')}.`;
    const link = thread.profile_id === null
      ? ' Link this WhatsApp number to your account in the app so a saved address can be used; no address is disclosed to an unlinked number.'
      : '';
    return `${list}${link} Example: wash and fold 5 kg tomorrow 9am-10am.`;
  }

  private async deliver(outcome: IngestResult): Promise<void> {
    const recipientId = outcome.thread.profile_id ?? outcome.thread.id;
    const result = await this.options.transport.send(
      this.callMeta(`conversation-reply:${outcome.draft.id}:${outcome.draft.revision}`, recipientId),
      {
        recipientId,
        channel: 'WHATSAPP',
        template: 'CONVERSATION_REPLY',
        variables: { body: outcome.replyText.slice(0, 1000), draftId: outcome.draft.id, revision: String(outcome.draft.revision) },
      },
    );
    const delivery = result.ok ? 'SENT' : result.reason === 'OPTED_OUT' ? 'BLOCKED_OPT_OUT' : 'FAILED';
    await this.options.db.query(`INSERT INTO conversation_v2_messages
      (id,thread_id,provider_message_id,provider,direction,draft_id,body,audio_media_id,transcript,reply_text,delivery,received_at,retention_expires_at,created_at)
      VALUES ($1,$2,$3,'internal','OUTBOUND',$4,$5,NULL,NULL,$5,$6,$7,NULL,$7)
      ON CONFLICT (provider_message_id) DO NOTHING`, [
      randomUUID(), outcome.thread.id, result.ok ? result.value?.messageId ?? null : null,
      outcome.draft.id, outcome.replyText.slice(0, 4000), delivery, this.clock(),
    ]);
  }

  private envelope(outcome: IngestResult): v2.ConversationReply {
    return v2.conversationReplySchema.parse({
      draft: this.projectDraft(outcome.draft),
      reply: outcome.replyText,
      missingFields: outcome.missingFields,
      ...(outcome.quote === undefined ? {} : { quote: outcome.quote }),
      handoff: outcome.handoff,
    });
  }

  private async storedReply(providerMessageId: string): Promise<v2.ConversationReply | null> {
    const message = (await this.options.db.query<MessageRow>(
      'SELECT * FROM conversation_v2_messages WHERE provider_message_id=$1',
      [providerMessageId],
    )).rows[0];
    if (!message) return null;
    return this.replyForStored(message);
  }

  private async replyForStored(message: MessageRow): Promise<v2.ConversationReply> {
    const draft = message.draft_id === null ? undefined : (await this.options.db.query<DraftRow>(
      'SELECT * FROM conversation_v2_drafts WHERE id=$1', [message.draft_id],
    )).rows[0];
    if (!draft) throw new ConversationsFault('NOT_FOUND', 'Draft not found for a stored message');
    const thread = (await this.options.db.query<ThreadRow>('SELECT * FROM conversation_v2_threads WHERE id=$1', [draft.thread_id])).rows[0];
    const quote = draft.quote_id === null ? undefined : (await this.options.db.query<QuoteRow>(
      'SELECT * FROM orders_v2_quotes WHERE id=$1', [draft.quote_id],
    )).rows[0];
    return v2.conversationReplySchema.parse({
      draft: this.projectDraft(draft),
      reply: message.reply_text ?? '',
      missingFields: draft.missing_fields,
      ...(quote === undefined || !['QUOTED', 'CONFIRMED', 'BOOKING_CREATED'].includes(draft.state) ? {} : { quote: this.quoteFromRow(quote) }),
      handoff: thread?.state === 'HUMAN_HANDOFF',
    });
  }
}

function quantityLabel(snapshot: DraftSnapshot): string {
  const word = snapshot.billingUnit === 'KG' ? 'kg' : snapshot.quantity === 1 ? 'piece' : 'pieces';
  return `${snapshot.quantity} ${word}`;
}

function reasonText(reason: string | undefined): string {
  switch (reason) {
    case 'NO_CAPACITY': return 'That pickup window has no capacity left.';
    case 'DEADLINE_UNAVAILABLE': return 'That pickup window cannot meet the return time.';
    case 'SERVICE_UNAVAILABLE': return 'That service is not published right now.';
    case 'FAILED': return 'Pricing is unavailable right now.';
    default: return '';
  }
}
