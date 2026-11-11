import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TwilioPhoneVerification } from '../../../modules/identity/src/better-auth-provider';

const db = new pg.Pool(); // Every query is intercepted; no connection is opened.
const config = { db, accountSid: `AC${'a'.repeat(32)}`, authToken: 'b'.repeat(32), serviceSid: `VA${'c'.repeat(32)}`, hashKey: 'd'.repeat(64), hourlyBudget: 3 };
const phone = '+919000022221';
const queryResult = { command: 'INSERT', rowCount: 1, oid: 0, fields: [], rows: [{ attempts: 1 }] };
afterEach(() => vi.restoreAllMocks());

describe('Twilio Verify adapter — synthetic fetch only, no paid requests', () => {
  it('consumes a persisted send quota before submitting the configured Verify request', async () => {
    const quota = vi.spyOn(db, 'query').mockResolvedValue(queryResult);
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'pending' })));
    await new TwilioPhoneVerification(config, request).send(phone);
    expect(quota).toHaveBeenCalledOnce();
    expect(quota.mock.calls[0][0]).toContain('identity_rate_buckets.attempts<$2');
    const [url, init] = request.mock.calls[0];
    expect(url).toBe(`https://verify.twilio.com/v2/Services/${config.serviceSid}/Verifications`);
    expect(url).not.toContain(phone);
    expect(new URLSearchParams(String(init?.body)).get('Channel')).toBe('sms');
    expect(new URLSearchParams(String(init?.body)).get('To')).toBe(phone);
    expect(init?.redirect).toBe('error');
  });
  it('does not send when the persisted budget is exhausted', async () => {
    vi.spyOn(db, 'query').mockResolvedValue({ ...queryResult, rowCount: 0, rows: [] });
    const request = vi.fn<typeof fetch>();
    await expect(new TwilioPhoneVerification(config, request).send(phone)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(request).not.toHaveBeenCalled();
  });
  it('accepts only approved checks, rejects pending/expired/replayed challenges', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'pending' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'approved' })))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const provider = new TwilioPhoneVerification(config, request);
    expect(await provider.verify(phone, '000000')).toBe(false);
    expect(await provider.verify(phone, '654321')).toBe(true);
    expect(await provider.verify(phone, '654321')).toBe(false);
    expect(request.mock.calls[1][0]).toBe(`https://verify.twilio.com/v2/Services/${config.serviceSid}/VerificationCheck`);
  });
  it('redacts unknown outcomes and never automatically retries a chargeable send', async () => {
    vi.spyOn(db, 'query').mockResolvedValue(queryResult);
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error(`${phone} 654321 ${config.authToken}`));
    await expect(new TwilioPhoneVerification(config, request).send(phone)).rejects.toMatchObject({
      code: 'PROVIDER_OUTCOME_UNKNOWN', message: 'Phone verification is unavailable; do not automatically resend',
    });
    expect(request).toHaveBeenCalledOnce();
  });
  it('rejects malformed, oversized and non-OK responses without leaking response bodies', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('private response body', { status: 500 }))
      .mockResolvedValueOnce(new Response('x'.repeat(16_385)))
      .mockResolvedValueOnce(new Response('{}'));
    const provider = new TwilioPhoneVerification(config, request);
    for (let index = 0; index < 3; index++) await expect(provider.verify(phone, '654321')).rejects.toMatchObject({ code: 'PROVIDER_OUTCOME_UNKNOWN' });
  });
});
