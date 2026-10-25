import { describe, expect, it } from 'vitest';
import { createV2Client, UnknownOutcomeError, V2ApiError, type Actor } from '@laundry/api-client';
import { v2WireFixtures } from '@laundry/test-fixtures';
import { v2 } from '@laundry/contracts';
const fixtureFacilityId = v2WireFixtures.Order.facilityId;
if (!fixtureFacilityId) throw new Error('The synthetic order fixture must name its facility');
const fixtures = { ...v2WireFixtures, BookingInput: v2.bookingInputSchema.parse(v2WireFixtures.BookingInput), Order: { ...v2WireFixtures.Order, facilityId: fixtureFacilityId } };
import { createSessionFoundation, createActorScopedCache, createMemoryPendingMutationStore, createMemorySecureTokenStore, StorageError, type SessionFoundationOptions } from '../src/index.js';
// Synthetic wire fixtures only. No provider, price approval, device or storage acceptance.
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const rejected = () => response({ code: 'UNAUTHENTICATED', message: 'revoked', traceId: 'synthetic', retryable: false }, 401);
function gate<T>() { let release: (value: T) => void = () => { throw new Error('gate not ready'); }; const promise = new Promise<T>(resolve => { release = resolve; }); return { promise, resolve: (value: T) => release(value) }; }
type Request = { path: string; method: string; headers: Headers; body: unknown };
class Harness {
  now = Date.now();
  actor: Actor = clone(fixtures.Actor);
  store = createMemorySecureTokenStore();
  queue = createMemoryPendingMutationStore();
  calls: Request[] = [];
  changes: Array<Actor | null> = [];
  session() { return { ...clone(fixtures.Session), actor: clone(this.actor), accessToken: 'synthetic-access-rotated', refreshToken: 'synthetic-refresh-rotated', expiresAt: new Date(this.now + 900_000).toISOString() }; }
  defaultHandle = (req: Request): Response => {
    if (req.path.endsWith('/identity/session/refresh')) return response(this.session());
    if (req.path.endsWith('/identity/me')) return response(this.actor);
    if (req.path.endsWith('/identity/logout')) return response(fixtures.LogoutResult);
    if (req.path.endsWith('/orders')) return response(fixtures.Order);
    return response({ code: 'NOT_FOUND', message: 'synthetic missing handler', traceId: 'synthetic', retryable: false }, 404);
  };
  handle: (req: Request) => Response | Promise<Response> = this.defaultHandle;
  build(overrides: Partial<SessionFoundationOptions> = {}) {
    const fetchImpl: typeof fetch = async (input, init) => {
      const req = { path: new URL(String(input)).pathname, method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : null };
      this.calls.push(req); return this.handle(req);
    };
    return createSessionFoundation({ wireClient: getToken => createV2Client({ baseUrl: 'http://localhost:4100/v2', getToken, fetchImpl }), refreshTokenStore: this.store, pendingMutationStore: this.queue, clock: () => new Date(this.now), onIdentityChange: actor => this.changes.push(actor), ...overrides });
  }
  async signedIn(overrides: Partial<SessionFoundationOptions> = {}) { await this.store.write('synthetic-refresh-original'); const f = this.build(overrides); expect((await f.initialize()).state).toBe('authenticated'); this.calls = []; return f; }
  books() { return this.calls.filter(r => r.path.endsWith('/orders')); }
}
const booking = () => ({ routeId: 'orders.book' as const, body: clone(fixtures.BookingInput) });

describe('F00 restore, revocation and secure persistence', () => {
  it('SES-01 restores the current server actor and rotates credentials', async () => {
    const h = new Harness(); h.actor = { ...h.actor, role: 'FACILITY', facilityIds: [fixtures.Order.facilityId], scope: { facilityIds: [fixtures.Order.facilityId] } };
    const f = await h.signedIn();
    expect(f.getActor()).toEqual(h.actor); expect(await h.store.read()).toBe('synthetic-refresh-rotated');
    expect(await h.store.read()).not.toContain('access');
  });
  it('SES-02 empty storage signs out without network activity', async () => { const h = new Harness(); expect(await h.build().initialize()).toEqual({ state: 'signedOut' }); expect(h.calls).toEqual([]); });
  it('SES-03 unavailable storage is restoreFailed, never authenticated', async () => {
    const h = new Harness(), f = h.build({ refreshTokenStore: { async read() { throw new Error('locked'); }, async write() { throw new Error('locked'); } } });
    const state = await f.initialize(); expect(state.state).toBe('restoreFailed'); if (state.state === 'restoreFailed') expect(state.cause).toBeInstanceOf(StorageError); expect(h.calls).toEqual([]);
  });
  it('SES-04 rejected stored credentials clear storage and notify once', async () => {
    const h = new Harness(); await h.store.write('synthetic-old'); h.handle = rejected;
    const f = h.build(); expect(await f.initialize()).toEqual({ state: 'signedOut' }); expect(await h.store.read()).toBeNull(); expect(h.changes).toEqual([null]);
  });
  it('SES-14 adopts a verified session without an existing login', async () => {
    const h = new Harness(), f = h.build(); await f.adoptAuthenticatedSession(h.session()); expect(f.getActor()).toEqual(h.actor); expect(f.snapshot()).toMatchObject({ state: 'authenticated', sessionId: fixtures.Session.sessionId });
  });
  it('SES-13 a failed rotation write revokes the newly issued session, not an absent/old token', async () => {
    const h = new Harness(); await h.store.write('synthetic-original');
    const f = h.build({ refreshTokenStore: { read: () => h.store.read(), async write(value) { if (value === 'synthetic-refresh-rotated') throw new Error('quota'); await h.store.write(value); } } });
    expect((await f.initialize()).state).toBe('restoreFailed'); expect(f.getActor()).toBeNull();
    expect(h.calls.find(r => r.path.endsWith('/identity/logout'))?.headers.get('authorization')).toBe('Bearer synthetic-access-rotated');
  });
});
describe('F00 refresh and stable command identities', () => {
  it('SES-05 concurrent expiry launches exactly one refresh', async () => {
    const h = new Harness(), f = await h.signedIn(); h.now += 960_000;
    await Promise.all([f.ensureAuthenticated(), f.ensureAuthenticated(), f.ensureAuthenticated()]);
    expect(h.calls.filter(r => r.path.endsWith('/identity/session/refresh'))).toHaveLength(1);
  });
  it('SES-06 401 retries the identical booking key and payload exactly once', async () => {
    const h = new Harness(), f = await h.signedIn(); let attempts = 0;
    h.handle = req => req.path.endsWith('/orders') && ++attempts === 1 ? rejected() : h.defaultHandle(req);
    await f.enqueueMutation(booking()); const calls = h.books();
    expect(calls).toHaveLength(2); expect(calls[0].headers.get('idempotency-key')).toBe(calls[1].headers.get('idempotency-key')); expect(calls[0].body).toEqual(calls[1].body);
  });
  it('SES-07 unknown booking outcome retains exact intent and flush retires only a confirmed replay', async () => {
    const h = new Harness(), f = await h.signedIn(); h.handle = req => { if (req.path.endsWith('/orders')) throw new Error('lost response'); return h.defaultHandle(req); };
    await expect(f.enqueueMutation(booking())).rejects.toBeInstanceOf(UnknownOutcomeError);
    const [retained] = await f.listQueuedMutations(); expect(JSON.parse(retained.bodyJson!)).toEqual(fixtures.BookingInput);
    h.handle = h.defaultHandle; const report = await f.flushQueuedMutations(); expect(report.confirmed).toHaveLength(1); expect(await f.listQueuedMutations()).toHaveLength(0);
    expect(h.books()[0].headers.get('idempotency-key')).toBe(h.books()[1].headers.get('idempotency-key')); expect(h.books()[0].body).toEqual(h.books()[1].body);
  });
  it.each([{ status: 429, code: 'RATE_LIMITED', retryable: false }, { status: 408, code: 'PROVIDER_OUTCOME_UNKNOWN', retryable: true }, { status: 409, code: 'PAYMENT_PENDING', retryable: true }])('retains the command key after $status $code', async error => {
    const h = new Harness(), f = await h.signedIn();
    h.handle = req => req.path.endsWith('/orders') ? response({ ...error, message: 'Try reconciliation later', traceId: 'synthetic' }, error.status) : h.defaultHandle(req);
    await expect(f.enqueueMutation(booking())).rejects.toBeInstanceOf(V2ApiError);
    expect(await f.listQueuedMutations()).toHaveLength(1);
    h.handle = h.defaultHandle;
    const report = await f.flushQueuedMutations();
    expect(report.confirmed).toHaveLength(1);
    expect(h.books()[0].headers.get('idempotency-key')).toBe(h.books()[1].headers.get('idempotency-key'));
    expect(h.books()[0].body).toEqual(h.books()[1].body);
  });
  it.each(['VERSION_CONFLICT', 'QUOTE_EXPIRED'])('retires definitively rejected versioned terms: %s', async code => {
    const h = new Harness(), f = await h.signedIn();
    h.handle = req => req.path.endsWith('/orders') ? response({ code, retryable: true, message: 'New terms required', traceId: 'synthetic' }, 409) : h.defaultHandle(req);
    await expect(f.enqueueMutation(booking())).rejects.toBeInstanceOf(V2ApiError);
    expect(await f.listQueuedMutations()).toEqual([]);
    expect((await f.flushQueuedMutations()).confirmed).toEqual([]);
    expect(h.books()).toHaveLength(1);
  });
  it('SES-08 persisted intent survives a new foundation instance; unknown replay is never confirmed', async () => {
    const h = new Harness(), f = await h.signedIn(); h.handle = req => { if (req.path.endsWith('/orders')) throw new Error('offline'); return h.defaultHandle(req); };
    await expect(f.enqueueMutation(booking())).rejects.toBeInstanceOf(UnknownOutcomeError);
    const restarted = h.build(); expect((await restarted.initialize()).state).toBe('authenticated'); const report = await restarted.flushQueuedMutations();
    expect(report.confirmed).toEqual([]); expect(report.pending).toHaveLength(1); expect(report.pending[0].cause).toBeInstanceOf(UnknownOutcomeError);
  });
  it('SES-09 failed queue persistence sends no booking', async () => {
    const h = new Harness(); const f = await h.signedIn({ pendingMutationStore: { list: () => h.queue.list(), async add() { throw new Error('unavailable'); }, remove: key => h.queue.remove(key), clear: () => h.queue.clear() } });
    await expect(f.enqueueMutation(booking())).rejects.toBeInstanceOf(StorageError); expect(h.books()).toEqual([]);
  });
  it('SES-10 another identity cannot replay or inspect a retained private intent', async () => {
    const h = new Harness(), f = await h.signedIn(); h.handle = req => { if (req.path.endsWith('/orders')) throw new Error('offline'); return h.defaultHandle(req); };
    await expect(f.enqueueMutation(booking())).rejects.toBeInstanceOf(UnknownOutcomeError);
    h.actor.id = '00000000-0000-4000-8000-000000000999'; await f.adoptAuthenticatedSession(h.session()); h.calls = [];
    const report = await f.flushQueuedMutations(); expect(report.confirmed).toEqual([]); expect(report.discardedStale).toHaveLength(1); expect(report.discardedStale[0].bodyJson).toBeNull(); expect(await f.listQueuedMutations()).toEqual([]); expect(h.books()).toEqual([]);
  });
  it('rotation response loss reuses the journaled key after process restart', async () => {
    const h = new Harness(); await h.store.write('synthetic-original'); let attempts = 0;
    h.handle = req => { if (req.path.endsWith('/identity/session/refresh') && ++attempts === 1) throw new Error('lost rotated credentials'); return h.defaultHandle(req); };
    expect((await h.build().initialize()).state).toBe('restoreFailed');
    const journal = JSON.parse((await h.store.read())!); expect(journal.refreshToken).toBe('synthetic-original'); expect(JSON.stringify(journal)).not.toContain('access');
    expect((await h.build().initialize()).state).toBe('authenticated');
    const calls = h.calls.filter(r => r.path.endsWith('/identity/session/refresh')); expect(calls).toHaveLength(2); expect(calls[0].headers.get('idempotency-key')).toBe(journal.refreshKey); expect(calls[1].headers.get('idempotency-key')).toBe(journal.refreshKey); expect(calls[0].body).toEqual(calls[1].body);
  });
  it('retrying an UNKNOWN intent with reordered object keys never mints another command', async () => {
    const h = new Harness(), f = await h.signedIn(); h.handle = req => { if (req.path.endsWith('/orders')) throw new Error('offline'); return h.defaultHandle(req); };
    await expect(f.enqueueMutation(booking())).rejects.toBeInstanceOf(UnknownOutcomeError); h.handle = h.defaultHandle;
    const b = fixtures.BookingInput; await f.enqueueMutation({ routeId: 'orders.book', body: { paymentModel: b.paymentModel, expectedVersion: b.expectedVersion, quoteId: b.quoteId } });
    expect(h.books()[0].headers.get('idempotency-key')).toBe(h.books()[1].headers.get('idempotency-key'));
  });
  it('concurrent duplicate clicks share one in-flight command', async () => {
    const h = new Harness(), f = await h.signedIn(), started = gate<void>(), finish = gate<Response>();
    h.handle = req => { if (req.path.endsWith('/orders')) { started.resolve(undefined); return finish.promise; } return h.defaultHandle(req); };
    const first = f.enqueueMutation(booking()), second = f.enqueueMutation(booking()); expect(first).toBe(second); await started.promise; expect(h.books()).toHaveLength(1); finish.resolve(response(fixtures.Order)); await Promise.all([first, second]);
  });
  it('changing the UI input after dispatch cannot change the retained replay payload', async () => {
    const h = new Harness(), f = await h.signedIn(); h.handle = req => { if (req.path.endsWith('/orders')) throw new Error('offline'); return h.defaultHandle(req); };
    const intent = booking(), original = clone(intent.body); const pending = f.enqueueMutation(intent); intent.body.expectedVersion = 999;
    await expect(pending).rejects.toBeInstanceOf(UnknownOutcomeError); expect(JSON.parse((await f.listQueuedMutations())[0].bodyJson!)).toEqual(original);
  });
});
describe('F00 teardown, scoped caches and asynchronous identity races', () => {
  it('a late authorized response cannot cross a logout or actor change', async () => {
    const h = new Harness(), f = await h.signedIn();
    const held = gate<string>(), started = gate<void>();
    const request = f.authorized(async () => { started.resolve(); return held.promise; });
    const denied = expect(request).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await started.promise;
    await f.logout();
    held.resolve('old actor private data');
    await denied;
  });
  it('SES-11 logout revokes, clears local credentials/queue and invalidates identity', async () => {
    const h = new Harness(), f = await h.signedIn(); const report = await f.logout(); expect(report).toMatchObject({ serverRevocationConfirmed: true, localCredsCleared: true }); expect(f.getActor()).toBeNull(); expect(await h.store.read()).toBeNull(); expect(h.changes.at(-1)).toBeNull();
  });
  it('SES-12 failed server revocation remains visible while local logout still clears credentials', async () => {
    const h = new Harness(), f = await h.signedIn(); h.handle = () => { throw new Error('offline'); }; const report = await f.logout(); expect(report.serverRevocationConfirmed).toBe(false); expect(report.revocationError).toBeInstanceOf(Error); expect(await h.store.read()).toBeNull(); expect(f.getActor()).toBeNull();
  });
  it('SES-15 private cache hooks survive repeated identity changes and logout', async () => {
    const h = new Harness(), f = await h.signedIn(), cache = createActorScopedCache<string, number>(f.registerPrivateCache); let loads = 0;
    const load = () => cache.getOrLoad('private', 60_000, async () => ++loads);
    expect(await load()).toBe(1); expect(await load()).toBe(1);
    await f.logout(); await f.adoptAuthenticatedSession(h.session()); expect(await load()).toBe(2);
    h.actor = { ...h.actor, role: 'FACILITY', facilityIds: [fixtures.Order.facilityId], scope: { facilityIds: [fixtures.Order.facilityId] } };
    await f.adoptAuthenticatedSession(h.session()); expect(await load()).toBe(3);
  });
  it('an old private response resolving after logout is neither returned nor cached', async () => {
    const h = new Harness(), f = await h.signedIn(), cache = createActorScopedCache<string, string>(f.registerPrivateCache), result = gate<string>();
    const pending = cache.getOrLoad('private', 60_000, () => result.promise); await f.logout(); result.resolve('old private data'); await expect(pending).rejects.toBeInstanceOf(V2ApiError);
    expect(await cache.getOrLoad('private', 60_000, async () => 'new private data')).toBe('new private data');
  });
  it('a late refresh cannot resurrect a session after logout', async () => {
    const h = new Harness(), f = await h.signedIn(), started = gate<void>(), finish = gate<Response>(); h.now += 960_000;
    h.handle = req => { if (req.path.endsWith('/identity/session/refresh')) { started.resolve(undefined); return finish.promise; } return h.defaultHandle(req); };
    const refreshing = f.ensureAuthenticated(); const rejection = expect(refreshing).rejects.toBeInstanceOf(V2ApiError); await started.promise; await f.logout(); finish.resolve(response(h.session())); await rejection;
    expect(f.snapshot()).toEqual({ state: 'signedOut' }); expect(await h.store.read()).toBeNull();
  });
  it('scope changes quarantine even the same actor’s previously confirmed intent', async () => {
    const h = new Harness(), f = await h.signedIn(); h.handle = req => { if (req.path.endsWith('/orders')) throw new Error('offline'); return h.defaultHandle(req); };
    await expect(f.enqueueMutation(booking())).rejects.toBeInstanceOf(UnknownOutcomeError); h.actor = { ...h.actor, role: 'FACILITY', facilityIds: [fixtures.Order.facilityId], scope: { facilityIds: [fixtures.Order.facilityId] } }; await f.adoptAuthenticatedSession(h.session()); h.calls = [];
    expect((await f.flushQueuedMutations()).discardedStale).toHaveLength(1); expect(await f.listQueuedMutations()).toEqual([]); expect(h.books()).toEqual([]);
  });
});
