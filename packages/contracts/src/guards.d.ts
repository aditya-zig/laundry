import type { Actor, DeliveryJob, ErrorEnvelope, Order } from "./types.js";
/** Owner + role authorization for order reads. Unknown resource IDs read as NOT_FOUND for customers. */
export declare function authorizeOrderRead(actor: Actor, order: Order | null): {
    ok: true;
} | {
    ok: false;
    error: ErrorEnvelope;
};
/** Rider handover guard: revoked assignments (assignedTo changed) cannot complete the job. */
export declare function authorizeHandover(actor: Actor, job: DeliveryJob, revokedAssignees?: Set<string>): {
    ok: true;
} | {
    ok: false;
    error: ErrorEnvelope;
};
/** Optimistic-concurrency check. Stale versions return the current permitted state. */
export declare function checkVersion(currentVersion: number, expectedVersion: number | undefined): {
    ok: true;
} | {
    ok: false;
    error: ErrorEnvelope;
    currentVersion: number;
};
/** In-memory idempotency ledger. Same actor+key+payload replays the
 * original result; same key with a different payload conflicts. */
export declare class IdempotencyStore<T> {
    private seen;
    readonly executions: Map<string, number>;
    private hash;
    run(key: string, payload: unknown, fn: () => T): {
        result: T;
        replayed: boolean;
    };
    executionCount(key: string): number;
}
//# sourceMappingURL=guards.d.ts.map