// F04 facility queue controller: server-scoped reads through the authorized
// foundation surface. The client never chooses facility scope or role; it only
// renders what the ops queue route returned and says so when data ages out.
import type { V2Client } from "@laundry/api-client";
import type { v2 } from "@laundry/contracts";
import { describeError } from "./errors";

export interface QueueError {
  code: string;
  message: string;
  traceId: string | undefined;
}

export type QueueState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; error: QueueError; retryable: boolean }
  | {
      kind: "ready";
      items: v2.Order[];
      pageInfo: v2.PageInfo;
      /** Instant the successful server read landed. */
      loadedAt: string;
      /** Instant of the most recent successful read, kept across failed refreshes. */
      lastGoodAt: string;
      stale: boolean;
      refreshError?: QueueError;
    };

export interface QueueDeps {
  runAuthorized: <T>(run: (client: V2Client) => Promise<T>) => Promise<T>;
  clock?: () => Date;
  /** A loaded queue older than this shows a quiet stale notice. */
  staleAfterMs?: number;
  pageSize?: number;
}

const DEFAULT_STALE_AFTER_MS = 120_000;
const DEFAULT_PAGE_SIZE = 50;

/** Contract status order for deterministic presentation: exception states
 * first so nothing blocked-from-progress hides behind newer resting rows. */
const STATUS_RANK: Record<v2.Order["status"], number> = {
  AWAITING_ADJUSTMENT: 0,
  RESOLUTION_REQUIRED: 1,
  CANCEL_REQUESTED: 2,
  ON_HOLD: 3,
  AT_FACILITY: 4,
  IN_CARE: 5,
  QUALITY_CHECK: 6,
  PICKUP_PENDING: 7,
  CONFIRMED: 8,
  READY_FOR_RETURN: 9,
  RETURNING: 10,
  DELIVERED: 11,
  CANCELLED: 12,
};

export function prioritiseQueue(items: readonly v2.Order[]): v2.Order[] {
  return [...items].sort((a, b) => {
    const rank = (STATUS_RANK[a.status] ?? 20) - (STATUS_RANK[b.status] ?? 20);
    if (rank !== 0) return rank;
    const time = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (time !== 0) return time;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export class QueueController {
  private state: QueueState = { kind: "idle" };
  private readonly listeners = new Set<() => void>();
  private readonly clock: () => Date;
  private readonly staleAfterMs: number;
  private readonly pageSize: number;
  private seq = 0;

  constructor(private readonly deps: QueueDeps) {
    this.clock = deps.clock ?? (() => new Date());
    this.staleAfterMs = deps.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  }

  getState(): QueueState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(state: QueueState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }

  clear(): void {
    this.seq++;
    this.set({ kind: "idle" });
  }

  /** Timers call this; it never overrides a failed refresh's stale notice. */
  evaluateStaleness(): void {
    const current = this.state;
    if (current.kind !== "ready" || current.refreshError) return;
    if (this.clock().getTime() - Date.parse(current.loadedAt) > this.staleAfterMs) {
      this.set({ ...current, stale: true });
    }
  }

  async refresh(): Promise<void> {
    const seq = ++this.seq;
    const previous = this.state;
    if (previous.kind !== "ready") this.set({ kind: "loading" });
    try {
      const page = await this.deps.runAuthorized((client) =>
        client.listOpsOrders({ limit: this.pageSize }),
      );
      if (seq !== this.seq) return;
      const loadedAt = this.clock().toISOString();
      this.set({
        kind: "ready",
        items: prioritiseQueue(page.items),
        pageInfo: page.pageInfo,
        loadedAt,
        lastGoodAt: loadedAt,
        stale: false,
      });
    } catch (error) {
      if (seq !== this.seq) return;
      const described = describeError(error);
      if (previous.kind === "ready" && !["FORBIDDEN", "UNAUTHENTICATED"].includes(described.code)) {
        // Keep the old rows visible; the freshness line says how old they are.
        this.set({
          ...previous,
          stale: true,
          refreshError: {
            code: described.code,
            message: described.message,
            traceId: described.traceId,
          },
        });
        return;
      }
      this.set({
        kind: "error",
        error: { code: described.code, message: described.message, traceId: described.traceId },
        retryable: described.retryable,
      });
    }
  }

  async loadMore(): Promise<void> {
    const current = this.state;
    if (current.kind !== "ready" || !current.pageInfo.hasMore || !current.pageInfo.nextCursor) return;
    const seq = ++this.seq;
    try {
      const page = await this.deps.runAuthorized((client) =>
        client.listOpsOrders({ limit: this.pageSize, cursor: current.pageInfo.nextCursor }),
      );
      if (seq !== this.seq) return;
      const loadedAt = this.clock().toISOString();
      this.set({
        ...current,
        items: prioritiseQueue([...current.items, ...page.items]),
        pageInfo: page.pageInfo,
        loadedAt,
        lastGoodAt: loadedAt,
        stale: false,
        refreshError: undefined,
      });
    } catch {
      if (seq !== this.seq) return;
      await this.refresh();
    }
  }
}

export function createQueueController(deps: QueueDeps): QueueController {
  return new QueueController(deps);
}
