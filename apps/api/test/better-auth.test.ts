import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { getMigrations } from 'better-auth/db/migration';
import { createLaundryAuth, verifiedAuthPhone, type LaundryAuth, type PhoneVerification } from '../../../modules/identity/src/better-auth';
import { betterAuthFromEnvironment, TwilioPhoneVerification } from '../../../modules/identity/src/better-auth-provider';
import { IdentityService } from '../../../modules/identity/src';
import { getPool, initializeDb, closePool } from '../../../modules/shared/src/db';
import { IdentityModule } from '../src/features/identity/identity.module';
import { configureHttpBody } from '../src/http-body';
import { createV2Client } from '../../../packages/api-client/src/v2';

const origin = 'http://localhost:4100';
const phone = '+919000022221';
const key = () => randomUUID();
const headers = (token: string) => new Headers({ authorization: `Bearer ${token}` });
let auth: LaundryAuth;
let service: IdentityService;
let sends: string[];
let codes: Map<string, string>;
let provider: PhoneVerification;

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/laundry_verify_')) throw new Error('Disposable local PostgreSQL required');
  await initializeDb();
});
beforeEach(async () => {
  await getPool().query('TRUNCATE identity_profiles, identity_otp_challenges, identity_command_results, identity_rate_buckets, identity_staff, laundry_auth_user, laundry_auth_verification, laundry_auth_rate_limit CASCADE');
  sends = []; codes = new Map();
  provider = {
    async send(number) { sends.push(number); codes.set(number, '654321'); },
    async verify(number, code) { // Synthetic atomic consume; no commercial messages.
      if (codes.get(number) !== code) return false;
      codes.delete(number); return true;
    },
  };
  auth = createLaundryAuth({ db: getPool(), secret: randomBytes(32).toString('hex'), baseUrl: origin, trustedOrigins: [origin], phoneVerification: provider,
    google: { clientId: 'synthetic-google-id', clientSecret: 'synthetic-google-secret' },
    apple: { clientId: 'synthetic.apple.service', clientSecret: 'synthetic-apple-secret', appBundleIdentifier: 'test.laundry.customer' } });
  service = new IdentityService({ db: getPool(), hashKey: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex'),
    provider: { mode: 'FAKE', async send() { throw new Error('Legacy SMS is not used by this test'); } } });
});
afterAll(closePool);

async function call(path: string, body: unknown, token?: string, requestOrigin = origin) {
  return auth.handler(new Request(`${origin}/v2/auth/identity${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json', origin: requestOrigin, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));
}
async function signIn(number = phone) {
  expect((await call('/phone-number/send-otp', { phoneNumber: number })).status).toBe(200);
  const response = await call('/phone-number/verify', { phoneNumber: number, code: '654321' });
  expect(response.status).toBe(200);
  const data = await response.json();
  return { token: data.token as string, user: data.user };
}
async function seededSession(verified: boolean, email = 'relay@privaterelay.appleid.com') {
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser({ name: 'Synthetic social user', email, emailVerified: true,
    ...(verified ? { phoneNumber: phone, phoneNumberVerified: true } : {}) });
  return (await context.internalAdapter.createSession(user.id))!;
}

describe('Better Auth migration (real PostgreSQL, synthetic phone/OAuth providers only)', () => {
  it('canonical migration satisfies the pinned framework and plugin schema', async () => {
    const plan = await getMigrations(auth.options);
    expect(plan.toBeCreated).toEqual([]);
    expect(plan.toBeAdded).toEqual([]);
    expect(plan.schemaProblems).toEqual([]);
    expect(plan.unsafeChanges).toEqual([]);
  });
  it('requires valid E.164 phone and keeps unused framework codes out of storage', async () => {
    expect((await call('/phone-number/send-otp', { phoneNumber: '123' })).status).toBe(400);
    expect(sends).toEqual([]);
    expect((await call('/phone-number/send-otp', { phoneNumber: phone })).status).toBe(200);
    expect(sends).toEqual([phone]);
    expect((await getPool().query('SELECT value FROM laundry_auth_verification')).rows).toEqual([{ value: 'provider-managed' }]);
    expect((await call('/phone-number/verify', { phoneNumber: phone, code: '000000' })).status).toBe(400);
    const result = await call('/phone-number/verify', { phoneNumber: phone, code: '654321' });
    const data = await result.json();
    expect(data.user.phoneNumberVerified).toBe(true);
    expect(data.user.name).toBe('Laundry customer');
    expect(data.user.email).not.toContain(phone);
    expect(data.user.role).toBeUndefined();
  });
  it('rejects replay and simultaneous redemption when the provider atomically consumes OTPs', async () => {
    await call('/phone-number/send-otp', { phoneNumber: phone });
    const results = await Promise.all([call('/phone-number/verify', { phoneNumber: phone, code: '654321' }), call('/phone-number/verify', { phoneNumber: phone, code: '654321' })]);
    expect(results.map(response => response.status).sort()).toEqual([200, 400]);
    expect((await call('/phone-number/verify', { phoneNumber: phone, code: '654321' })).status).toBe(400);
    expect((await getPool().query('SELECT count(*)::int AS n FROM laundry_auth_session')).rows[0].n).toBe(1);
  });
  it('requires verified mobile even for a valid Apple/Google session', async () => {
    const social = await seededSession(false);
    await expect(verifiedAuthPhone(auth, headers(social.token))).rejects.toThrow('VERIFIED_PHONE_REQUIRED');
    const proof = { phone, userId: social.userId, sessionId: social.id };
    await expect(service.exchangeVerifiedAuth(proof, key(), 'peer')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await getPool().query('SELECT count(*)::int AS n FROM identity_profiles')).rows[0].n).toBe(0);
  });
  it('verifies mobile on the current social session without creating a second account', async () => {
    const social = await seededSession(false);
    expect((await call('/phone-number/send-otp', { phoneNumber: phone }, social.token)).status).toBe(200);
    const result = await call('/phone-number/verify', { phoneNumber: phone, code: '654321', updatePhoneNumber: true }, social.token);
    expect(result.status).toBe(200);
    const proof = await verifiedAuthPhone(auth, headers(social.token));
    expect(proof).toEqual({ phone, userId: social.userId, sessionId: social.id });
    expect((await service.exchangeVerifiedAuth(proof, key(), 'peer')).actor.role).toBe('CUSTOMER');
    expect((await getPool().query('SELECT count(*)::int AS n FROM laundry_auth_user')).rows[0].n).toBe(1);
  });
  it('refuses silent account merging when a social user claims an existing verified phone', async () => {
    const existing = await signIn();
    const social = await seededSession(false);
    await call('/phone-number/send-otp', { phoneNumber: phone }, social.token);
    const result = await call('/phone-number/verify', { phoneNumber: phone, code: '654321', updatePhoneNumber: true }, social.token);
    expect(result.status).toBe(400);
    await expect(verifiedAuthPhone(auth, headers(social.token))).rejects.toThrow('VERIFIED_PHONE_REQUIRED');
    expect((await verifiedAuthPhone(auth, headers(existing.token))).userId).toBe(existing.user.id);
    expect((await getPool().query('SELECT count(*)::int AS n FROM laundry_auth_user WHERE "phoneNumber"=$1', [phone])).rows[0].n).toBe(1);
  });
  it('maps a verified phone back to existing ownership, never by Apple relay email', async () => {
    const existing = key();
    await getPool().query('INSERT INTO identity_profiles (id,phone,created_at) VALUES ($1,$2,now())', [existing, phone]);
    const social = await seededSession(true);
    const proof = await verifiedAuthPhone(auth, headers(social.token));
    const exchangeKey = key();
    const first = await service.exchangeVerifiedAuth(proof, exchangeKey, 'peer');
    expect(first.actor).toMatchObject({ id: existing, role: 'CUSTOMER', facilityIds: [] });
    expect(await service.exchangeVerifiedAuth(proof, exchangeKey, 'peer')).toEqual(first);
    expect((await getPool().query('SELECT count(*)::int AS n FROM identity_profiles')).rows[0].n).toBe(1);
    expect(auth.options.account?.accountLinking).toMatchObject({ disableImplicitLinking: true, allowDifferentEmails: true });
  });
  it('cannot promote an invited staff phone through social sign-in or exchange', async () => {
    const login = await signIn();
    await getPool().query("INSERT INTO identity_staff (id,phone,role,active,created_at) VALUES ($1,$2,'ADMIN',true,now())", [key(), phone]);
    const proof = await verifiedAuthPhone(auth, headers(login.token));
    await expect(service.exchangeVerifiedAuth(proof, key(), 'peer')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await getPool().query('SELECT count(*)::int AS n FROM identity_sessions')).rows[0].n).toBe(0);
  });
  it('framework logout invalidates derived app tokens, refreshes and cached exchange replays', async () => {
    const login = await signIn();
    const proof = await verifiedAuthPhone(auth, headers(login.token));
    const exchangeKey = key();
    const appSession = await service.exchangeVerifiedAuth(proof, exchangeKey, 'peer');
    expect((await service.authenticate(appSession.accessToken)).actor.role).toBe('CUSTOMER');
    expect((await call('/sign-out', {}, login.token)).status).toBe(200);
    await expect(service.authenticate(appSession.accessToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(service.refresh({ refreshToken: appSession.refreshToken }, key(), 'peer')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(service.exchangeVerifiedAuth(proof, exchangeKey, 'peer')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
  it('v2 logout also removes the upstream framework session', async () => {
    const login = await signIn();
    const proof = await verifiedAuthPhone(auth, headers(login.token));
    const appSession = await service.exchangeVerifiedAuth(proof, key(), 'peer');
    await service.logout(appSession.accessToken, key());
    await expect(verifiedAuthPhone(auth, headers(login.token))).rejects.toThrow('VERIFIED_PHONE_REQUIRED');
  });
  it('deactivation, upstream expiry and removal of phone verification deny domain access', async () => {
    const login = await signIn();
    const proof = await verifiedAuthPhone(auth, headers(login.token));
    const appSession = await service.exchangeVerifiedAuth(proof, key(), 'peer');
    await getPool().query('UPDATE laundry_auth_user SET "phoneNumberVerified"=false');
    await expect(service.authenticate(appSession.accessToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await getPool().query('UPDATE laundry_auth_user SET "phoneNumberVerified"=true');
    await getPool().query('UPDATE identity_profiles SET active=false');
    await expect(service.authenticate(appSession.accessToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await getPool().query('UPDATE identity_profiles SET active=true');
    await getPool().query('UPDATE laundry_auth_session SET "expiresAt"=now()-interval \'1 second\'');
    await expect(service.authenticate(appSession.accessToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
  it('rejects hostile origins/redirects, unsigned callbacks and email/password login', async () => {
    expect((await call('/phone-number/send-otp', { phoneNumber: phone }, undefined, 'https://attacker.invalid')).status).toBe(403);
    expect(sends).toHaveLength(0);
    expect((await call('/sign-in/social', { provider: 'google', callbackURL: 'https://attacker.invalid/steal' })).status).toBe(403);
    const apple = await call('/sign-in/social', { provider: 'apple', callbackURL: `${origin}/account` });
    expect(apple.status).toBe(200);
    expect(new URL((await apple.json()).url).hostname).toBe('appleid.apple.com');
    const google = await call('/sign-in/social', { provider: 'google', callbackURL: `${origin}/account` });
    expect(new URL((await google.json()).url).hostname).toBe('accounts.google.com');
    expect((await call('/callback/apple', { code: 'forged', state: 'invalid' })).status).not.toBe(200);
    expect((await call('/sign-in/email', { email: 'test@example.invalid', password: 'not-supported' })).status).not.toBe(200);
  });
  it('keeps Apple POST state cookie-bound with SameSite=None only for state on HTTPS', async () => {
    const secure = createLaundryAuth({ db: getPool(), secret: randomBytes(32).toString('hex'), baseUrl: 'https://api.example.invalid',
      trustedOrigins: ['https://app.example.invalid'], phoneVerification: provider,
      apple: { clientId: 'synthetic.apple.service', clientSecret: 'synthetic-apple-secret' } });
    const response = await secure.handler(new Request('https://api.example.invalid/v2/auth/identity/sign-in/social', {
      method: 'POST', headers: { origin: 'https://app.example.invalid', 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'apple', callbackURL: 'https://app.example.invalid/account' }),
    }));
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie');
    expect(cookie).toContain('better-auth.state=');
    expect(cookie).toMatch(/HttpOnly/i); expect(cookie).toMatch(/Secure/i); expect(cookie).toMatch(/SameSite=None/i);
    const context = await secure.$context;
    expect(context.oauthConfig.skipStateCookieCheck).toBe(false);
    expect(context.authCookies.sessionToken.attributes.sameSite).toBe('lax');
  });
  it('serves raw framework routes before body parsing, then exchanges through the SDK', async () => {
    let app: NestExpressApplication | undefined;
    try {
      app = await NestFactory.create<NestExpressApplication>(IdentityModule.register(() => service, () => auth), { logger: false, bodyParser: false, rawBody: true });
      const handler = toNodeHandler(auth);
      app.use((req: Request, res: Response, next: NextFunction) => req.url.startsWith('/v2/auth/identity/') ? handler(req, res) : next());
      configureHttpBody(app);
      await app.listen(0, '127.0.0.1');
      const baseUrl = await app.getUrl();
      const send = await fetch(`${baseUrl}/v2/auth/identity/phone-number/send-otp`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ phoneNumber: phone }) });
      expect(send.status).toBe(200);
      const verified = await fetch(`${baseUrl}/v2/auth/identity/phone-number/verify`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ phoneNumber: phone, code: '654321' }) });
      const login = await verified.json();
      const exchangeClient = createV2Client({ baseUrl: `${baseUrl}/v2`, getToken: () => login.token });
      const session = await exchangeClient.exchangeAuthSession();
      const client = createV2Client({ baseUrl: `${baseUrl}/v2`, getToken: () => session.accessToken });
      expect(await client.me()).toEqual(session.actor);
      await expect(exchangeClient.exchangeAuthSession({ idempotencyKey: key() })).resolves.toMatchObject({ actor: session.actor });
    } finally { await app?.close(); }
  });
  it('shares the persisted send budget with legacy SMS during migration', async () => {
    const hashKey = randomBytes(32).toString('hex');
    const verification = new TwilioPhoneVerification({ db: getPool(), accountSid: `AC${'a'.repeat(32)}`, authToken: 'b'.repeat(32),
      serviceSid: `VA${'c'.repeat(32)}`, hashKey, hourlyBudget: 2 }, async () => new Response(JSON.stringify({ status: 'pending' })));
    const legacy = new IdentityService({ db: getPool(), hashKey, encryptionKey: randomBytes(32).toString('hex'), maxOtpPerHour: 2,
      provider: { mode: 'FAKE', async send() { throw new Error('Must not send after shared budget is exhausted'); } } });
    await verification.send(phone); await verification.send(phone);
    await expect(verification.send(phone)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(legacy.requestOtp({ phone }, key(), 'peer')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect((await getPool().query('SELECT attempts FROM identity_rate_buckets')).rows).toEqual([{ attempts: 2 }]);
  });
  it('is opt-in and refuses incomplete or shared provider configuration without sending', () => {
    expect(betterAuthFromEnvironment(getPool(), {})).toBeNull();
    expect(() => betterAuthFromEnvironment(getPool(), { LAUNDRY_AUTH_ENGINE: 'better-auth' })).toThrow('explicitly configured');
    expect(() => new TwilioPhoneVerification({ db: getPool(), accountSid: '', authToken: '', serviceSid: '', hashKey: '', hourlyBudget: 0 })).toThrow('Invalid Laundry');
  });
});
