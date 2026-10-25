// F04 staff action controller. The one server-permitted mutation wired in this
// bounded slice is the care advance (start care to IN_CARE, or progress to
// QUALITY_CHECK) because the current Order DTO fully determines the command.
// The command key and frozen input survive unknown outcomes so a retry replays
// the identical server command; a definitive rejection retires the key.
import { UnknownOutcomeError, V2ApiError, type V2Client } from "@laundry/api-client";
import type { v2 } from "@laundry/contracts";
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
        label: "Mark ready for return",
        blockedReason:
          "Recording a passed quality check is a separate intake tool, not wired in this slice.",
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
    case "PICKUP_PENDING":
      return {
        label: "Record facility intake",
        blockedReason:
          "Facility intake is recorded through the intake tool, which is not wired in this slice.",
      };
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

export type CareAttempt =
  | { phase: "idle" }
  | { phase: "sending"; commandKey: string; input: CareCommandInput }
  | {
      /** Unknown outcome: retained for retry with the SAME key and input. */
      phase: "unknown";
      commandKey: string;
      input: CareCommandInput;
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

  /** Retry the retained attempt with the identical key and input. */
  async retry(): Promise<v2.Order | null> {
    const current = this.state;
    if (current.phase !== "unknown") return null;
    return this.send(current.input, current.commandKey);
  }

  private async send(
    input: CareCommandInput,
    idempotencyKey: string,
  ): Promise<v2.Order | null> {
    const seq = ++this.seq;
    this.set({ phase: "sending", commandKey: idempotencyKey, input });
    try {
      const updated = await this.deps.runAuthorized((client: V2Client) =>
        client.advanceCare(input.orderId, input.target, input.expectedVersion, {
          idempotencyKey,
        }),
      );
      if (seq !== this.seq) return null;
      this.set({ phase: "idle" });
      return updated;
    } catch (error) {
      if (seq !== this.seq) return null;
      const described = describeError(error);
      if (described.unknownOutcome) {
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
