import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  IdempotencyStore,
  authorizeHandover,
  authorizeOrderRead,
  checkVersion,
  conversationMessageResultSchema,
  quoteInputSchema,
  quoteSchema,
  reviewInputSchema,
  stableStringify,
  windowSchema,
  type Actor,
  type DeliveryJob,
  type Order,
  type QuoteInput,
} from "../src/index.js";

// Minimal inline shapes for behavior tests. Rich demo data lives in
// @laundry/test-fixtures, which depends on this package, so the import
// direction stays one-way.
const quoteInput: QuoteInput = {
  addressId: "66666666-6666-4666-8666-666666666666",
  lines: [
    {
      serviceId: "11111111-1111-4111-8111-111111111111",
      garmentTypeId: "22222222-2222-4222-8222-222222222222",
      quantity: 5,
    },
  ],
  pickupWindow: {
    start: "2026-10-12T09:00:00.000Z",
    end: "2026-10-12T10:00:00.000Z",
    timezone: "Asia/Kolkata",
  },
  requestedReturnBy: "2026-10-17T18:00:00.000Z",
  timezone: "Asia/Kolkata",
};

const FAC_A = "12121212-1212-4121-8121-121212121212";
const FAC_B = "34343434-3434-4343-8343-343434343434";

function orderOf(customerId: string, facilityId = FAC_A): Order {
  const window = { ...quoteInput.pickupWindow };
  const line = { ...quoteInput.lines[0], unitPriceMinor: 7900, lineTotalMinor: 39500 };
  return {
    id: "99999999-9999-4999-8999-999999999999",
    version: 2,
    status: "CONFIRMED",
    customerId,
    facilityId,
    lines: [{ ...line, orderLineId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
    totalMinor: 44900,
    currency: "INR",
    pickupWindow: window,
    promisedReturnWindow: {
      start: "2026-10-14T09:00:00.000Z",
      end: "2026-10-14T18:00:00.000Z",
      timezone: "Asia/Kolkata",
    },
    createdAt: "2026-10-11T10:00:00.000Z",
    timeline: [{ status: "CONFIRMED", label: "Payment captured", at: "2026-10-11T10:05:00.000Z" }],
    paymentStatus: "CAPTURED",
    deliveries: [
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        orderId: "99999999-9999-4999-8999-999999999999",
        leg: "PICKUP",
        status: "ASSIGNED",
        version: 1,
        customerName: "Demo Customer",
        address: "14 Demo Lane",
        window,
        bagIds: [],
        provider: "manual",
        dispatchMode: "MANUAL",
        capabilities: ["OTP_HANDOVER"],
        assignedTo: "rider-new",
      } satisfies DeliveryJob,
    ],
  };
}

const customer = (id: string): Actor => ({ id, role: "customer", scopes: [] });

describe("contracts v1 behavior", () => {
  it("rejects invalid shapes: empty lines, negative totals, inverted windows, bad ratings", () => {
    expect(quoteInputSchema.safeParse({ ...quoteInput, lines: [] }).success).toBe(false);
    expect(
      quoteSchema.safeParse({
        id: "77777777-7777-4777-8777-777777777777",
        version: 1,
        expiresAt: "2026-10-11T16:00:00.000Z",
        lines: [{ ...quoteInput.lines[0], unitPriceMinor: 7900, lineTotalMinor: -5 }],
        totalMinor: -5,
        currency: "INR",
        provisional: true,
        pickupWindow: quoteInput.pickupWindow,
        promisedReturnWindow: quoteInput.pickupWindow,
        breakdown: [{ label: "x", amountMinor: -5 }],
      }).success
    ).toBe(false);
    expect(
      windowSchema.safeParse({
        start: "2026-10-12T10:00:00.000Z",
        end: "2026-10-12T09:00:00.000Z",
        timezone: "Asia/Kolkata",
      }).success
    ).toBe(false);
    expect(
      reviewInputSchema.safeParse({
        orderId: "99999999-9999-4999-8999-999999999999",
        overall: 9,
        publishConsent: true,
      }).success
    ).toBe(false);
  });

  it("prevents a customer from reading another customer order without leaking existence", () => {
    const mine = orderOf("cust-alice");
    expect(authorizeOrderRead(customer("cust-alice"), mine)).toEqual({ ok: true });
    const other = authorizeOrderRead(customer("cust-mallory"), mine);
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.error.code).toBe("NOT_FOUND");
  });

  it("blocks a revoked rider from completing a handover after reassignment", () => {
    const job = orderOf("cust-alice").deliveries[0];
    const revoked = new Set(["rider-old"]);
    const attempt = authorizeHandover({ id: "rider-old", role: "rider", scopes: [] }, job, revoked);
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.error.code).toBe("FORBIDDEN");
    expect(authorizeHandover({ id: "rider-new", role: "rider", scopes: [] }, job, revoked)).toEqual({ ok: true });
  });

  it("keeps facility roles scoped to their own facility orders", () => {
    const mine = orderOf("cust-alice", FAC_A);
    const insider: Actor = { id: "fac-user", role: "facility", scopes: [`facility:${FAC_A}`] };
    const outsider: Actor = { id: "fac-user", role: "facility", scopes: [`facility:${FAC_B}`] };
    expect(authorizeOrderRead(insider, mine)).toEqual({ ok: true });
    const denied = authorizeOrderRead(outsider, mine);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe("FORBIDDEN");
  });

  it("runs concurrent identical idempotency keys exactly once", async () => {
    const store = new IdempotencyStore<{ quoteId: string }>();
    let executions = 0;
    const key = "11111111-1111-4111-8111-111111111111";
    const payload = { addressId: quoteInput.addressId, lines: quoteInput.lines };
    const results = await Promise.all(
      Array.from({ length: 10 }, async () =>
        store.run(key, payload, () => {
          executions += 1;
          return { quoteId: "quote-1" };
        })
      )
    );
    expect(executions).toBe(1);
    expect(new Set(results.map((r) => r.result.quoteId)).size).toBe(1);
    expect(store.executionCount(key)).toBe(1);
  });

  it("returns IDEMPOTENCY_CONFLICT when the same key carries a different payload", () => {
    const store = new IdempotencyStore<string>();
    const key = "22222222-2222-4222-8222-222222222222";
    store.run(key, { a: 1 }, () => "first");
    try {
      store.run(key, { a: 2 }, () => "second");
      expect.unreachable("expected idempotency conflict");
    } catch (err) {
      expect((err as { code: string }).code).toBe("IDEMPOTENCY_CONFLICT");
    }
  });

  it("returns VERSION_CONFLICT with current state on stale expectedVersion", () => {
    const stale = checkVersion(4, 3);
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error.code).toBe("VERSION_CONFLICT");
      expect(stale.currentVersion).toBe(4);
    }
    expect(checkVersion(4, 4)).toEqual({ ok: true });
  });

  it("fails CI if any workspace script uses passWithNoTests", () => {
    const root = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
    expect(JSON.stringify(root.scripts ?? {})).not.toMatch(/passWithNoTests/);
  });

  it("hashes idempotency payloads independent of key order so retries replay", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    const store = new IdempotencyStore<string>();
    const key = "33333333-3333-4333-8333-333333333333";
    const first = store.run(key, { addressId: "x", lines: [1, 2] }, () => "once");
    expect(first.replayed).toBe(false);
    const retry = store.run(key, { lines: [1, 2], addressId: "x" }, () => "twice");
    expect(retry.replayed).toBe(true);
    expect(retry.result).toBe("once");
    expect(store.executionCount(key)).toBe(1);
  });

  it("keeps the build writing only to dist with no cross-package path mapping", () => {
    const build = JSON.parse(readFileSync(new URL("../tsconfig.build.json", import.meta.url), "utf8"));
    expect(build.compilerOptions.outDir).toBe("dist");
    expect(build.compilerOptions.rootDir).toBe("src");
    expect(build.compilerOptions.paths ?? {}).toEqual({});
    const stray = readdirSync(new URL("../src", import.meta.url)).filter((f) =>
      f.endsWith(".js") || f.endsWith(".d.ts") || f.endsWith(".map")
    );
    expect(stray).toEqual([]);
  });

  it("parses typed conversation drafts with an optional attached quote", () => {
    const parsed = conversationMessageResultSchema.safeParse({
      draft: {
        draftId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        revision: 2,
        state: "QUOTED",
        quoteId: "77777777-7777-4777-8777-777777777777",
        expiresAt: "2026-10-12T10:00:00.000Z",
        missingFields: [],
      },
      reply: "Here is your quote.",
      missingFields: [],
    });
    expect(parsed.success).toBe(true);
  });
});
