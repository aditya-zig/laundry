// Focused behavior tests for the F03 rider feature API wrapper.
// Scenarios: reads through authorized(), handover intent via enqueueMutation
// with preserved actionId/version, pending handover receipts, logout purge.
import { describe, expect, it } from "vitest";
import type { v2 } from "@laundry/contracts";
import type { SessionFoundation, QueuedMutationRecord } from "@laundry/app-foundation";
import {
  createPartnerApi,
  pendingHandoverReceipts,
} from "./partner-api";

const actor: v2.Actor = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "RIDER",
  facilityIds: [],
  scope: { facilityIds: [] },
};

function queueRecord(overrides: Partial<QueuedMutationRecord> = {}): QueuedMutationRecord {
  return {
    idempotencyKey: "8a2b1c3d-0000-4111-8111-111111111111",
    routeId: "logistics.rider.handover",
    params: { jobId: "22222222-2222-4222-8222-222222222222" },
    bodyJson: JSON.stringify({
      legAttemptId: "22222222-2222-4222-8222-222222222222",
      expectedVersion: 3,
      actionId: "33333333-3333-4333-8333-333333333333",
      method: "CODE",
      code: "445566",
      capturedAt: "2026-10-25T06:00:00.000Z",
      containerIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      garmentCount: 6,
      condition: "GOOD",
    }),
    actorId: actor.id,
    identityKey: "",
    createdAt: "2026-10-25T05:00:00.000Z",
    ...overrides,
  };
}

function fakeFoundation(hooks: {
  authorized?: (run: (client: unknown) => Promise<unknown>) => Promise<unknown>;
  enqueued?: unknown[];
  queue?: QueuedMutationRecord[];
  handoverResult?: v2.HandoverResult;
  logouts?: number[];
  getActor?: () => v2.Actor | null;
}): SessionFoundation {
  const base = {
    authorized: hooks.authorized ?? (async run => run({})),
    async enqueueMutation(descriptor: unknown) {
      hooks.enqueued?.push(descriptor);
      return hooks.handoverResult ?? { legAttemptId: "x", accepted: true, attemptCount: 1, nextAttemptAllowed: false };
    },
    async listQueuedMutations() {
      return hooks.queue ?? [];
    },
    async logout() {
      hooks.logouts?.push(1);
      return { serverRevocationConfirmed: true, revocationError: null, localCredsCleared: true };
    },
    getActor: hooks.getActor ?? (() => actor),
    registerPrivateCache: () => () => undefined,
  };
  return base as unknown as SessionFoundation;
}

describe("partner feature API wrapper", () => {
  it("reads only go through foundation.authorized, never the plain client", async () => {
    const authorizedRuns: string[] = [];
    const foundation = fakeFoundation({
      authorized: async run => {
        authorizedRuns.push("authorized");
        return run({
          listJobs: async () => [{}],
          getJob: async () => ({}),
        });
      },
    });
    const api = createPartnerApi({ foundation });
    await api.listAssignedJobs();
    await api.getAssignedJob("11111111-1111-4111-8111-111111111111");
    expect(authorizedRuns).toHaveLength(2);
  });

  it("handover queues through the exact logistics.rider.handover route with preserved identity", async () => {
    const enqueued: unknown[] = [];
    const foundation = fakeFoundation({ enqueued });
    const api = createPartnerApi({ foundation });
    const body: Omit<v2.RiderHandover, "jobId"> = {
      legAttemptId: "22222222-2222-4222-8222-222222222222",
      expectedVersion: 3,
      actionId: "44444444-4444-4444-8444-444444444444",
      method: "CODE",
      code: "445566",
      capturedAt: "2026-10-25T06:00:00.000Z",
      containerIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      garmentCount: 6,
      condition: "GOOD",
    };
    await api.submitHandover("22222222-2222-4222-8222-222222222222", body);
    expect(enqueued).toHaveLength(1);
    const descriptor = enqueued[0] as { routeId: string; params: { jobId: string }; body: unknown };
    expect(descriptor.routeId).toBe("logistics.rider.handover");
    expect(descriptor.params).toEqual({ jobId: "22222222-2222-4222-8222-222222222222" });
    // The typed handover DTO is preserved verbatim: same actionId, same version.
    expect(descriptor.body).toEqual(body);
  });

  it("signing out invokes foundation.logout and leaves no local identity", async () => {
    const logouts: number[] = [];
    const foundation = fakeFoundation({
      logouts,
      getActor: () => (logouts.length === 0 ? actor : null),
    });
    const api = createPartnerApi({ foundation });
    expect(api.actor()).toEqual(actor);
    await api.signOut();
    expect(logouts).toHaveLength(1);
    expect(api.actor()).toBeNull();
  });

  it("pending handover queue items resolve jobId, actionId and version, and drop foreign routes", () => {
    const pending = pendingHandoverReceipts([queueRecord()]);
    expect(pending).toEqual([
      {
        jobId: "22222222-2222-4222-8222-222222222222",
        idempotencyKey: "8a2b1c3d-0000-4111-8111-111111111111",
        actionId: "33333333-3333-4333-8333-333333333333",
        commandedExpectedVersion: 3,
        createdAt: "2026-10-25T05:00:00.000Z",
      },
    ]);
    expect(pendingHandoverReceipts([
      queueRecord({ routeId: "orders.book" }),
      queueRecord({ bodyJson: "not json" }),
    ])).toEqual([]);
  });
});
