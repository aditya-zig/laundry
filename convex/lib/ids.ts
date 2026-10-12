// Mutation-compatible UUID generation. No node:crypto. Uses Web Crypto
// (available in the Convex isolate) with a hash fallback so IDs stay
// RFC-4122 v4 shaped even if randomUUID is missing.
//
// Security blocker: the Math.random fallback below is NOT cryptographic and
// must never secure real sessions or OTPs. The engine gates both OTP request
// and OTP verify behind DEMO_MODE until a real SMS/auth provider plus
// verified strong randomness lands; session tokens and challenge codes minted
// here are demo-only. Logical IDs (quotes, orders, idempotency rows) only need
// uniqueness, and seed paths re-check by logical ID before insert.

export function uuid(): string {
  const c = globalThis.crypto as unknown as
    | { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array }
    | undefined;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Last resort: timestamp + counter based v4-shaped ID. Mutations are
  // atomic, so collisions across concurrent calls are still unlikely, and
  // logical-ID uniqueness is enforced by lookup before insert for seeds.
  const h = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  const a = h();
  const b = h();
  return `${a.slice(0, 8)}-${b.slice(0, 4)}-4${b.slice(5, 8)}-8${a.slice(1, 4)}-${a}${b}`.slice(0, 36);
}

export function sessionToken(): string {
  return `sess_${uuid().replace(/-/g, "")}`;
}

export function sixDigitOtp(): string {
  const c = globalThis.crypto as unknown as
    | { getRandomValues?: (a: Uint8Array) => Uint8Array }
    | undefined;
  if (c?.getRandomValues) {
    const b = c.getRandomValues(new Uint8Array(4));
    const n = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
    return String(100000 + (n % 900000));
  }
  return String(100000 + Math.floor(Math.random() * 900000));
}
