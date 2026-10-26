// Versioned staff care, measured intake and quality-check commands.
// The command key and frozen input survive unknown outcomes so a retry replays
// the identical server command; a definitive rejection retires the key.
import { UnknownOutcomeError, V2ApiError, type V2Client } from "@laundry/api-client";
import { v2 } from "@laundry/contracts";
import { isMutationOutcomePending } from "@laundry/app-foundation";
import { describeError } from "./errors";

export type StaffCareTarget = v2.CareUpdate["target"];

export interface StaffCareAction {
  /** Undefined plus a blockedReason means the server would reject the command;
   * the UI renders why and sends nothing. */
  target?: StaffCareTarget;
  label: string;
  blockedReason?: string;
}

const STAFF_CARE_ROLES = new Set<v2.Actor["role"]>(["FACILITY", "OPERATOR", "ADMIN"]);

/** Presentation-only permission map from the contract (route roles and order
 * states). The server remains authoritative; this only avoids known-rejected
 * buttons. */
export function nextStaffCareAction(order: v2.Order, role: v2.Actor["role"]): StaffCareAction {
  if (!STAFF_CARE_ROLES.has(role)) {
    return {
      label: "Start care",
      blockedReason: "Care tools are limited to facility and operator staff.",
    };
  }
  switch (order.status) {
    case "AT_FACILITY": {
      const adjustment = order.adjustment;
      if (adjustment && adjustment.state === "PROPOSED") {
        return {
          label: "Start care",
          blockedReason:
            "The customer must accept the intake adjustment before care starts.",
        };
      }
      return { label: "Start care", target: "IN_CARE" };
    }
    case "AWAITING_ADJUSTMENT":
      return {
        label: "Start care",
        blockedReason:
          "The customer must accept or decline the proposed intake adjustment before care resumes.",
      };
    case "IN_CARE":
      return { label: "Send to quality check", target: "QUALITY_CHECK" };
    case "QUALITY_CHECK":
      return {
        label: "Record quality check",
        blockedReason: "Record the actual inspection result and sealed bags below.",
      };
    case "READY_FOR_RETURN":
      return {
        label: "Dispatch return",
        blockedReason: "Return dispatch is a logistics tool, not wired in this slice.",
      };
    case "RETURNING":
      return {
        label: "Complete return",
        blockedReason:
          "Return custody acceptance and payment settlement gate the final handover; custody tools are not wired in this slice.",
      };
    case "CONFIRMED":
      return { label: "Await pickup", blockedReason: "Intake requires the pickup workflow to start first." };
    case "PICKUP_PENDING":
      return { label: "Record facility intake", blockedReason: "Enter actual measured quantities and received bags below." };
    case "ON_HOLD":
      return {
        label: "Resume care",
        blockedReason:
          "Resuming a held order uses the exception-resolution tool, not wired in this slice.",
      };
    case "CANCEL_REQUESTED":
    case "RESOLUTION_REQUIRED":
      return {
        label: "Resolve exception",
        blockedReason: "Exception resolution is a controlled tool, not wired in this slice.",
      };
    default:
      return {
        label: "No action",
        blockedReason: "A terminal order has no further staff actions.",
      };
  }
}

export interface CareCommandInput {
  readonly orderId: string;
  readonly target: StaffCareTarget;
  readonly expectedVersion: number;
}

export type FacilityRecordInput =
  | { kind: "INTAKE"; orderId: string; record: v2.IntakeRecord }
  | { kind: "QUALITY_CHECK"; orderId: string; record: v2.QualityCheck };
export type StaffCommandInput = CareCommandInput | FacilityRecordInput;

export function facilityRecordMode(order: v2.Order, role: v2.Actor["role"]): "INTAKE" | "QUALITY_CHECK" | undefined {
  if (!STAFF_CARE_ROLES.has(role)) return undefined;
  if (order.status === "PICKUP_PENDING") return "INTAKE";
  if (order.status === "QUALITY_CHECK") return "QUALITY_CHECK";
  return undefined;
}

function freezeFacts<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeFacts(child);
    Object.freeze(value);
  }
  return value;
}

export type CareAttempt =
  | { phase: "idle" }
  | { phase: "sending"; commandKey: string; input: StaffCommandInput }
  | {
      /** Unknown outcome: retained for retry with the SAME key and input. */
      phase: "unknown";
      commandKey: string;
      input: StaffCommandInput;
      at: string;
      detail: string;
    }
  | {
      phase: "rejected";
      code: string;
      message: string;
      traceId: string | undefined;
      currentVersion: number | undefined;
    };

export interface CareDeps {
  runAuthorized: <T>(run: (client: V2Client) => Promise<T>) => Promise<T>;
  generateKey: () => string;
  clock?: () => Date;
}

export class CareActionController {
  private state: CareAttempt = { phase: "idle" };
  private readonly listeners = new Set<() => void>();
  private readonly clock: () => Date;
  private seq = 0;

  constructor(private readonly deps: CareDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  getState(): CareAttempt {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(state: CareAttempt): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }

  clear(): void {
    this.seq++;
    this.set({ phase: "idle" });
  }

  /** Send the care command permitted by presentation rules. Returns the
   * server-confirmed order on success, or null when nothing was sent or the
   * outcome is not confirmed (unknown/rejected) — never a fake success. */
  async begin(order: v2.Order, role: v2.Actor["role"]): Promise<v2.Order | null> {
    if (this.state.phase === "sending" || this.state.phase === "unknown") return null;
    const action = nextStaffCareAction(order, role);
    if (action.target === undefined || action.blockedReason !== undefined) return null;
    const input: CareCommandInput = Object.freeze({
      orderId: order.id,
      target: action.target,
      expectedVersion: order.version,
    });
    return this.send(input, this.deps.generateKey());
  }

  async recordIntake(order: v2.Order, role: v2.Actor["role"], facts: Omit<v2.IntakeRecord, "expectedVersion">): Promise<v2.Order | null> {
    return this.record(order, role, "INTAKE", facts);
  }

  async recordQualityCheck(order: v2.Order, role: v2.Actor["role"], facts: Omit<v2.QualityCheck, "expectedVersion">): Promise<v2.Order | null> {
    return this.record(order, role, "QUALITY_CHECK", facts);
  }

  private async record(order: v2.Order, role: v2.Actor["role"], kind: FacilityRecordInput["kind"], facts: Omit<v2.IntakeRecord, "expectedVersion"> | Omit<v2.QualityCheck, "expectedVersion">): Promise<v2.Order | null> {
    if (this.state.phase === "sending" || this.state.phase === "unknown" || facilityRecordMode(order, role) !== kind) return null;
    // A refresh must not silently upgrade facts confirmed on an older form.
    if ("expectedVersion" in facts && facts.expectedVersion !== order.version) {
      this.set({ phase: "rejected", code: "VERSION_CONFLICT", message: "The order changed. Refresh and confirm the physical facts again.", traceId: undefined, currentVersion: order.version });
      return null;
    }
    const parsed = kind === "INTAKE"
      ? v2.intakeRecordSchema.safeParse({ ...facts, expectedVersion: order.version })
      : v2.qualityCheckSchema.safeParse({ ...facts, expectedVersion: order.version });
    if (!parsed.success) {
      this.set({ phase: "rejected", code: "INVALID_INPUT", message: parsed.error.issues.map(issue => issue.message).join(" "), traceId: undefined, currentVersion: undefined });
      return null;
    }
    // Schema parsing clones nested measurements/bags. Freeze the clone so neither
    // edits nor a caller inspecting state can alter an ambiguous command's retry.
    const input: FacilityRecordInput = kind === "INTAKE"
      ? { kind, orderId: order.id, record: v2.intakeRecordSchema.parse(parsed.data) }
      : { kind, orderId: order.id, record: v2.qualityCheckSchema.parse(parsed.data) };
    return this.send(freezeFacts(input), this.deps.generateKey());
  }

  /** Retry the retained attempt with the identical key and input. */
  async retry(): Promise<v2.Order | null> {
    const current = this.state;
    if (current.phase !== "unknown") return null;
    return this.send(current.input, current.commandKey);
  }

  private async send(
    input: StaffCommandInput,
    idempotencyKey: string,
  ): Promise<v2.Order | null> {
    const seq = ++this.seq;
    this.set({ phase: "sending", commandKey: idempotencyKey, input });
    try {
      const updated = await this.deps.runAuthorized((client: V2Client) =>
        "kind" in input
          ? input.kind === "INTAKE"
            ? client.recordIntake(input.orderId, input.record, input.record.expectedVersion, { idempotencyKey })
            : client.recordQualityCheck(input.orderId, input.record, input.record.expectedVersion, { idempotencyKey })
          : client.advanceCare(input.orderId, input.target, input.expectedVersion, { idempotencyKey }),
      );
      if (seq !== this.seq) return null;
      this.set({ phase: "idle" });
      return updated;
    } catch (error) {
      if (seq !== this.seq) return null;
      const described = describeError(error);
      if (isMutationOutcomePending(error)) {
        // Retain BOTH the key and the exact input; the UI explains that the
        // server outcome is unknown until this exact command is replayed.
        this.set({
          phase: "unknown",
          commandKey: idempotencyKey,
          input,
          at: this.clock().toISOString(),
          detail: error instanceof UnknownOutcomeError ? error.message : described.message,
        });
        return null;
      }
      // A server denial (e.g. VERSION_CONFLICT with currentVersion) is definite:
      // the key is retired so a corrected retry gets a fresh command identity.
      this.set({
        phase: "rejected",
        code: error instanceof V2ApiError ? error.code : described.code,
        message: described.message,
        traceId: described.traceId,
        currentVersion: described.currentVersion,
      });
      return null;
    }
  }
}

export function createCareActionController(deps: CareDeps): CareActionController {
  return new CareActionController(deps);
}
