import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { IdentityService } from '../../apps/api/dist/modules/identity/src/identity.js';

// Original credentials stay in this process's memory, never in the receipt or
// archive. Restoring the independent deployment secrets is a separate operator
// requirement; a database dump is intentionally insufficient to decrypt them.
export async function prepareIdentityRecovery(db) {
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
    assert.equal(sessions, 2);
    return { scope: 'v2 customer identity; external SMS is fake', sessionsRestored: sessions, ownedAddressesRestored: 1,
      encryptedRefreshReplayPreserved: true, missingDeploymentKeysFailClosed: true };
  };
}
