// Rider job access gating and list partitioning (F03).
// Pure helpers over the v2 wire types; server scoping stays authoritative.
import type { v2 } from "@laundry/contracts";

export type AssignmentState = "MINE" | "UNASSIGNED" | "OTHER_RIDER" | "REVOKED";

const TERMINAL_STATUSES: ReadonlySet<v2.RiderJob["status"]> = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "CANCEL_REQUESTED",
  "BOOKING_UNKNOWN",
]);

export function assignmentState(job: v2.RiderJob, actorId: string | null): AssignmentState {
  if (!actorId) return "UNASSIGNED";
  if (!job.assignedTo) return "UNASSIGNED";
  if (job.assignmentActive === false) return "REVOKED";
  if (!actorId || job.assignedTo !== actorId) return "OTHER_RIDER";
  return "MINE";
}

/** Customer-visible details are for the assigned, active rider only. */
export function canViewCustomerDetails(job: v2.RiderJob, actorId: string | null): boolean {
  return assignmentState(job, actorId) === "MINE";
}

/** Subject-only row for rows the viewer must not personalize: it never carries
 * customerName, address, phone or pickup notes by construction. */
export interface RestrictedJobSubject {
  readonly id: string;
  readonly leg: v2.RiderJob["leg"];
  readonly status: v2.RiderJob["status"];
  readonly window: v2.RiderJob["window"];
  readonly customerVisible: false;
}

export type ListRenderRow =
  | { visibility: "MINE"; customerVisible: true; subject: v2.RiderJob }
  | { visibility: AssignmentState; customerVisible: false; subject: RestrictedJobSubject };

export function restrictedSubject(job: v2.RiderJob): RestrictedJobSubject {
  return {
    id: job.id,
    leg: job.leg,
    status: job.status,
    window: job.window,
    customerVisible: false,
  };
}

export function listRenderRow(job: v2.RiderJob, actorId: string | null): ListRenderRow {
  const state = assignmentState(job, actorId);
  if (state === "MINE") return { visibility: "MINE", customerVisible: true, subject: job };
  return { visibility: state, customerVisible: false, subject: restrictedSubject(job) };
}

export function listRenderRows(jobs: v2.RiderJob[], actorId: string | null): ListRenderRow[] {
  return jobs.map(job => listRenderRow(job, actorId));
}

export function isAssignedTo(job: v2.RiderJob, actorId: string | null): boolean {
  return Boolean(actorId && job.assignedTo === actorId);
}

export function activeJobs(jobs: v2.RiderJob[], actorId: string | null): v2.RiderJob[] {
  return jobs.filter(
    job => isAssignedTo(job, actorId) && job.assignmentActive !== false && !TERMINAL_STATUSES.has(job.status),
  );
}

export function historyJobs(jobs: v2.RiderJob[], actorId: string | null): v2.RiderJob[] {
  return jobs.filter(
    job => isAssignedTo(job, actorId) && TERMINAL_STATUSES.has(job.status),
  );
}

export interface PrivateJobsState {
  jobs: v2.RiderJob[];
  selectedJobId: string | null;
  receipts: v2.HandoverResult[];
}

/** Local private state shape that must always reset on session end. */
export function purgePrivateJobsState(): PrivateJobsState {
  return { jobs: [], selectedJobId: null, receipts: [] };
}

export function nextActionLabel(job: v2.RiderJob): string {
  switch (job.status) {
    case "COMPLETED":
      return "Task completed";
    case "FAILED":
      return "Task failed — contact dispatch";
    case "CANCELLED":
    case "CANCEL_REQUESTED":
      return "Task cancelled";
    case "BOOKING_UNKNOWN":
      return "Provider booking outcome unknown — dispatch will reconcile";
    case "REQUESTED":
    case "BOOKED":
      return "Awaiting assignment";
    case "ASSIGNED":
      return job.leg === "PICKUP"
        ? "Travel to the customer pickup address"
        : "Collect the packed care bags at the facility";
    case "AT_PICKUP":
      return job.leg === "PICKUP"
        ? "Collect the sealed bags from the customer"
        : "Collect the care bags at the facility";
    case "IN_TRANSIT":
      return job.leg === "PICKUP"
        ? "Transport the sealed bags to the facility"
        : "Deliver the care bags to the customer";
    default:
      return "Review task details";
  }
}
