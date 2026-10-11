import type { Actor, DeliveryJob, ErrorEnvelope, Order } from "./types.js";

function envelope(
  code: ErrorEnvelope["code"],
  message: string,
  traceId = "trace-test",
  retryable = false
): ErrorEnvelope {
  return { code, message, traceId, retryable };
}

/** Owner + role authorization for order reads. Unknown resource IDs read as NOT_FOUND for customers. */
export function authorizeOrderRead(
  actor: Actor,
  order: Order | null
): { ok: true } | { ok: false; error: ErrorEnvelope } {
  if (!actor || !actor.id) return { ok: false, error: envelope("UNAUTHENTICATED", "Missing bearer token") };
  if (order === null) return { ok: false, error: envelope("NOT_FOUND", "Order not found") };
  if (actor.role === "admin" || actor.role === "system" || actor.role === "operator") return { ok: true };
  if (actor.role === "customer") {
    if (order.customerId !== actor.id) return { ok: false, error: envelope("NOT_FOUND", "Order not found") };
    return { ok: true };
  }
  if (actor.role === "facility") {
    if (!actor.scopes.includes(`facility:${order.facilityId ?? ""}`))
      return { ok: false, error: envelope("FORBIDDEN", "Facility scope does not include this order") };
    return { ok: true };
  }
  if (actor.role === "rider") {
    const assigned = order.deliveries.some((d) => d.assignedTo === actor.id);
    if (!assigned) return { ok: false, error: envelope("FORBIDDEN", "Rider is not assigned to this order") };
    return { ok: true };
  }
  return { ok: false, error: envelope("FORBIDDEN", "Role cannot read orders") };
}

/** Rider handover guard: revoked assignments (assignedTo changed) cannot complete the job. */
export function authorizeHandover(
  actor: Actor,
  job: DeliveryJob,
  revokedAssignees: Set<string> = new Set()
): { ok: true } | { ok: false; error: ErrorEnvelope } {
  if (actor.role !== "rider" && actor.role !== "operator")
    return { ok: false, error: envelope("FORBIDDEN", "Only the assigned rider or an operator may hand over") };
  if (actor.role === "rider") {
    if (job.assignedTo !== actor.id || revokedAssignees.has(actor.id))
      return { ok: false, error: envelope("FORBIDDEN", "Assignment was revoked; write access removed") };
  }
  return { ok: true };
}

/** Optimistic-concurrency check. Stale versions return the current permitted state. */
export function checkVersion(
  currentVersion: number,
  expectedVersion: number | undefined
): { ok: true } | { ok: false; error: ErrorEnvelope; currentVersion: number } {
  if (expectedVersion === undefined) return { ok: true };
  if (expectedVersion !== currentVersion)
    return {
      ok: false,
      error: envelope("VERSION_CONFLICT", `Expected version ${expectedVersion} but current is ${currentVersion}`),
      currentVersion,
    };
  return { ok: true };
}

/** In-memory idempotency ledger. Same actor+key+payload replays the
 * original result; same key with a different payload conflicts. Payload
 * hashing is key-order stable so retries that rebuild the same object
 * with a different key order still replay instead of executing twice. */
export class IdempotencyStore<T> {
  private seen = new Map<string, { payloadHash: string; result: T; executions: number }>();
  readonly executions = new Map<string, number>();

  private hash(payload: unknown): string {
    return stableStringify(payload);
  }

  run(key: string, payload: unknown, fn: () => T): { result: T; replayed: boolean } {
    const existing = this.seen.get(key);
    const h = this.hash(payload);
    if (existing) {
      if (existing.payloadHash !== h)
        throw Object.assign(new Error("Idempotency key reused with different payload"), {
          code: "IDEMPOTENCY_CONFLICT" as const,
        });
      return { result: existing.result, replayed: true };
    }
    const result = fn();
    this.seen.set(key, { payloadHash: h, result, executions: 1 });
    this.executions.set(key, (this.executions.get(key) ?? 0) + 1);
    return { result, replayed: false };
  }

  executionCount(key: string): number {
    return this.executions.get(key) ?? 0;
  }
}

/** Key-order stable JSON encoding for idempotency payload hashing. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
