// Feature API wrapper (F03). Every read goes through the shared session
// foundation; the handover intent is queued as an approved SDK command.
// Local feature layer only — the foundation itself is not edited here.
import { v2 } from "@laundry/contracts";
import type { Actor, V2Client } from "@laundry/api-client";
import type {
  FlushReport,
  QueuedMutationRecord,
  SessionFoundation,
  SessionSnapshot,
} from "@laundry/app-foundation";
import type { HandoverMutation } from "../jobs/handover";

export interface PartnerApiOptions {
  foundation: SessionFoundation;
  /** Injectable for tests; defaults to the foundation-provisioned plain client. */
  plainClient?: V2Client;
  getActorRef?: () => Actor | null;
}

export interface PartnerApi {
  initialize(): Promise<SessionSnapshot>;
  snapshot(): SessionSnapshot;
  actor(): Actor | null;
  listAssignedJobs(): Promise<v2.RiderJob[]>;
  getAssignedJob(jobId: string): Promise<v2.RiderJob>;
  requestChallenge(phone: string): Promise<v2.OtpChallenge>;
  verifyAndAdoptSession(args: {
    challengeId: string;
    code: string;
    mfaCode?: string;
    idempotencyKey?: string;
  }): Promise<SessionSnapshot>;
  submitHandover(
    jobId: string,
    body: Omit<v2.RiderHandover, "jobId">,
  ): Promise<v2.HandoverResult>;
  queuedMutations(): Promise<QueuedMutationRecord[]>;
  flushQueue(): Promise<FlushReport>;
  signOut(): ReturnType<SessionFoundation["logout"]>;
}

export function createPartnerApi(options: PartnerApiOptions): PartnerApi {
  const foundation = options.foundation;
  function plain(): V2Client {
    return options.plainClient ?? foundation.getPlainV2Client();
  }
  function actor(): Actor | null {
    return options.getActorRef ? options.getActorRef() : foundation.getActor();
  }
  function authorized<T>(run: (client: V2Client) => Promise<T>): Promise<T> {
    return foundation.authorized(run);
  }
  return {
    initialize: () => foundation.initialize(),
    snapshot: () => foundation.snapshot(),
    actor,
    listAssignedJobs: () => authorized(client => client.listJobs()),
    getAssignedJob: jobId => authorized(client => client.getJob(jobId)),
    requestChallenge: phone => plain().requestOtp(phone),
    verifyAndAdoptSession: async args => {
      // Public OTP verification happens on the plain client; a session only
      // exists afterward via adoptAuthenticatedSession.
      const session = await plain().verifyOtp(args.challengeId, args.code, {
        mfaCode: args.mfaCode,
        idempotencyKey: args.idempotencyKey,
      });
      await foundation.adoptAuthenticatedSession(session);
      return foundation.snapshot();
    },
    submitHandover: (jobId, body) =>
      foundation.enqueueMutation<"logistics.rider.handover">({
        routeId: "logistics.rider.handover",
        params: { jobId },
        body,
      } satisfies HandoverMutation),
    queuedMutations: () => foundation.listQueuedMutations(),
    flushQueue: () => foundation.flushQueuedMutations(),
    signOut: () => foundation.logout(),
  };
}

export interface PendingHandoverReceipt {
  jobId: string;
  actionId: string;
  idempotencyKey: string;
  commandedExpectedVersion: number;
  createdAt: string;
}

function readQueuedBody(raw: string | null): Partial<v2.RiderHandover> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return typeof value === "object" && value !== null ? value : null;
  } catch {
    return null;
  }
}

/** Handover-route records only; foreign routes and unsafe bodies are dropped. */
export function pendingHandoverReceipts(records: QueuedMutationRecord[]): PendingHandoverReceipt[] {
  const out: PendingHandoverReceipt[] = [];
  for (const record of records) {
    if (record.routeId !== "logistics.rider.handover") continue;
    const jobId = record.params.jobId;
    const body = readQueuedBody(record.bodyJson);
    const actionId = body?.actionId;
    const expectedVersion = body?.expectedVersion;
    if (
      typeof jobId !== "string" ||
      typeof actionId !== "string" ||
      typeof expectedVersion !== "number"
    ) {
      continue;
    }
    out.push({
      jobId,
      actionId,
      idempotencyKey: record.idempotencyKey,
      commandedExpectedVersion: expectedVersion,
      createdAt: record.createdAt,
    });
  }
  return out;
}
