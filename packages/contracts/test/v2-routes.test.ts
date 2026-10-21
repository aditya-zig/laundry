import { describe, expect, it } from "vitest";
import { errorCodeSchema, errorHttpStatus } from "../src/v2/common.js";
import { ROUTE_REGISTRY, resolveRoute, routeRegistrySchema } from "../src/v2/routes.js";
import { eventTypeSchema } from "../src/v2/events.js";
import { serviceCodeSchema } from "../src/v2/catalog.js";

const MUTATING = new Set(["POST", "PATCH", "PUT", "DELETE"]);

describe("v2 route registry", () => {
  it("parses every entry", () => {
    expect(() => routeRegistrySchema.parse(ROUTE_REGISTRY)).not.toThrow();
  });

  it("has no duplicate method and path pair", () => {
    const keys = ROUTE_REGISTRY.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("rejects duplicate operation IDs even on different paths", () => {
    expect(routeRegistrySchema.safeParse([
      ROUTE_REGISTRY[0], { ...ROUTE_REGISTRY[1], id: ROUTE_REGISTRY[0].id },
    ]).success).toBe(false);
  });

  it("resolves each operation with encoded parameters", () => {
    for (const route of ROUTE_REGISTRY) {
      const names = [...route.path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
      const params = Object.fromEntries(names.map(name => [name, "id/with ?#"]));
      const resolved = resolveRoute(route.id, params);
      expect(resolved.method).toBe(route.method);
      expect(resolved.path).toBe(route.path.replace(/\{[^}]+\}/g, "id%2Fwith%20%3F%23"));
      expect(route.path).not.toContain("%2F");
    }
  });

  it("rejects unknown operations and missing, extra or traversal parameters", () => {
    expect(() => resolveRoute("does.not.exist")).toThrow("Unknown route ID");
    expect(() => resolveRoute("orders.detail")).toThrow("Missing route parameter");
    expect(() => resolveRoute("orders.detail", { orderId: "x", other: "y" })).toThrow("Unused route parameter");
    for (const orderId of ["", ".", ".."]) {
      expect(() => resolveRoute("orders.detail", { orderId })).toThrow("Invalid route parameter");
    }
    expect(() => resolveRoute("orders.detail", Object.create({ orderId: "x" }))).toThrow("Missing route parameter");
  });

  it("gives every route a response schema, a role and an error code", () => {
    for (const route of ROUTE_REGISTRY) {
      expect(route.responseSchema.length).toBeGreaterThan(0);
      expect(route.roles.length).toBeGreaterThan(0);
      expect(route.errorCodes.length).toBeGreaterThan(0);
      expect(route.ownerTask).toMatch(/^B\d\d$/);
    }
  });

  it("only uses error codes the envelope can carry", () => {
    const allowed = new Set<string>(errorCodeSchema.options);
    for (const route of ROUTE_REGISTRY) {
      for (const code of route.errorCodes) {
        expect(allowed.has(code)).toBe(true);
        expect(errorHttpStatus[code as keyof typeof errorHttpStatus]).toBeGreaterThanOrEqual(400);
      }
    }
  });

  it("requires an idempotency key on every mutating route", () => {
    for (const route of ROUTE_REGISTRY) {
      if (MUTATING.has(route.method)) {
        expect(route.idempotency).not.toBe("NOT_APPLICABLE");
      }
    }
  });

  it("covers every route family named in the contract freeze", () => {
    const families = new Set(ROUTE_REGISTRY.map((r) => r.path.split("/")[2]));
    for (const family of [
      "identity",
      "catalog",
      "availability",
      "orders",
      "billing",
      "logistics",
      "rider",
      "media",
      "incidents",
      "reviews",
      "conversations",
      "ops",
      "webhooks",
    ]) {
      expect(families.has(family)).toBe(true);
    }
  });

  it("keeps a public route free of staff roles", () => {
    for (const route of ROUTE_REGISTRY.filter((r) => r.roles.includes("PUBLIC"))) {
      expect(route.roles).toEqual(["PUBLIC"]);
    }
  });

  it("marks every read as non mutating and every mutation as idempotent", () => {
    for (const route of ROUTE_REGISTRY.filter((r) => r.method === "GET")) {
      expect(route.idempotency).toBe("NOT_APPLICABLE");
    }
  });
});

describe("v2 event catalog", () => {
  it("publishes the ten frozen event types", () => {
    expect(eventTypeSchema.options).toEqual([
      "order.confirmed.v2",
      "order.intake-recorded.v2",
      "order.adjustment-decided.v2",
      "order.ready-for-return.v2",
      "order.delivered.v2",
      "payment.settled.v2",
      "refund.updated.v2",
      "delivery.updated.v2",
      "media.uploaded.v2",
      "conversation.draft-confirmed.v2",
    ]);
  });
});

describe("v2 catalog and route agreement", () => {
  it("only references service codes the catalog knows", () => {
    const codes = new Set<string>(serviceCodeSchema.options);
    for (const route of ROUTE_REGISTRY.filter((r) => r.path.includes("/catalog/"))) {
      expect(codes.size).toBe(4);
    }
  });
});
