function envelope(code, message, traceId = "trace-test", retryable = false) {
    return { code, message, traceId, retryable };
}
/** Owner + role authorization for order reads. Unknown resource IDs read as NOT_FOUND for customers. */
export function authorizeOrderRead(actor, order) {
    if (!actor || !actor.id)
        return { ok: false, error: envelope("UNAUTHENTICATED", "Missing bearer token") };
    if (order === null)
        return { ok: false, error: envelope("NOT_FOUND", "Order not found") };
    if (actor.role === "admin" || actor.role === "system" || actor.role === "operator")
        return { ok: true };
    if (actor.role === "customer") {
        if (order.customerId !== actor.id)
            return { ok: false, error: envelope("NOT_FOUND", "Order not found") };
        return { ok: true };
    }
    if (actor.role === "facility") {
        if (!actor.scopes.includes(`facility:${order.facilityId ?? ""}`))
            return { ok: false, error: envelope("FORBIDDEN", "Facility scope does not include this order") };
        return { ok: true };
    }
    if (actor.role === "rider") {
        const assigned = order.deliveries.some((d) => d.assignedTo === actor.id);
        if (!assigned)
            return { ok: false, error: envelope("FORBIDDEN", "Rider is not assigned to this order") };
        return { ok: true };
    }
    return { ok: false, error: envelope("FORBIDDEN", "Role cannot read orders") };
}
/** Rider handover guard: revoked assignments (assignedTo changed) cannot complete the job. */
export function authorizeHandover(actor, job, revokedAssignees = new Set()) {
    if (actor.role !== "rider" && actor.role !== "operator")
        return { ok: false, error: envelope("FORBIDDEN", "Only the assigned rider or an operator may hand over") };
    if (actor.role === "rider") {
        if (job.assignedTo !== actor.id || revokedAssignees.has(actor.id))
            return { ok: false, error: envelope("FORBIDDEN", "Assignment was revoked; write access removed") };
    }
    return { ok: true };
}
/** Optimistic-concurrency check. Stale versions return the current permitted state. */
export function checkVersion(currentVersion, expectedVersion) {
    if (expectedVersion === undefined)
        return { ok: true };
    if (expectedVersion !== currentVersion)
        return {
            ok: false,
            error: envelope("VERSION_CONFLICT", `Expected version ${expectedVersion} but current is ${currentVersion}`),
            currentVersion,
        };
    return { ok: true };
}
/** In-memory idempotency ledger. Same actor+key+payload replays the
 * original result; same key with a different payload conflicts. */
export class IdempotencyStore {
    seen = new Map();
    executions = new Map();
    hash(payload) {
        return JSON.stringify(payload);
    }
    run(key, payload, fn) {
        const existing = this.seen.get(key);
        const h = this.hash(payload);
        if (existing) {
            if (existing.payloadHash !== h)
                throw Object.assign(new Error("Idempotency key reused with different payload"), {
                    code: "IDEMPOTENCY_CONFLICT",
                });
            return { result: existing.result, replayed: true };
        }
        const result = fn();
        this.seen.set(key, { payloadHash: h, result, executions: 1 });
        this.executions.set(key, (this.executions.get(key) ?? 0) + 1);
        return { result, replayed: false };
    }
    executionCount(key) {
        return this.executions.get(key) ?? 0;
    }
}
//# sourceMappingURL=guards.js.map