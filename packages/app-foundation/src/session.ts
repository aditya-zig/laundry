import { UnknownOutcomeError, V2ApiError, type Actor, type V2Client } from '@laundry/api-client';
import { v2 } from '@laundry/contracts';
import { StorageError, asSecureTokenStore, asPendingMutationStore, type SecureTokenStore, type PendingMutationStore, type QueuedMutationRecord } from './ports.js';
export { StorageError, asPendingMutationStore, asSecureTokenStore, createMemoryPendingMutationStore, createMemorySecureTokenStore } from './ports.js';
export type { PendingMutationStore, QueuedMutationRecord, SecureTokenStore } from './ports.js';
export type SessionSnapshot = { state: 'authenticated'; actor: Actor; sessionId: string } | { state: 'signedOut' } | { state: 'restoreFailed'; cause: unknown };
type CommandArgs = {
  'orders.book': { body: v2.BookingInput };
  'orders.quote': { body: v2.QuoteInput };
  'identity.address.create': { body: v2.AddressInput };
  'logistics.rider.handover': { params: { jobId: string }; body: Omit<v2.RiderHandover, 'jobId'> };
  'billing.manual.confirm': { params: { obligationId: string }; body: v2.ManualPaymentConfirmation };
  'billing.refund.create': { body: v2.RefundRequest };
};
type CommandResults = {
  'orders.book': v2.Order; 'orders.quote': v2.Quote; 'identity.address.create': v2.Address;
  'logistics.rider.handover': v2.HandoverResult; 'billing.manual.confirm': v2.Receipt; 'billing.refund.create': v2.Refund;
};
type CommandRoute = keyof CommandArgs;
export type QueuedMutationDescriptor<K extends CommandRoute = CommandRoute> = { routeId: K; params?: Record<string, string> } & CommandArgs[K];
export interface SessionFoundationOptions {
  /** Pure client factory: may also create a short-lived revocation client. */
  wireClient: (getAccessToken: () => string | undefined) => V2Client;
  refreshTokenStore: SecureTokenStore;
  pendingMutationStore: PendingMutationStore;
  clock?: () => Date;
  refreshLeadMs?: number;
  generateKey?: () => string;
  onIdentityChange?: (actor: Actor | null) => void;
}
export interface FlushReport { confirmed: QueuedMutationRecord[]; discardedStale: QueuedMutationRecord[]; pending: Array<{ record: QueuedMutationRecord; cause: unknown }> }
export interface LogoutReport { serverRevocationConfirmed: boolean; revocationError: unknown; localCredsCleared: boolean }
export interface SessionFoundation {
  getPlainV2Client(): V2Client;
  initialize(): Promise<SessionSnapshot>;
  adoptAuthenticatedSession(session: v2.Session): Promise<void>;
  getActor(): Actor | null;
  snapshot(): SessionSnapshot;
  ensureAuthenticated(): Promise<Actor>;
  /** Reads, or mutations whose callback explicitly retains its command key. */
  authorized<T>(run: (client: V2Client) => Promise<T>): Promise<T>;
  /** Known SDK commands replay from immutable stored DTOs, never UI closures. */
  enqueueMutation<K extends CommandRoute>(descriptor: QueuedMutationDescriptor<K>): Promise<CommandResults[K]>;
  flushQueuedMutations(): Promise<FlushReport>;
  listQueuedMutations(): Promise<QueuedMutationRecord[]>;
  registerPrivateCache(invalidate: () => void): () => void;
  logout(): Promise<LogoutReport>;
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Non-finite values cannot form a command intent');
    return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item;
  });
}
const identityKey = (actor: Actor) => JSON.stringify({ ...actor, facilityIds: [...actor.facilityIds].sort(), scope: { ...actor.scope, facilityIds: [...(actor.scope.facilityIds ?? [])].sort() } });
const unauthenticated = () => new V2ApiError(401, { code: 'UNAUTHENTICATED', message: 'Sign in again to continue', traceId: 'session-foundation', retryable: false });
const unauthorized = (error: unknown) => error instanceof V2ApiError && error.status === 401;
type Session = v2.Session;
type Credentials = { refreshToken: string; refreshKey?: string };
function decodeCredentials(raw: string): Credentials {
  if (!raw.startsWith('{')) return { refreshToken: raw }; // Existing refresh-only store migration.
  try {
    const data = JSON.parse(raw);
    if (data.version !== 1 || typeof data.refreshToken !== 'string' || (data.refreshKey !== undefined && typeof data.refreshKey !== 'string')) throw new Error();
    return { refreshToken: data.refreshToken, ...(data.refreshKey === undefined ? {} : { refreshKey: data.refreshKey }) };
  } catch { throw new StorageError('Stored refresh intent is invalid'); }
}

// Fixed first-party dispatch. Persisted text never becomes a URL, tool name,
// arbitrary property lookup or provider action. Each SDK method validates DTOs.
function sendRecord(client: V2Client, record: QueuedMutationRecord): Promise<unknown> {
  const body = record.bodyJson === null ? undefined : JSON.parse(record.bodyJson);
  const opts = { idempotencyKey: record.idempotencyKey };
  switch (record.routeId) {
    case 'orders.book': return client.bookOrder(body, opts);
    case 'orders.quote': return client.createQuote(body, opts);
    case 'identity.address.create': return client.createAddress(body, opts);
    case 'logistics.rider.handover': return client.recordHandover(record.params.jobId, body, opts);
    case 'billing.manual.confirm': return client.confirmManualPayment(record.params.obligationId, body, opts);
    case 'billing.refund.create': return client.createRefund(body, opts);
    default: return Promise.reject(new UnknownOutcomeError('No approved replay sender exists; reconcile the retained intent', undefined, record.idempotencyKey));
  }
}
export function createSessionFoundation(options: SessionFoundationOptions): SessionFoundation {
  const store = asSecureTokenStore(options.refreshTokenStore), queue = asPendingMutationStore(options.pendingMutationStore);
  const clock = options.clock ?? (() => new Date()), generateKey = options.generateKey ?? (() => crypto.randomUUID());
  const lead = options.refreshLeadMs ?? 30_000;
  if (!Number.isFinite(lead) || lead < 0 || lead > 300_000) throw new Error('Refresh lead must be bounded');
  let session: Session | null = null, credentials: Credentials | null = null, state: SessionSnapshot = { state: 'signedOut' };
  let generation = 0, refreshFlight: Promise<void> | null = null, lastIdentity: string | undefined;
  let writes: Promise<void> = Promise.resolve(), preparations: Promise<void> = Promise.resolve();
  const activeCommands = new Map<string, Promise<unknown>>();
  const caches = new Set<() => void>();
  const client = options.wireClient(() => session?.accessToken);
  function write(value: string | null): Promise<void> {
    const result = writes.then(() => store.write(value)); writes = result.catch(() => undefined); return result;
  }
  function notify(actor: Actor | null) {
    const signature = JSON.stringify(actor);
    if (signature === lastIdentity) return;
    lastIdentity = signature;
    for (const invalidate of caches) { try { invalidate(); } catch { /* Cache code cannot prevent credential teardown. */ } }
    options.onIdentityChange?.(actor === null ? null : copy(actor));
  }
  function clear() { session = null; credentials = null; state = { state: 'signedOut' }; notify(null); }
  function adopt(value: Session) {
    session = v2.sessionSchema.parse(value); credentials = { refreshToken: session.refreshToken };
    state = { state: 'authenticated', actor: copy(session.actor), sessionId: session.sessionId }; notify(session.actor);
  }
  async function revokeIssued(value: Session) {
    try { await options.wireClient(() => value.accessToken).logout(); } catch { /* Revocation cannot disguise the original failure. */ }
  }
  async function refresh() {
    if (refreshFlight) return refreshFlight;
    const started = generation;
    refreshFlight = (async () => {
      if (!credentials?.refreshToken) throw unauthenticated();
      const token = credentials.refreshToken, key = credentials.refreshKey ?? generateKey();
      credentials = { refreshToken: token, refreshKey: key };
      // Journal the SAME rotation identity before sending. A transport loss or
      // process restart must not look like a refresh-token replay to the API.
      await write(JSON.stringify({ version: 1, ...credentials }));
      if (generation !== started) throw unauthenticated();
      const value = await client.refreshSession(token, { idempotencyKey: key });
      if (generation !== started) { await revokeIssued(value); throw unauthenticated(); }
      try { await write(value.refreshToken); }
      catch (error) { await revokeIssued(value); throw error; }
      if (generation !== started) { await revokeIssued(value); throw unauthenticated(); }
      adopt(value);
    })().catch(async error => {
      if (generation !== started) throw error;
      if (unauthorized(error)) { generation++; clear(); await write(null).catch(() => undefined); }
      else if (error instanceof StorageError) { session = null; state = { state: 'restoreFailed', cause: error }; notify(null); }
      // Unknown transport outcomes keep the stored rotation key for recovery.
      throw error;
    }).finally(() => { refreshFlight = null; });
    return refreshFlight;
  }
  async function requireActor() {
    if (!session) throw unauthenticated();
    if (Date.parse(session.expiresAt) <= clock().getTime() + lead) await refresh();
    if (!session) throw unauthenticated();
    return copy(session.actor);
  }
  const foundation: SessionFoundation = {
    getPlainV2Client: () => client,
    async initialize() {
      const started = generation;
      try {
        const stored = await store.read();
        if (generation !== started) throw unauthenticated();
        if (!stored) { clear(); return copy(state); }
        credentials = decodeCredentials(stored);
        await refresh();
        const actor = await client.me();
        if (!session || generation !== started) throw unauthenticated();
        session.actor = actor; state = { state: 'authenticated', actor: copy(actor), sessionId: session.sessionId }; notify(actor);
      } catch (error) {
        if (generation !== started) return state.state === 'restoreFailed' ? state : copy(state);
        if (unauthorized(error)) { clear(); await write(null).catch(() => undefined); }
        else { session = null; state = { state: 'restoreFailed', cause: error }; notify(null); }
      }
      return state.state === 'restoreFailed' ? state : copy(state);
    },
    async adoptAuthenticatedSession(value) {
      const parsed = v2.sessionSchema.parse(value), started = ++generation;
      try { await write(parsed.refreshToken); }
      catch (error) { await revokeIssued(parsed); if (generation === started) clear(); throw error; }
      if (generation !== started) { await revokeIssued(parsed); throw unauthenticated(); }
      adopt(parsed);
    },
    getActor: () => session ? copy(session.actor) : null,
    snapshot: () => state.state === 'restoreFailed' ? state : copy(state),
    ensureAuthenticated: requireActor,
    async authorized(run) {
      const started = generation;
      await requireActor();
      if (generation !== started) throw unauthenticated();
      try { return await run(client); }
      catch (error) {
        if (!unauthorized(error) || generation !== started) throw error;
        await refresh();
        if (generation !== started) throw unauthenticated();
        try { return await run(client); }
        catch (second) { if (unauthorized(second) && generation === started) { generation++; clear(); await write(null).catch(() => undefined); } throw second; }
      }
    },
    enqueueMutation<K extends CommandRoute>(descriptor: QueuedMutationDescriptor<K>): Promise<CommandResults[K]> {
      const intent = copy(descriptor), started = generation;
      const bodyJson = canonicalJson(intent.body), params = copy(intent.params ?? {});
      const fingerprint = canonicalJson({ started, routeId: intent.routeId, params, bodyJson });
      const active = activeCommands.get(fingerprint);
      if (active) return active as Promise<CommandResults[K]>;
      const work = (async () => {
        const actor = await requireActor();
        if (generation !== started) throw unauthenticated();
        const preparation = preparations.then(async () => {
          if (generation !== started) throw unauthenticated();
          const records = await queue.list(), scope = identityKey(actor);
          const existing = records.find(r => r.actorId === actor.id && r.identityKey === scope && r.routeId === intent.routeId &&
            canonicalJson(r.params) === canonicalJson(params) && canonicalJson(JSON.parse(r.bodyJson ?? 'null')) === bodyJson);
          if (existing) return existing; // Reconcile an UNKNOWN attempt; never mint another key.
          if (records.length >= 100) throw new StorageError('Reconcile retained commands before creating more intents');
          const record: QueuedMutationRecord = { idempotencyKey: generateKey(), routeId: intent.routeId, params, bodyJson,
            actorId: actor.id, identityKey: scope, createdAt: clock().toISOString() };
          await queue.add(record); return record;
        });
        preparations = preparation.then(() => undefined, () => undefined);
        const record = await preparation;
        if (generation !== started) throw unauthenticated();
        try {
          const result = await foundation.authorized(c => sendRecord(c, record));
          await queue.remove(record.idempotencyKey); return result as CommandResults[K];
        } catch (error) {
          if (error instanceof V2ApiError && error.status < 500 && error.status !== 401) await queue.remove(record.idempotencyKey);
          throw error;
        }
      })().finally(() => { if (activeCommands.get(fingerprint) === work) activeCommands.delete(fingerprint); });
      activeCommands.set(fingerprint, work);
      return work;
    },
    async flushQueuedMutations() {
      const report: FlushReport = { confirmed: [], discardedStale: [], pending: [] };
      const started = generation, actor = await requireActor();
      for (const record of await queue.list()) {
        if (generation !== started) throw unauthenticated();
        if (record.actorId !== actor.id || record.identityKey !== identityKey(actor)) { report.discardedStale.push({ ...record, routeId: 'REDACTED', bodyJson: null, params: {}, actorId: null, identityKey: undefined, createdAt: '' }); continue; }
        try { await foundation.authorized(c => sendRecord(c, record)); await queue.remove(record.idempotencyKey); report.confirmed.push(record); }
        catch (cause) { report.pending.push({ record, cause }); }
      }
      return report;
    },
    async listQueuedMutations() {
      const started = generation, actor = await requireActor(), records = await queue.list();
      if (generation !== started) throw unauthenticated();
      return records.filter(record => record.actorId === actor.id && record.identityKey === identityKey(actor));
    },
    registerPrivateCache(invalidate) { caches.add(invalidate); return () => { caches.delete(invalidate); }; },
    async logout() {
      generation++;
      const held = session;
      clear();
      let serverRevocationConfirmed = false, revocationError: unknown = null, localCredsCleared = true;
      try { if (!held) throw unauthenticated(); await options.wireClient(() => held.accessToken).logout(); serverRevocationConfirmed = true; }
      catch (error) { revocationError = error; }
      try { await write(null); await queue.clear(); } catch { localCredsCleared = false; }
      return { serverRevocationConfirmed, revocationError, localCredsCleared };
    },
  };
  return foundation;
}
export function createActorScopedCache<K, V>(register: (invalidate: () => void) => void) {
  const entries = new Map<K, { expiresAt: number; value: V }>();
  let epoch = 0;
  register(() => { epoch++; entries.clear(); });
  return { async getOrLoad(key: K, ttlMs: number, load: () => Promise<V>): Promise<V> {
    const hit = entries.get(key), now = Date.now(), captured = epoch;
    if (hit && hit.expiresAt > now) return hit.value;
    const value = await load();
    if (captured !== epoch) throw unauthenticated();
    entries.set(key, { value, expiresAt: now + ttlMs }); return value;
  } };
}
