import { afterAll, describe, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TwilioSmsDelivery, identityFromEnvironment } from '../../../modules/identity/src';
import { closePool, getPool } from '../../../modules/shared/src/db';
afterAll(closePool);

const config = { accountSid: 'AC' + 'a'.repeat(32), authToken: 'b'.repeat(32), messagingServiceSid: 'MG' + 'c'.repeat(32) };
const input = { phone: '+919000011111', code: '123456', challengeId: randomUUID() };
const messageId = 'SM' + 'd'.repeat(32);

describe('SMS adapter contract; all network responses are fixtures, no commercial sends', () => {
  it('sends only to the pinned provider endpoint with server-held credentials', async () => {
    let calls = 0;
    const network: typeof fetch = async (url, options) => {
      calls++;
      expect(String(url)).toBe(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`);
      expect(options?.method).toBe('POST');
      expect(options?.redirect).toBe('error');
      const headers = new Headers(options?.headers);
      expect(headers.get('authorization')).toBe(`Basic ${Buffer.from(config.accountSid + ':' + config.authToken).toString('base64')}`);
      const body = new URLSearchParams(String(options?.body));
      expect(body.get('To')).toBe(input.phone);
      expect(body.get('MessagingServiceSid')).toBe(config.messagingServiceSid);
      expect(body.get('Body')).toContain(input.code);
      return new Response(JSON.stringify({ sid: messageId, status: 'queued' }), { status: 201 });
    };
    expect(await new TwilioSmsDelivery(config, network).send(input)).toEqual({ reference: messageId });
    expect(calls).toBe(1);
  });

  it.each([429, 500, 302])('redacts HTTP %s errors and never retries an uncertain send automatically', async status => {
    let calls = 0;
    const provider = new TwilioSmsDelivery(config, async () => { calls++; return new Response(input.phone + ':' + input.code + ':' + config.authToken, { status }); });
    await expect(provider.send(input)).rejects.toMatchObject({ code: status < 500 && status >= 400 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_OUTCOME_UNKNOWN', message: 'Code delivery could not be confirmed' });
    expect(calls).toBe(1);
  });

  it('rejects failed, malformed and oversized responses without returning provider contents', async () => {
    for (const [body, code] of [[JSON.stringify({ sid: messageId, status: 'failed' }), 'PROVIDER_UNAVAILABLE'], [JSON.stringify({ sid: 'invalid', status: 'queued' }), 'PROVIDER_OUTCOME_UNKNOWN'], ['x'.repeat(20_000), 'PROVIDER_OUTCOME_UNKNOWN']]) {
      const provider = new TwilioSmsDelivery(config, async () => new Response(body, { status: 200 }));
      await expect(provider.send(input)).rejects.toMatchObject({ code, message: 'Code delivery could not be confirmed' });
    }
  });

  it('keeps transport timeouts unknown and redacts transport exception contents', async () => {
    const provider = new TwilioSmsDelivery(config, async () => { throw new Error(input.phone + ':' + input.code + ':' + config.authToken); });
    await expect(provider.send(input)).rejects.toMatchObject({ code: 'PROVIDER_OUTCOME_UNKNOWN', message: 'Code delivery could not be confirmed' });
  });

  it('requires an explicit bounded send budget before enabling commercial delivery', () => {
    for (const budget of ['', '0', '-1', '1e3', '100001']) {
      expect(() => identityFromEnvironment(getPool(), {
        LAUNDRY_IDENTITY_PROVIDER: 'twilio-sms', LAUNDRY_SMS_HOURLY_BUDGET: budget,
        LAUNDRY_TWILIO_ACCOUNT_SID: config.accountSid, LAUNDRY_TWILIO_AUTH_TOKEN: config.authToken,
        LAUNDRY_TWILIO_MESSAGING_SERVICE_SID: config.messagingServiceSid,
        LAUNDRY_IDENTITY_HASH_KEY: randomBytes(32).toString('hex'), LAUNDRY_IDENTITY_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      })).toThrow(/HOURLY_BUDGET/);
    }
  });

  it('actual production bootstrap refuses missing identity before migrating or listening', () => {
    const database = 'postgres://synthetic:private-test-value@identity.invalid/laundry_production?sslmode=verify-full';
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../dist/apps/api/src/main.js', import.meta.url))], {
      env: { ...process.env, NODE_ENV: 'production', DEMO_MODE: 'false', DATABASE_URL: database, DATABASE_URL_UNPOOLED: '', LAUNDRY_ALLOW_MIGRATIONS: '',
        WHATSAPP_APP_SECRET: 'synthetic-only', WHATSAPP_VERIFY_TOKEN: 'synthetic-only', WHATSAPP_TOKEN: 'synthetic-only', WHATSAPP_PHONE_NUMBER_ID: 'synthetic-only',
        LAUNDRY_IDENTITY_PROVIDER: '', LAUNDRY_IDENTITY_HASH_KEY: '', LAUNDRY_IDENTITY_ENCRYPTION_KEY: '', CORS_ORIGIN: 'https://laundry.example.invalid' },
      encoding: 'utf8', timeout: 15_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('configured Laundry identity provider');
    expect(result.stderr).not.toContain('private-test-value');
    expect(result.stdout).not.toContain('listening on');
  });

  it('supports explicitly deferred messaging without constructing a provider, fake identity or database command', () => {
    const db = getPool();
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No sends permitted'));
    const query = vi.spyOn(db, 'query');
    try {
      expect(identityFromEnvironment(db, { NODE_ENV: 'production', LAUNDRY_IDENTITY_PROVIDER: 'disabled' })).toBeNull();
      expect(network).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
    } finally { network.mockRestore(); query.mockRestore(); }
  });

  it('does not pick up unrelated generic provider credentials or allow missing production configuration', () => {
    // Configuration is checked before any database query or provider send.
    const db = getPool();
    expect(identityFromEnvironment(db, { NODE_ENV: 'test', TWILIO_ACCOUNT_SID: config.accountSid, TWILIO_AUTH_TOKEN: config.authToken })).toBeNull();
    expect(() => identityFromEnvironment(db, { NODE_ENV: 'production' })).toThrow(/configured Laundry identity provider/);
    expect(() => identityFromEnvironment(db, { NODE_ENV: 'production', LAUNDRY_IDENTITY_PROVIDER: 'fake' })).toThrow(/Unsupported/);
    expect(() => identityFromEnvironment(db, { LAUNDRY_IDENTITY_PROVIDER: 'twilio-sms' })).toThrow(/SMS provider configuration/);
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected live request'));
    try {
      expect(identityFromEnvironment(db, {
        LAUNDRY_IDENTITY_PROVIDER: 'twilio-sms', LAUNDRY_SMS_HOURLY_BUDGET: '25',
        LAUNDRY_TWILIO_ACCOUNT_SID: config.accountSid, LAUNDRY_TWILIO_AUTH_TOKEN: config.authToken,
        LAUNDRY_TWILIO_MESSAGING_SERVICE_SID: config.messagingServiceSid,
        LAUNDRY_IDENTITY_HASH_KEY: randomBytes(32).toString('hex'), LAUNDRY_IDENTITY_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      })).not.toBeNull();
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });
});
