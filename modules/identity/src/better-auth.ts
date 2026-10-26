import { createHmac } from 'node:crypto';
import type { Pool } from 'pg';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { bearer, phoneNumber } from 'better-auth/plugins';
import { v2 } from '@laundry/contracts';

/** The provider must atomically consume an accepted code. No SMS is sent by
 * constructing auth; tests inject an in-memory provider, never a live account. */
export interface PhoneVerification {
  send(phone: string): Promise<void>;
  verify(phone: string, code: string): Promise<boolean>;
}
export interface LaundryAuthOptions {
  db: Pool;
  secret: string;
  baseUrl: string;
  trustedOrigins: string[];
  phoneVerification: PhoneVerification;
  google?: { clientId: string; clientSecret: string };
  apple?: { clientId: string; clientSecret: string; appBundleIdentifier?: string };
}

export function createLaundryAuth(options: LaundryAuthOptions) {
  if (options.secret.length < 32) throw new Error('Better Auth requires an independent random secret of at least 32 characters');
  const tempEmail = (phone: string) => `${createHmac('sha256', options.secret).update(phone).digest('hex')}@phone.laundry.invalid`;
  return betterAuth({
    appName: 'Laundry',
    baseURL: options.baseUrl,
    // Kept separate from the frozen v2 OTP/session routes during migration.
    basePath: '/v2/auth/identity',
    secret: options.secret,
    database: options.db,
    logger: { disabled: true }, // Provider/database errors may include private values.
    trustedOrigins: [...options.trustedOrigins, ...(options.apple ? ['https://appleid.apple.com'] : [])],
    emailAndPassword: { enabled: false },
    socialProviders: { ...(options.google ? { google: options.google } : {}), ...(options.apple ? { apple: options.apple } : {}) },
    user: { modelName: 'laundry_auth_user' },
    session: { modelName: 'laundry_auth_session', expiresIn: 60 * 60 * 24 * 7, cookieCache: { enabled: false } },
    account: {
      modelName: 'laundry_auth_account',
      encryptOAuthTokens: true,
      storeStateStrategy: 'database',
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        // Explicit linking requires the current session + provider proof; an
        // Apple relay email must not imply ownership of another email account.
        allowDifferentEmails: true,
        allowUnlinkingAll: false,
      },
    },
    verification: { modelName: 'laundry_auth_verification' },
    hooks: { before: createAuthMiddleware(async context => {
      // Also protect first-login/send-OTP requests without cookies. Native
      // bearer clients may omit Origin, but cannot claim an untrusted one.
      const origin = context.request?.headers.get('origin');
      if (origin && !context.context.isTrustedOrigin(origin)) throw new APIError('FORBIDDEN', { message: 'Untrusted authentication origin' });
    }) },
    advanced: {
      // The framework otherwise disables origin checks in NODE_ENV=test;
      // exercise the same security policy in verification and production.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      database: { generateId: 'uuid' },
      // Apple's callback is a cross-site POST. Preserve state-cookie CSRF
      // checking without weakening every session cookie to SameSite=None.
      ...(options.apple && options.baseUrl.startsWith('https://') ? {
        cookies: { state: { attributes: { sameSite: 'none' as const, secure: true } } },
      } : {}),
    },
    rateLimit: { enabled: true, storage: 'database', modelName: 'laundry_auth_rate_limit', window: 60, max: 30 },
    databaseHooks: {
      verification: { create: { before: async value => {
        // The SMS provider owns generation/expiry/atomic consumption. Discard
        // the plugin's unused code rather than persisting plaintext OTPs.
        if (v2.phoneSchema.safeParse(value.identifier).success) return { data: { ...value, value: 'provider-managed' } };
      } } },
    },
    plugins: [
      bearer(),
      phoneNumber({
        phoneNumberValidator: phone => v2.phoneSchema.safeParse(phone).success,
        requireVerification: true,
        sendOTP: async ({ phoneNumber }) => options.phoneVerification.send(phoneNumber),
        verifyOTP: async ({ phoneNumber, code }) => v2.phoneSchema.safeParse(phoneNumber).success &&
          /^\d{6}$/.test(code) && options.phoneVerification.verify(phoneNumber, code),
        signUpOnVerification: { getTempEmail: tempEmail, getTempName: () => 'Laundry customer' },
      }),
    ],
  });
}
export type LaundryAuth = ReturnType<typeof createLaundryAuth>;

/** Only a freshly checked framework session can cross into the domain. Never
 * accept a client's claimed provider ID, email, role or phone verification. */
export async function verifiedAuthPhone(auth: LaundryAuth, headers: Headers): Promise<{ phone: string; userId: string; sessionId: string }> {
  const current = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
  if (!current?.user.phoneNumberVerified || !v2.phoneSchema.safeParse(current.user.phoneNumber).success) {
    throw new Error('VERIFIED_PHONE_REQUIRED');
  }
  return { phone: v2.phoneSchema.parse(current.user.phoneNumber), userId: current.user.id, sessionId: current.session.id };
}
