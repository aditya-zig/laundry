import { describe, expect, it, vi } from 'vitest';
import { createCustomerBrowserSignIn, customerSignInMode } from '../src/features/booking/browser-sign-in';

const id = '11111111-1111-4111-8111-111111111111';
const appSession = { accessToken: 'app-access', refreshToken: 'app-refresh', expiresAt: '2026-10-27T09:00:00Z', sessionId: id,
  actor: { id, role: 'CUSTOMER', facilityIds: [], scope: { facilityIds: [] } } };
function harness(initial: 'none' | 'unverified' | 'verified') {
  let state = initial;
  let loseExchange = false;
  const calls: { url: string; init?: RequestInit }[] = [];
  const adopt = vi.fn(async () => {});
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input); calls.push({ url, init });
    if (url.includes('/get-session')) return Response.json(state === 'none' ? null : {
      session: { token: 'framework-proof' }, user: { phoneNumberVerified: state === 'verified' },
    });
    if (url.endsWith('/session/exchange')) {
      if (loseExchange) { loseExchange = false; throw new Error('Response lost'); }
      return Response.json(appSession);
    }
    if (url.endsWith('/verify')) state = 'verified';
    return Response.json({ status: true });
  };
  return { calls, adopt, loseNextExchange() { loseExchange = true; },
    flow: createCustomerBrowserSignIn({ baseUrl: 'https://api.laundry.test/v2', adoptSession: adopt, fetchImpl }) };
}

describe('customer browser sign-in', () => {
  it('leaves the deployed identity engine unchanged unless explicitly selected, and blocks native/invalid selection', () => {
    expect(customerSignInMode('web', undefined)).toBe('legacy');
    expect(customerSignInMode('web', 'better-auth')).toBe('browser');
    expect(customerSignInMode('ios', 'better-auth')).toBe('blocked');
    expect(customerSignInMode('android', 'better-auth')).toBe('blocked');
    expect(customerSignInMode('web', 'typo')).toBe('blocked');
  });
  it('does not substitute a session for a signed-out customer', async () => {
    const h = harness('none');
    expect(await h.flow.restore()).toBe('signedOut');
    expect(h.adopt).not.toHaveBeenCalled();
  });
  it('requires mobile verification after social sign-in, without exchanging or adopting an unverified session', async () => {
    const h = harness('unverified');
    expect(await h.flow.restore()).toBe('verifyPhone');
    expect(h.calls).toHaveLength(1);
    expect(h.adopt).not.toHaveBeenCalled();
  });
  it('restores verified sign-in only after the server exchange', async () => {
    const h = harness('verified');
    expect(await h.flow.restore()).toBe('authenticated');
    expect(h.adopt).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'app-access' }));
    expect(h.calls.at(-1)?.url).toMatch(/\/session\/exchange$/);
  });
  it.each(['none', 'unverified'] as const)('binds verification correctly for %s session', async initial => {
    const h = harness(initial);
    await h.flow.sendCode('+919876543210');
    await h.flow.verifyCode('+919876543210', '123456');
    const verify = h.calls.find(call => call.url.endsWith('/phone-number/verify'))!;
    const body = JSON.parse(String(verify.init?.body));
    expect(body).toEqual({ phoneNumber: '+919876543210', code: '123456', ...(initial === 'none' ? {} : { updatePhoneNumber: true }) });
    expect(h.adopt).toHaveBeenCalledTimes(1);
  });
  it('retains the exchange key after a lost response, without resending or redeeming another code', async () => {
    const h = harness('verified'); h.loseNextExchange();
    await expect(h.flow.restore()).rejects.toThrow();
    expect(await h.flow.restore()).toBe('authenticated');
    const keys = h.calls.filter(call => call.url.endsWith('/session/exchange')).map(call => new Headers(call.init?.headers).get('Idempotency-Key'));
    expect(keys[0]).toBeTruthy(); expect(keys[0]).toBe(keys[1]);
    expect(h.calls.some(call => call.url.includes('/phone-number/'))).toBe(false);
  });
});
