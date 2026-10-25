// Focused behavior tests for rider job access gating and list partitioning.
// Scenarios: unassigned/other/revoked tasks reveal no customer data; active
// versus history partitioning; private load state purges on logout.
import { describe, expect, it } from "vitest";
import { v2 } from "@laundry/contracts";
import {
  assignmentState,
  canViewCustomerDetails,
  historyJobs,
  activeJobs,
  listRenderRows,
  purgePrivateJobsState,
} from "./access";

const myId = "11111111-1111-4111-8111-111111111111";
const otherId = "99999999-9999-4999-8999-999999999999";

export function riderJob(overrides: Partial<v2.RiderJob> = {}): v2.RiderJob {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    orderId: "33333333-3333-4333-8333-333333333333",
    leg: "PICKUP",
    status: "ASSIGNED",
    version: 1,
    customerName: "Rohan Verma",
    addressLine1: "42 Indiranagar 100ft Road",
    addressCity: "Bengaluru",
    addressPostalCode: "560001",
    window: {
      start: "2026-10-26T09:00:00.000Z",
      end: "2026-10-26T11:00:00.000Z",
      timezone: "Asia/Kolkata",
    },
    containerIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    containerCount: 1,
    contactPhone: "+919876543210",
    pickupNotes: "Ring the bell twice",
    assignedTo: myId,
    assignmentActive: true,
    ...overrides,
  };
}

describe("customer data gating", () => {
  it("an unassigned task reveals no customer data", () => {
    const job = riderJob({ assignedTo: undefined });
    expect(assignmentState(job, myId)).toBe("UNASSIGNED");
    expect(canViewCustomerDetails(job, myId)).toBe(false);
    const rows = listRenderRows([job], myId);
    const row = rows[0];
    expect(row).toMatchObject({ visibility: "UNASSIGNED", customerVisible: false });
    expect("customerName" in row.subject).toBe(false);
    expect("addressLine1" in row.subject).toBe(false);
    expect("contactPhone" in row.subject).toBe(false);
    expect("pickupNotes" in row.subject).toBe(false);
  });

  it("a task assigned to another rider reveals no customer data", () => {
    const job = riderJob({ assignedTo: otherId });
    expect(assignmentState(job, myId)).toBe("OTHER_RIDER");
    expect(canViewCustomerDetails(job, myId)).toBe(false);
    expect(listRenderRows([job], myId)[0].customerVisible).toBe(false);
  });

  it("a revoked assignment reveals no customer data even for the previous rider", () => {
    const job = riderJob({ assignmentActive: false });
    expect(assignmentState(job, myId)).toBe("REVOKED");
    expect(canViewCustomerDetails(job, myId)).toBe(false);
    expect("customerName" in listRenderRows([job], myId)[0].subject).toBe(false);
  });

  it("an assigned, active task is viewable by that rider only", () => {
    const job = riderJob();
    expect(assignmentState(job, myId)).toBe("MINE");
    expect(canViewCustomerDetails(job, myId)).toBe(true);
    expect(canViewCustomerDetails(job, otherId)).toBe(false);
    const row = listRenderRows([job], myId)[0];
    expect(row.customerVisible).toBe(true);
    expect(row.subject).toEqual(job);
  });

  it("without an actor (logged out) no task exposes customer data", () => {
    const job = riderJob();
    expect(assignmentState(job, null)).toBe("UNASSIGNED");
    expect(canViewCustomerDetails(job, null)).toBe(false);
  });
});

describe("active and history partitioning", () => {
  it("terminal tasks move to history, active tasks stay in the queue", () => {
    const completed = riderJob({ id: "44444444-4444-4444-8444-444444444444", status: "COMPLETED" });
    const failed = riderJob({ id: "55555555-5555-4555-8555-555555555555", status: "FAILED" });
    const transit = riderJob({ id: "66666666-6666-4666-8666-666666666666", status: "IN_TRANSIT" });
    expect(activeJobs([completed, failed, transit], myId).map(j => j.status)).toEqual(["IN_TRANSIT"]);
    expect(historyJobs([completed, failed, transit], myId).map(j => j.status)).toEqual([
      "COMPLETED",
      "FAILED",
    ]);
  });

  it("terminal tasks of other riders are not revealed as private history either", () => {
    const otherCompleted = riderJob({
      status: "COMPLETED",
      assignedTo: otherId,
    });
    expect(historyJobs([otherCompleted], myId)).toEqual([]);
  });
});

describe("stale private loads cannot cross logout", () => {
  it("purging returns empty private state", () => {
    const purged = purgePrivateJobsState();
    expect(purged).toEqual({ jobs: [], selectedJobId: null, receipts: [] });
  });
});
