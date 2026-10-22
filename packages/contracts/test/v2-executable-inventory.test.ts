import { describe, expect, it } from "vitest";
import { v2 } from "../src/index.js";

describe("v2 executable inventory", () => {
  it("resolves every declared request and response to an executable schema", () => {
    for (const route of v2.ROUTE_REGISTRY) {
      expect(v2.getWireSchema(route.responseSchema), route.id).toHaveProperty("parse");
      if (route.requestSchema) expect(v2.getWireSchema(route.requestSchema), route.id).toHaveProperty("parse");
    }
    expect(() => v2.getWireSchema("NotARealSchema")).toThrow();
  });

  it("requires authenticated provider identity and durable event deduplication instead of an admin token or client key", () => {
    for (const route of v2.ROUTE_REGISTRY.filter(r => r.path.includes("/webhooks/"))) {
      expect(route.authentication, route.id).toBe("PROVIDER_SIGNATURE");
      expect(route.idempotency, route.id).toBe("PROVIDER_EVENT");
      expect(route.roles, route.id).toEqual(["PROVIDER"]);
    }
  });

  it("assigns billing, logistics and support commands to their domain owners", () => {
    const owners = new Map(v2.ROUTE_REGISTRY.map(r => [r.id, r.ownerTask]));
    expect(owners.get("billing.attempts")).toBe("B05");
    expect(owners.get("logistics.tracking")).toBe("B06");
    expect(owners.get("support.incidents.create")).toBe("B08");
    expect(owners.get("reviews.create")).toBe("B08");
  });
});
