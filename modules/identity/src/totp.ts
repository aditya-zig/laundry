// Shared time-based one-time-code helpers for the staff MFA boundary.
// Pure functions only: the caller supplies the secret bytes and clock time,
// so provisioning tools and tests can exercise exactly what the service runs.
import { createHmac, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const MFA_STEP_MS = 30_000, MFA_WINDOW = 1;

export function base32(buffer: Buffer): string {
  let bits = 0, value = 0, output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function totpCode(secret: Buffer, step: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', secret).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const truncated = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(truncated % 10 ** digits).padStart(digits, '0');
}

export function totpMatches(secret: Buffer, code: string, timeMs: number, stepMs = MFA_STEP_MS, window = MFA_WINDOW): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const step = Math.floor(timeMs / stepMs);
  const candidate = Buffer.from(code);
  for (let drift = -window; drift <= window; drift++) {
    if (timingSafeEqual(Buffer.from(totpCode(secret, step + drift)), candidate)) return true;
  }
  return false;
}

export function provisioningUri(phone: string, base32Secret: string, issuer = 'Laundry'): string {
  const sanitizedPhone = /^(\+[1-9]\d{7,14})$/.exec(phone)?.[1];
  if (!sanitizedPhone) throw new Error('MFA provisioning requires a valid E.164 phone');
  if (!/^[A-Z2-7]+=*$/.test(base32Secret)) throw new Error('MFA provisioning requires a valid base32 secret');
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(sanitizedPhone)}?secret=${base32Secret}&issuer=${encodeURIComponent(issuer)}`;
}
