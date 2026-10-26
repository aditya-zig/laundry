import { describe, expect, it } from 'vitest';
import { createBrowserIdentityClient } from '../src/browser-identity.js';

const baseUrl = 'https://api.laundry.test/v2';
const id = '11111111-1111-4111-8111-111111111111';
const session = { accessToken: 'app-access', refreshToken: 'app-refresh', expiresAt: '2026-10-27T09:00:00Z', sessionId: id,
  actor: { id, role: 'CUSTOMER', facilityIds: [], scope: { facilityIds: [] } } };
function harness(payload: unknown = { session: { token: 'framework-proof' }, user: { phoneNumberVerified: false } }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json(String(input).endsWith('/identity/session/exchange') ? session : payload);
  };
  return { calls, client: createBrowserIdentityClient({ baseUrl, fetchImpl }) };
}
describe('browser identity through the first-party SDK', () => {
  it('uses cookie-authenticated framework phone endpoints, never the legacy OTP route', async () => {
    const { client, calls } = harness({ status: true });
    await client.auth.phoneNumber.sendOtp({ phoneNumber: '+919876543210' });
    expect(calls[0].url).toBe(`${baseUrl}/auth/identity/phone-number/send-otp`);
    expect(calls[0].init?.credentials).toBe('include');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ phoneNumber: '+919876543210' });
  });
  it('verifies the social session phone explicitly on that session', async () => {
    const { client, calls } = harness({ status: true });
    await client.auth.phoneNumber.verify({ phoneNumber: '+919876543210', code: '123456', updatePhoneNumber: true });
    expect(calls[0].url).toBe(`${baseUrl}/auth/identity/phone-number/verify`);
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ updatePhoneNumber: true });
  });
  it.each(['google', 'apple'] as const)('starts %s through framework state handling', async provider => {
    const { client, calls } = harness({ url: 'https://provider.example', redirect: true });
    await client.auth.signIn.social({ provider, callbackURL: 'https://laundry.test/checkout', disableRedirect: true });
    expect(calls[0].url).toBe(`${baseUrl}/auth/identity/sign-in/social`);
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ provider, callbackURL: 'https://laundry.test/checkout' });
  });
  it('exchanges only framework proof and lets the server enforce mobile verification', async () => {
    const { client, calls } = harness();
    expect(await client.exchange({ idempotencyKey: id })).toMatchObject({ accessToken: 'app-access' });
    expect(calls[0].url).toBe(`${baseUrl}/auth/identity/get-session?disableCookieCache=true`);
    const exchange = calls.find(call => call.url.endsWith('/identity/session/exchange'))!;
    expect(exchange.init?.headers).toMatchObject({ Authorization: 'Bearer framework-proof', 'Idempotency-Key': id });
    expect(exchange.init?.body).toBe('{}');
  });
  it('never exchanges a missing framework session', async () => {
    const { client, calls } = harness(null);
    await expect(client.exchange({ idempotencyKey: id })).rejects.toThrow('Sign in');
    expect(calls).toHaveLength(1);
  });
  it.each(['http://api.example/v2', 'https://api.example/v1', 'https://user:secret@api.example/v2', 'https://api.example/v2?token=x'])('rejects unsafe or incorrect API configuration: %s', url => {
    expect(() => createBrowserIdentityClient({ baseUrl: url })).toThrow();
  });
});
