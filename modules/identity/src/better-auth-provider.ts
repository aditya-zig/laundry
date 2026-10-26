import { createHmac } from 'node:crypto';
import type { Pool } from 'pg';
import { IdentityFault } from './errors';
import { createLaundryAuth, type PhoneVerification } from './better-auth';

interface VerifyOptions {
  db: Pool;
  accountSid: string;
  authToken: string;
  serviceSid: string;
  hashKey: string;
  hourlyBudget: number;
}

/** Twilio Verify owns code generation, attempt limits, expiry and consumption.
 * No other project's credentials or pre-approved delivery routes are assumed. */
export class TwilioPhoneVerification implements PhoneVerification {
  constructor(private readonly options: VerifyOptions, private readonly request: typeof fetch = fetch) {
    if (!/^AC[a-f0-9]{32}$/i.test(options.accountSid) || !/^[a-f0-9]{32}$/i.test(options.authToken) ||
        !/^VA[a-f0-9]{32}$/i.test(options.serviceSid) || !/^[a-f0-9]{64}$/i.test(options.hashKey) ||
        !Number.isInteger(options.hourlyBudget) || options.hourlyBudget < 1 || options.hourlyBudget > 100_000) {
      throw new Error('Invalid Laundry phone verification configuration');
    }
  }
  private async quota() {
    const result = await this.options.db.query(`INSERT INTO identity_rate_buckets (key_hash,bucket_start,attempts)
      VALUES ($1,date_trunc('hour',now(),'UTC'),1) ON CONFLICT (key_hash,bucket_start)
      DO UPDATE SET attempts=identity_rate_buckets.attempts+1 WHERE identity_rate_buckets.attempts<$2 RETURNING attempts`,
    // Share the legacy sender's cap during staged migration; enabling both
    // providers must not silently double the approved SMS budget.
    [createHmac('sha256', Buffer.from(this.options.hashKey, 'hex')).update('rate').update('\0').update('otp-global').digest('hex'), this.options.hourlyBudget]);
    if (!result.rowCount) throw new IdentityFault('RATE_LIMITED', 'Phone verification budget exhausted');
  }
  private async call(path: string, body: URLSearchParams): Promise<{ status?: unknown }> {
    try {
      const response = await this.request(`https://verify.twilio.com/v2/Services/${this.options.serviceSid}/${path}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { authorization: `Basic ${Buffer.from(`${this.options.accountSid}:${this.options.authToken}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      // Verify deletes an approved/expired challenge; a replay must fail closed.
      if (path === 'VerificationCheck' && response.status === 404) { await response.body?.cancel(); return { status: 'expired' }; }
      if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('Verification unavailable'); }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 16_384) { await reader.cancel(); throw new Error('Verification response too large'); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!value || typeof value !== 'object' || !('status' in value)) throw new Error('Invalid verification response');
      return value;
    } catch {
      throw new IdentityFault('PROVIDER_OUTCOME_UNKNOWN', 'Phone verification is unavailable; do not automatically resend');
    }
  }
  async send(phone: string) {
    await this.quota(); // Failed/unknown sends also spend the persisted budget.
    const result = await this.call('Verifications', new URLSearchParams({ To: phone, Channel: 'sms' }));
    if (result.status !== 'pending') throw new IdentityFault('PROVIDER_UNAVAILABLE', 'Phone verification could not be started');
  }
  async verify(phone: string, code: string) {
    return (await this.call('VerificationCheck', new URLSearchParams({ To: phone, Code: code }))).status === 'approved';
  }
}

export function betterAuthFromEnvironment(db: Pool, env: NodeJS.ProcessEnv = process.env) {
  if (env.LAUNDRY_AUTH_ENGINE !== 'better-auth') return null;
  if (env.LAUNDRY_PHONE_VERIFICATION_PROVIDER !== 'twilio-verify') throw new Error('Better Auth requires an explicitly configured phone verification provider');
  const baseUrl = env.BETTER_AUTH_URL ?? '';
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error('Better Auth requires a valid API origin (HTTPS in production)');
  }
  const secret = env.BETTER_AUTH_SECRET ?? '';
  if (!secret || secret === env.LAUNDRY_IDENTITY_HASH_KEY || secret === env.LAUNDRY_IDENTITY_ENCRYPTION_KEY) throw new Error('Better Auth requires an independent secret');
  const origins = (env.LAUNDRY_AUTH_TRUSTED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (!origins.length || origins.some(value => value.includes('*') || new URL(value).origin !== value)) throw new Error('Better Auth requires explicit trusted application origins');
  const google = env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET ? { clientId: env.GOOGLE_CLIENT_ID ?? '', clientSecret: env.GOOGLE_CLIENT_SECRET ?? '' } : undefined;
  const apple = env.APPLE_CLIENT_ID || env.APPLE_CLIENT_SECRET ? { clientId: env.APPLE_CLIENT_ID ?? '', clientSecret: env.APPLE_CLIENT_SECRET ?? '', appBundleIdentifier: env.APPLE_APP_BUNDLE_IDENTIFIER } : undefined;
  if (google && (!google.clientId || !google.clientSecret) || apple && (!apple.clientId || !apple.clientSecret)) throw new Error('Social sign-in requires complete Laundry-owned provider credentials');
  const provider = new TwilioPhoneVerification({ db, accountSid: env.LAUNDRY_TWILIO_ACCOUNT_SID ?? '',
    authToken: env.LAUNDRY_TWILIO_AUTH_TOKEN ?? '', serviceSid: env.LAUNDRY_TWILIO_VERIFY_SERVICE_SID ?? '',
    hashKey: env.LAUNDRY_IDENTITY_HASH_KEY ?? '', hourlyBudget: Number(env.LAUNDRY_SMS_HOURLY_BUDGET ?? 0) });
  return createLaundryAuth({ db, secret, baseUrl, trustedOrigins: origins, phoneVerification: provider, google, apple });
}
