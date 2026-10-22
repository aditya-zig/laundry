import { describe, expect, it, vi } from "vitest";
import { createV2Client } from "../src/v2.js";

const id = "11111111-1111-4111-8111-111111111111";

describe("v2 executable command boundaries", () => {
  it("rejects an unversioned cancellation before sending or allocating a retry key", async () => {
    const fetchImpl = vi.fn();
    const generateKey = vi.fn();
    const client = createV2Client({ fetchImpl, generateKey });
    await expect(async () => client.cancelOrder(id, "", 0)).rejects.toBeTruthy();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(generateKey).not.toHaveBeenCalled();
  });

  it("rejects slot payloads without pickup/return pairs", async () => {
    const client = createV2Client({ fetchImpl: vi.fn(async () => Response.json({})) });
    await expect(client.listSlots({ areaId: id, from: "2026-10-22T00:00:00Z", to: "2026-10-23T00:00:00Z", serviceIds: [id] })).rejects.toBeTruthy();
  });

  it("rejects a dead-letter response without durable job identity", async () => {
    const client = createV2Client({ fetchImpl: vi.fn(async () => Response.json({
      items: [{}], pageInfo: { hasMore: false },
    })) });
    await expect(client.listDeadLetters()).rejects.toBeTruthy();
  });

  it("rejects incomplete health counters", async () => {
    const client = createV2Client({ fetchImpl: vi.fn(async () => Response.json({})) });
    await expect(client.jobHealth()).rejects.toBeTruthy();
  });
});
