import { afterEach, expect, test, vi } from "vitest";
import { createHmac } from "node:crypto";
import { verifyWhatsappSignature } from "../../../modules/conversations/src/whatsapp";

afterEach(() => vi.unstubAllEnvs());

// Regression: handoff QA, 2026-10-21. Equal character counts do not mean
// equal UTF-8 byte lengths; malformed signatures must reject, not throw.
test.each(["é".repeat(64), "g".repeat(64), "0".repeat(63), ""])("malformed webhook digest is refused without an exception", digest => {
  vi.stubEnv("WHATSAPP_APP_SECRET", "synthetic-signature-secret");
  expect(verifyWhatsappSignature(Buffer.from("{}"), `sha256=${digest}`)).toBe(false);
});

test("a valid signature authenticates only the exact received bytes", () => {
  const secret = "synthetic-signature-secret";
  vi.stubEnv("WHATSAPP_APP_SECRET", secret);
  const raw = Buffer.from('{"message":"fixture"}');
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  expect(verifyWhatsappSignature(raw, signature)).toBe(true);
  expect(verifyWhatsappSignature(Buffer.from('{ "message":"fixture"}'), signature)).toBe(false);
});
