import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { IdentityService } from '../../apps/api/dist/modules/identity/src/identity.js';
import { createLaundryAuth, verifiedAuthPhone } from '../../apps/api/dist/modules/identity/src/better-auth.js';

// Original credentials stay in this process's memory, never in the receipt or
// archive. Restoring the independent deployment secrets is a separate operator
// requirement; a database dump is intentionally insufficient to decrypt them.
export async function prepareIdentityRecovery(db) {
  const existingSessions = (await db.query('SELECT count(*)::int AS n FROM identity_sessions')).rows[0].n;
  const secrets = { hashKey: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex') };
  let code;
  const provider = { mode: 'FAKE', async send(input) { code = input.code; return { reference: 'synthetic-recovery-' + input.challengeId }; } };
  const options = { provider, ...secrets };
  const service = new IdentityService({ db, ...options });
  const challenge = await service.requestOtp({ phone: '+919000019876' }, randomUUID(), 'synthetic-recovery-peer');
  const original = await service.verifyOtp({ challengeId: challenge.challengeId, code }, randomUUID(), 'synthetic-recovery-peer');
  const refreshKey = randomUUID();
  const current = await service.refresh({ refreshToken: original.refreshToken }, refreshKey, 'synthetic-recovery-peer');
  const address = await service.createAddress(current.accessToken, { label: 'Synthetic recovery address', line1: 'Not a real address', city: 'Synthetic', postalCode: '560001', coordinates: { lat: 12.97, lng: 77.59 } }, randomUUID());
  const frameworkSecret = randomBytes(32).toString('hex');
  const origin = 'http://localhost:4100';
  let syntheticCodeAvailable = false;
  const frameworkOptions = { secret: frameworkSecret, baseUrl: origin, trustedOrigins: [origin], phoneVerification: {
    async send() { syntheticCodeAvailable = true; },
    async verify(_phone, candidate) {
      if (!syntheticCodeAvailable || candidate !== '654321') return false;
      syntheticCodeAvailable = false; return true;
    },
  } };
  const framework = createLaundryAuth({ db, ...frameworkOptions });
  const request = (auth, path, body, token) => auth.handler(new Request(`${origin}/v2/auth/identity${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json', origin, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));
  const phone = '+919000019877';
  assert.equal((await request(framework, '/phone-number/send-otp', { phoneNumber: phone })).status, 200);
  const signedIn = await request(framework, '/phone-number/verify', { phoneNumber: phone, code: '654321' });
  assert.equal(signedIn.status, 200);
  const frameworkToken = (await signedIn.json()).token;
  const frameworkHeaders = new Headers({ authorization: `Bearer ${frameworkToken}` });
  const proof = await verifiedAuthPhone(framework, frameworkHeaders);
  const linked = await service.exchangeVerifiedAuth(proof, randomUUID(), 'synthetic-framework-recovery');
  return async target => {
    const restored = new IdentityService({ db: target, ...options });
    assert.equal((await restored.authenticate(current.accessToken)).actor.id, current.actor.id);
    assert.deepEqual(await restored.listAddresses(current.accessToken), [address]);
    assert.deepEqual(await restored.refresh({ refreshToken: original.refreshToken }, refreshKey, 'synthetic-recovery-peer'), current);
    const wrongEncryption = new IdentityService({ db: target, ...options, encryptionKey: randomBytes(32).toString('hex') });
    await assert.rejects(wrongEncryption.refresh({ refreshToken: original.refreshToken }, refreshKey, 'synthetic-recovery-peer'), error => error.code === 'PROVIDER_UNAVAILABLE');
    const wrongHash = new IdentityService({ db: target, ...options, hashKey: randomBytes(32).toString('hex') });
    await assert.rejects(wrongHash.authenticate(current.accessToken), error => error.code === 'UNAUTHENTICATED');
    const sessions = (await target.query('SELECT count(*)::int AS n FROM identity_sessions')).rows[0].n;
    assert.equal(sessions, existingSessions + 3);
    const restoredFramework = createLaundryAuth({ db: target, ...frameworkOptions });
    assert.deepEqual(await verifiedAuthPhone(restoredFramework, frameworkHeaders), proof);
    assert.equal((await restored.authenticate(linked.accessToken)).actor.id, linked.actor.id);
    assert.equal((await request(restoredFramework, '/sign-out', {}, frameworkToken)).status, 200);
    await assert.rejects(restored.authenticate(linked.accessToken), error => error.code === 'UNAUTHENTICATED');
    return { scope: 'v2 legacy and Better Auth customer identity; external SMS is fake; social token recovery not exercised', sessionsRestored: sessions, ownedAddressesRestored: 1,
      encryptedRefreshReplayPreserved: true, missingDeploymentKeysFailClosed: true,
      frameworkSessionRestored: true, frameworkLogoutInvalidatesDomainSession: true };
  };
}
