// F04 selected-order detail controller. Every read is authorized through the
// session foundation so access tokens refresh around the call; facts come only
// from the order DTO the server returned for this staff session.
import type { V2Client } from "@laundry/api-client";
import type { v2 } from "@laundry/contracts";
import { describeError } from "./errors";

export interface DetailError {
  code: string;
  message: string;
  traceId: string | undefined;
}

export type DetailState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; orderId: string; error: DetailError; retryable: boolean }
  | {
      kind: "ready";
      orderId: string;
      order: v2.Order;
      loadedAt: string;
      stale: boolean;
      refreshError?: DetailError;
    };

export interface DetailDeps {
  runAuthorized: <T>(run: (client: V2Client) => Promise<T>) => Promise<T>;
  clock?: () => Date;
  staleAfterMs?: number;
}

const DEFAULT_STALE_AFTER_MS = 120_000;

export class OrderDetailController {
  private state: DetailState = { kind: "idle" };
  private readonly listeners = new Set<() => void>();
  private readonly clock: () => Date;
  private readonly staleAfterMs: number;
  private seq = 0;

  constructor(private readonly deps: DetailDeps) {
    this.clock = deps.clock ?? (() => new Date());
    this.staleAfterMs = deps.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  }

  getState(): DetailState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(state: DetailState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }

  clear(): void {
    this.seq++;
    this.set({ kind: "idle" });
  }

  evaluateStaleness(): void {
    const current = this.state;
    if (current.kind !== "ready" || current.refreshError) return;
    if (this.clock().getTime() - Date.parse(current.loadedAt) > this.staleAfterMs) {
      this.set({ ...current, stale: true });
    }
  }

  async select(orderId: string): Promise<void> {
    const seq = ++this.seq;
    this.set({ kind: "loading" });
    try {
      const order = await this.deps.runAuthorized((client) => client.getOrder(orderId));
      if (seq !== this.seq) return;
      this.set({
        kind: "ready",
        orderId: order.id,
        order,
        loadedAt: this.clock().toISOString(),
        stale: false,
      });
    } catch (error) {
      if (seq !== this.seq) return;
      const described = describeError(error);
      this.set({
        kind: "error",
        orderId,
        error: { code: described.code, message: described.message, traceId: described.traceId },
        retryable: described.retryable,
      });
    }
  }

  /** Re-read the selected order, keeping the old facts on a failed refresh. */
  async refresh(): Promise<void> {
    const seq = ++this.seq;
    const current = this.state;
    const orderId = current.kind === "ready"
      ? current.orderId
      : current.kind === "error"
        ? current.orderId
        : null;
    if (orderId === null) return;
    try {
      const order = await this.deps.runAuthorized((client) => client.getOrder(orderId));
      if (seq !== this.seq) return;
      this.set({
        kind: "ready",
        orderId: order.id,
        order,
        loadedAt: this.clock().toISOString(),
        stale: false,
        refreshError: undefined,
      });
    } catch (error) {
      if (seq !== this.seq) return;
      const described = describeError(error);
      if (current.kind === "ready" && !["FORBIDDEN", "UNAUTHENTICATED"].includes(described.code)) {
        this.set({
          ...current,
          stale: true,
          refreshError: { code: described.code, message: described.message, traceId: described.traceId },
        });
        return;
      }
      this.set({
        kind: "error",
        orderId,
        error: { code: described.code, message: described.message, traceId: described.traceId },
        retryable: described.retryable,
      });
    }
  }

  /** Adopt a server-returned update, e.g. the confirmed response of an
   * accepted care command. Never used for client-guessed state. */
  acceptUpdate(order: v2.Order): void {
    const current = this.state;
    if (current.kind === "ready" && current.orderId !== order.id) return;
    this.set({
      kind: "ready",
      orderId: order.id,
      order,
      loadedAt: this.clock().toISOString(),
      stale: false,
      refreshError: undefined,
    });
  }
}

export function createOrderDetailController(deps: DetailDeps): OrderDetailController {
  return new OrderDetailController(deps);
}
