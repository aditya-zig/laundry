import { createBrowserIdentityClient } from '@laundry/api-client';
import type { v2 } from '@laundry/contracts';

export function customerSignInMode(platform: string, engine: string | undefined): 'legacy' | 'browser' | 'blocked' {
  if (!engine || engine === 'legacy') return 'legacy';
  return engine === 'better-auth' && platform === 'web' ? 'browser' : 'blocked';
}

/** Web adapter only. Tokens stay in the framework cookie / existing session
 * foundation; neither OAuth callback URLs nor browser storage carry credentials. */
export function createCustomerBrowserSignIn(options: {
  baseUrl: string;
  adoptSession: (session: v2.Session) => Promise<void>;
  fetchImpl?: typeof fetch;
}) {
  const client = createBrowserIdentityClient(options);
  let exchangeKey: string | undefined;
  async function exchange() {
    // Retain the command intent on an unknown outcome. Retrying must not send SMS.
    exchangeKey ??= crypto.randomUUID();
    const session = await client.exchange({ idempotencyKey: exchangeKey });
    await options.adoptSession(session);
  }
  return {
    async restore(): Promise<'signedOut' | 'verifyPhone' | 'authenticated'> {
      const result = await client.auth.getSession({ query: { disableCookieCache: true } });
      if (result.error) throw new Error('Sign-in could not be checked. Try again.');
      if (!result.data) return 'signedOut';
      if (!result.data.user.phoneNumberVerified) return 'verifyPhone';
      await exchange();
      return 'authenticated';
    },
    async sendCode(phoneNumber: string) {
      const result = await client.auth.phoneNumber.sendOtp({ phoneNumber });
      if (result.error) throw new Error(result.error.message ?? 'Could not send a code. Do not automatically resend.');
    },
    async verifyCode(phoneNumber: string, code: string) {
      // A social session must verify its own mobile, not accidentally create a
      // separate phone account. The server still checks ownership/conflicts.
      const current = await client.auth.getSession({ query: { disableCookieCache: true } });
      if (current.error) throw new Error('Sign-in could not be checked. Try again.');
      const result = await client.auth.phoneNumber.verify({ phoneNumber, code,
        ...(current.data ? { updatePhoneNumber: true } : {}) });
      if (result.error) throw new Error(result.error.message ?? 'Could not verify that code.');
      await exchange();
    },
    async social(provider: 'google' | 'apple', callbackURL: string) {
      const result = await client.auth.signIn.social({ provider, callbackURL });
      if (result.error) throw new Error(result.error.message ?? 'This sign-in provider is not available.');
    },
  };
}
