'use strict';
// Synthetic local RSA inputs. No credentials, network calls, or production keys.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { generateKeyPairSync, privateEncrypt, constants, createHash, sign } = require('node:crypto');
const { resolve } = require('node:path');
const forge = require(resolve(process.argv[2]));
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 3 });
const key = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }));
const message = Buffer.from('Laundry synthetic RSA signature regression');
const digest = createHash('sha256').update(message).digest();
const a = forge.asn1;
const node = (type, constructed, value) => a.create(a.Class.UNIVERSAL, type, constructed, value);
const oid = () => node(a.Type.OID, false, a.oidToDer(forge.pki.oids.sha256).getBytes());
const nil = () => node(a.Type.NULL, false, '');
const garbage = () => node(a.Type.OCTETSTRING, false, 'unconsumed nested bytes');
function signature(children) {
  const info = node(a.Type.SEQUENCE, true, [node(a.Type.SEQUENCE, true, children), node(a.Type.OCTETSTRING, false, digest.toString('binary'))]);
  const der = Buffer.from(a.toDer(info).getBytes(), 'binary');
  const encoded = Buffer.concat([Buffer.from([0, 1]), Buffer.alloc(256 - der.length - 3, 0xff), Buffer.from([0]), der]);
  return privateEncrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, encoded).toString('binary');
}
test('accepts a real Node SHA-256 signature', () => {
  assert.equal(key.verify(digest.toString('binary'), sign('sha256', message, privateKey).toString('binary')), true);
});
test('preserves an AlgorithmIdentifier with absent optional NULL', () => {
  assert.equal(key.verify(digest.toString('binary'), signature([oid()])), true);
});
test('preserves an AlgorithmIdentifier with canonical NULL', () => {
  assert.equal(key.verify(digest.toString('binary'), signature([oid(), nil()])), true);
});
for (const [name, children] of [
  ['extra OCTET STRING after NULL', [oid(), nil(), garbage()]],
  ['extra OCTET STRING without NULL', [oid(), garbage()]],
  ['extra NULL after NULL', [oid(), nil(), nil()]],
  ['multiple unconsumed elements', [oid(), nil(), garbage(), garbage()]],
]) {
  test(`rejects CVE-2026-85393: ${name}`, () => {
    let accepted = false;
    try { accepted = key.verify(digest.toString('binary'), signature(children)); }
    catch (error) { assert.match(error.message, /DigestInfo/); }
    assert.equal(accepted, false, 'Malformed DigestAlgorithm must never verify as a valid signature');
  });
}
