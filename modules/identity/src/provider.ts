import type { Pool } from 'pg';
import { IdentityService, type OtpDelivery } from './identity';
import { IdentityFault } from './errors';

interface TwilioConfig { accountSid: string; authToken: string; messagingServiceSid: string }

/** Explicit Laundry-owned SMS credentials only. Queued acceptance is not proof
 * of handset delivery. Network calls require an enabled configured environment;
 * acceptance tests replace fetch and never send a commercial message. */
export class TwilioSmsDelivery implements OtpDelivery {
  readonly mode = 'LIVE' as const;
  constructor(private readonly config: TwilioConfig, private readonly sendRequest: typeof fetch = fetch) {
    if (!/^AC[a-f0-9]{32}$/i.test(config.accountSid) || !/^[a-f0-9]{32}$/i.test(config.authToken) || !/^MG[a-f0-9]{32}$/i.test(config.messagingServiceSid)) throw new Error('Invalid Laundry SMS provider configuration');
  }
  async send(input: { phone: string; code: string; challengeId: string }): Promise<{ reference: string }> {
    try {
      const response = await this.sendRequest(`https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { authorization: `Basic ${Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: input.phone, MessagingServiceSid: this.config.messagingServiceSid, Body: `Your Laundry sign-in code is ${input.code}. It expires in 5 minutes. Never share this sign-in code.` }).toString(),
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new IdentityFault(response.status >= 400 && response.status < 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_OUTCOME_UNKNOWN', 'Code delivery could not be confirmed');
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 16_384) { await reader.cancel(); throw new Error('Invalid delivery response'); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!value || typeof value !== 'object' || !('sid' in value) || typeof value.sid !== 'string' || !/^SM[a-f0-9]{32}$/i.test(value.sid) ||
        !('status' in value) || typeof value.status !== 'string') throw new Error('Unconfirmed delivery response');
      if (['failed', 'undelivered'].includes(value.status)) throw new IdentityFault('PROVIDER_UNAVAILABLE', 'Code delivery could not be confirmed');
      if (!['accepted', 'queued', 'sending', 'sent', 'delivered'].includes(value.status)) throw new Error('Unconfirmed delivery response');
      return { reference: value.sid };
    } catch (error) {
      // Provider bodies/errors can contain phone numbers, OTPs or credentials.
      if (error instanceof IdentityFault) throw error;
      throw new IdentityFault('PROVIDER_OUTCOME_UNKNOWN', 'Code delivery could not be confirmed');
    }
  }
}

export function identityFromEnvironment(db: Pool, env: NodeJS.ProcessEnv = process.env): IdentityService | null {
  const name = env.LAUNDRY_IDENTITY_PROVIDER;
  // Explicit deferred-messaging deployment: no provider, login or fake identity.
  if (name === 'disabled') return null;
  if (!name) {
    if (env.NODE_ENV === 'production') throw new Error('Production requires a configured Laundry identity provider');
    return null;
  }
  if (name !== 'twilio-sms') throw new Error('Unsupported Laundry identity provider');
  const hashKey = env.LAUNDRY_IDENTITY_HASH_KEY ?? '', encryptionKey = env.LAUNDRY_IDENTITY_ENCRYPTION_KEY ?? '';
  const provider = new TwilioSmsDelivery({ accountSid: env.LAUNDRY_TWILIO_ACCOUNT_SID ?? '', authToken: env.LAUNDRY_TWILIO_AUTH_TOKEN ?? '', messagingServiceSid: env.LAUNDRY_TWILIO_MESSAGING_SERVICE_SID ?? '' });
  const budget = env.LAUNDRY_SMS_HOURLY_BUDGET ?? '';
  if (!/^[1-9]\d{0,5}$/.test(budget) || Number(budget) > 100_000) throw new Error('Set an explicit bounded LAUNDRY_SMS_HOURLY_BUDGET before enabling commercial delivery');
  return new IdentityService({ db, provider, hashKey, encryptionKey, maxOtpPerHour: Number(budget) });
}
