// F04 operations workspace page. Coordinator composition mounts this export.
// The bounded slice wires: OTP + optional TOTP staff sign-in (public identity
// endpoints through the session foundation), the facility-scoped ops order
// queue, selected-order detail, and exactly one server-permitted mutation
// (care advance) with command-key retention across unknown outcomes.
//
// Not included in this slice and never faked: intake recording, quality-check
// recording, hold/exception resolution, dispatch, reconciliation, refunds,
// conversations, dead-letter tooling. Their panels explain that they are not
// wired rather than presenting dead controls.
import { useEffect, useState } from "react";
import type { SessionFoundation } from "@laundry/app-foundation";
import type { V2Client } from "@laundry/api-client";
import type { v2 } from "@laundry/contracts";
import { getFoundation, getV2Client } from "../foundation/session";
import { SignInController, type SignInState } from "../features/signIn";
import { QueueController, type QueueState } from "../features/opsQueue";
import {
  OrderDetailController,
  type DetailState,
} from "../features/orderDetail";
import {
  CareActionController,
  nextStaffCareAction,
  type CareAttempt,
  type StaffCareAction,
} from "../features/careActions";
import { useSyncedState } from "../features/useSyncedState";
import type { PresentableError } from "../features/errors";
import {
  formatClock,
  formatCount,
  formatInrMinor,
  formatInstantInTz,
  formatSignedInrMinor,
  formatWeight,
  formatWindow,
  shortId,
} from "../features/format";
import "../styles/operations.css";

export interface Workspace {
  foundation: SessionFoundation;
  signIn: SignInController;
  queue: QueueController;
  detail: OrderDetailController;
  care: CareActionController;
}

export interface ProductOperationsAppProps {
  /** Inject a prepared session foundation (tests, native hosts). Production
   * uses the app's own binding from src/foundation/session.ts. */
  foundation?: SessionFoundation;
  generateKey?: () => string;
}

function createWorkspace(foundation: SessionFoundation, generateKey: () => string): Workspace {
  const runAuthorized = <T,>(run: (client: V2Client) => Promise<T>): Promise<T> =>
    foundation.authorized(run);
  return {
    foundation,
    // Public identity endpoints go through the app binding's plain v2 client,
    // which is the same object the foundation is built from.
    signIn: new SignInController({ foundation, publicClient: () => getV2Client() }),
    queue: new QueueController({ runAuthorized }),
    detail: new OrderDetailController({ runAuthorized }),
    care: new CareActionController({ runAuthorized, generateKey }),
  };
}

export function ProductOperationsApp(props: ProductOperationsAppProps = {}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(() => {
    try {
      return createWorkspace(
        props.foundation ?? getFoundation(),
        props.generateKey ?? (() => crypto.randomUUID()),
      );
    } catch {
      // An unset or invalid VITE_API_V2_URL is a configuration state, not a crash.
      return null;
    }
  });
  const signInState = useSyncedState(workspace?.signIn);
  const queueState = useSyncedState(workspace?.queue);
  const detailState = useSyncedState(workspace?.detail);
  const attemptState = useSyncedState(workspace?.care);

  useEffect(() => {
    if (!workspace) return;
    const offIdentity = workspace.foundation.registerPrivateCache(() => {
      workspace.queue.clear();
      workspace.detail.clear();
      workspace.care.clear();
      workspace.signIn.sessionChanged();
    });
    void workspace.signIn.restore();
    return offIdentity;
  }, [workspace]);

  const actor = signInState?.phase === "signedIn" ? signInState.actor : null;

  useEffect(() => {
    if (!workspace || !actor) return;
    void workspace.queue.refresh();
  }, [workspace, actor]);

  useEffect(() => {
    if (!workspace || !actor) return;
    const timer = window.setInterval(() => {
      workspace.queue.evaluateStaleness();
      workspace.detail.evaluateStaleness();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [workspace, actor]);

  if (workspace === null) {
    return (
      <div className="ops-frame ops-session">
        <div className="ops-brand">
          <span className="ops-mark" aria-hidden="true">L</span>
          <span>Laundry Ops</span>
        </div>
        <h1 className="ops-title">Operations console is not configured</h1>
        <p className="ops-sub">
          Set VITE_API_V2_URL to the explicit /v2 API base URL before staff sign in.
        </p>
      </div>
    );
  }

  if (!signInState || signInState.phase !== "signedIn") {
    return (
      <SignInView
        state={signInState ?? { phase: "collectPhone" }}
        error={workspace.signIn.lastError()}
        onPhoneSubmit={(phone) => void workspace.signIn.requestOtp(phone)}
        onVerify={(code, mfa) => void workspace.signIn.verifyOtp(code, mfa)}
        onBackToPhone={() => workspace.signIn.backToPhone()}
      />
    );
  }

  const currentActor = signInState.actor;
  return (
    <OperationsWorkspaceView
      actor={currentActor}
      queue={queueState ?? { kind: "idle" }}
      detail={detailState ?? { kind: "idle" }}
      attempt={attemptState ?? { phase: "idle" }}
      onOpenOrder={(orderId) => void workspace.detail.select(orderId)}
      onRefreshQueue={() => void workspace.queue.refresh()}
      onLoadMore={() => void workspace.queue.loadMore()}
      onRefreshDetail={() => void workspace.detail.refresh()}
      onStartCare={() => {
        const detail = workspace.detail.getState();
        if (detail.kind !== "ready") return;
        void workspace.care
          .begin(detail.order, currentActor.role)
          .then((updated) => {
            if (updated) workspace.detail.acceptUpdate(updated);
          });
      }}
      onRetryCare={() => {
        void workspace.care.retry().then((updated) => {
          if (updated) workspace.detail.acceptUpdate(updated);
        });
      }}
      onSignOut={() => void workspace.signIn.signOut()}
    />
  );
}

export default ProductOperationsApp;

/* ------------------------------------------------------------------ */
/* Sign-in sheet                                                       */
/* ------------------------------------------------------------------ */

export interface SignInViewProps {
  state: SignInState;
  error: PresentableError | null;
  onPhoneSubmit: (phone: string) => void;
  onVerify: (code: string, mfaCode?: string) => void;
  onBackToPhone: () => void;
}

export function SignInView(props: SignInViewProps) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [mfa, setMfa] = useState("");
  const phase = props.state.phase;
  const requesting = phase === "requesting";
  const verifying = phase === "collectCode" && props.state.verifying === true;
  return (
    <div className="ops-frame ops-session">
      <div className="ops-brand">
        <span className="ops-mark" aria-hidden="true">L</span>
        <span>Laundry Ops</span>
      </div>
      <h1 className="ops-title">Staff sign-in</h1>
      <p className="ops-sub">
        Facility and operator console. One-time code, plus the enrolled TOTP
        second factor when the account is provisioned.
      </p>
      {props.error && (
        <div className="ops-notice ops-notice-error" role="alert">
          <strong>{props.error.code}</strong> {props.error.message}
          {props.error.traceId && (
            <span className="ops-trace"> (trace {props.error.traceId})</span>
          )}
        </div>
      )}
      {(phase === "collectPhone" || phase === "requesting") && (
        <form
          className="ops-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!requesting) props.onPhoneSubmit(phone.trim());
          }}
        >
          <label className="ops-label" htmlFor="ops-phone">Staff phone</label>
          <input
            id="ops-phone"
            className="ops-input"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            disabled={requesting}
            placeholder="+91 followed by the ten digits"
            onChange={(event) => setPhone(event.target.value)}
          />
          <button type="submit" className="ops-primary" disabled={requesting}>
            {requesting ? "Requesting code…" : "Request one-time code"}
          </button>
        </form>
      )}
      {phase === "collectCode" && (
        <form
          className="ops-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (verifying) return;
            const trimmed = code.trim();
            const mfaTrim = mfa.trim();
            props.onVerify(trimmed, mfaTrim === "" ? undefined : mfaTrim);
          }}
        >
          <p className="ops-mini">
            Code sent. It stays valid until {formatClock(props.state.expiresAt)} local time.
          </p>
          <label className="ops-label" htmlFor="ops-code">6-digit one-time code</label>
          <input
            id="ops-code"
            className="ops-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            disabled={verifying}
            onChange={(event) => setCode(event.target.value)}
          />
          <label className="ops-label" htmlFor="ops-totp">
            TOTP second factor — only when enrolled
          </label>
          <input
            id="ops-totp"
            className="ops-input"
            inputMode="numeric"
            value={mfa}
            disabled={verifying}
            onChange={(event) => setMfa(event.target.value)}
          />
          <div className="ops-form-actions">
            <button type="submit" className="ops-primary" disabled={verifying}>
              {verifying ? "Signing in…" : "Verify and sign in"}
            </button>
            <button type="button" className="ops-ghost" onClick={props.onBackToPhone} disabled={verifying}>
              Use a different phone
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Workspace                                                           */
/* ------------------------------------------------------------------ */

const STATUS_LABEL: Record<v2.Order["status"], string> = {
  CONFIRMED: "Confirmed",
  PICKUP_PENDING: "Pickup pending",
  AT_FACILITY: "At facility",
  IN_CARE: "In care",
  QUALITY_CHECK: "Quality check",
  READY_FOR_RETURN: "Ready for return",
  RETURNING: "Returning",
  DELIVERED: "Delivered",
  AWAITING_ADJUSTMENT: "Awaiting adjustment",
  ON_HOLD: "On hold",
  CANCEL_REQUESTED: "Cancel requested",
  CANCELLED: "Cancelled",
  RESOLUTION_REQUIRED: "Resolution required",
};

const STATUS_TONE: Record<v2.Order["status"], "good" | "bad" | "warn" | "calm"> = {
  AWAITING_ADJUSTMENT: "warn",
  RESOLUTION_REQUIRED: "warn",
  CANCEL_REQUESTED: "warn",
  ON_HOLD: "warn",
  DELIVERED: "good",
  CANCELLED: "bad",
  CONFIRMED: "calm",
  PICKUP_PENDING: "calm",
  AT_FACILITY: "calm",
  IN_CARE: "calm",
  QUALITY_CHECK: "calm",
  READY_FOR_RETURN: "calm",
  RETURNING: "calm",
};

const PERMITTED_ACTION_LABEL: Record<v2.OrderAction, string> = {
  ACCEPT_ADJUSTMENT: "Accept adjustment",
  DECLINE_ADJUSTMENT: "Decline adjustment",
  REQUEST_CANCEL: "Request cancel",
  CONFIRM_DELIVERY: "Confirm delivery",
  APPROVE_RECEIPT: "Approve receipt",
};

export function statusPill(status: v2.Order["status"]) {
  return (
    <span className={`ops-pill ops-pill-${STATUS_TONE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Unit-appropriate quantity text from the line DTO only. */
export function formatLineQuantity(line: v2.OrderLine): string {
  if (line.billingUnit === "KG") {
    return line.estimatedWeightGrams === undefined
      ? "—"
      : formatWeight(line.estimatedWeightGrams);
  }
  return line.pieceQuantity === undefined
    ? "—"
    : formatCount(line.pieceQuantity, "piece");
}

function measuredLineText(entry: v2.MeasuredLine): string {
  const parts: string[] = [];
  if (entry.countedQuantity !== undefined) {
    parts.push(`Counted ${entry.countedQuantity.toLocaleString("en-IN")}`);
  }
  if (entry.measuredWeightGrams !== undefined) {
    parts.push(`Measured ${formatWeight(entry.measuredWeightGrams)}`);
  }
  if (entry.measuredPieceQuantity !== undefined) {
    parts.push(`Measured ${entry.measuredPieceQuantity.toLocaleString("en-IN")} pieces`);
  }
  if (parts.length === 0) parts.push("No measured fact recorded yet");
  const note = entry.note ? ` — ${entry.note}` : "";
  return `${parts.join(" · ")}, condition ${entry.condition}${note}`;
}

function queueLineCell(order: v2.Order): string {
  return order.lines.map(formatLineQuantity).join(" + ") || "—";
}

export interface OperationsWorkspaceViewProps {
  actor: v2.Actor;
  queue: QueueState;
  detail: DetailState;
  attempt: CareAttempt;
  onOpenOrder?: (orderId: string) => void;
  onRefreshQueue?: () => void;
  onLoadMore?: () => void;
  onRefreshDetail?: () => void;
  onStartCare?: () => void;
  onRetryCare?: () => void;
  onSignOut?: () => void;
}

function FreshnessLine(props: {
  state: { kind: "idle" | "loading" | "error" } | { kind: "ready"; loadedAt: string; stale: boolean; refreshError?: { code: string; message: string; traceId: string | undefined } };
  onRefresh?: () => void;
}) {
  if (props.state.kind !== "ready") return null;
  const parsedAt = Number.isNaN(Date.parse(props.state.loadedAt)) ? null : props.state.loadedAt;
  const age = props.state.stale ? "not current" : "current";
  return (
    <div className="ops-freshness">
      <span data-testid="ops-freshness" className="ops-mini">
        Updated {parsedAt === null ? "—" : formatClock(parsedAt)} · server view {age}
      </span>
      <button type="button" className="ops-ghost" onClick={props.onRefresh}>
        Refresh
      </button>
    </div>
  );
}

export function OperationsWorkspaceView(props: OperationsWorkspaceViewProps) {
  const { actor, queue, detail, attempt } = props;
  const facilityScope = actor.facilityIds.length > 0
    ? `${actor.facilityIds.length} facilit${actor.facilityIds.length === 1 ? "y" : "ies"} (${actor.facilityIds.map(shortId).join(", ")})`
    : "scope granted by the server session";
  const selectedId = detail.kind === "ready" ? detail.orderId : null;
  const action: StaffCareAction | null =
    detail.kind === "ready" ? nextStaffCareAction(detail.order, actor.role) : null;

  return (
    <div className="ops-frame ops-workspace">
      <header className="ops-header">
        <div className="ops-brand">
          <span className="ops-mark" aria-hidden="true">L</span>
          <div>
            <span className="ops-brand-name">Laundry Ops</span>
            <span className="ops-mini ops-muted">Facility queue and order detail</span>
          </div>
        </div>
        <div className="ops-header-actions" data-testid="ops-identity">
          <span className="ops-mini ops-muted">
            {actor.role} · {facilityScope}
          </span>
          <button type="button" className="ops-ghost" onClick={props.onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="ops-sheets">
        <section className="ops-sheet" aria-label="Order queue">
          <div className="ops-sheet-head">
            <h2 className="ops-h2">Order queue</h2>
            <FreshnessLine state={queue} onRefresh={props.onRefreshQueue} />
          </div>

          {queue.kind === "ready" && queue.refreshError && (
            <div className="ops-notice ops-notice-error" role="alert">
              <strong>{queue.refreshError.code}</strong> {queue.refreshError.message}
              {queue.refreshError.traceId && (
                <span className="ops-trace"> (trace {queue.refreshError.traceId})</span>
              )}
            </div>
          )}
          {queue.kind === "ready" && queue.stale && !queue.refreshError && (
            <div className="ops-notice" role="status">
              Showing the {formatClock(queue.loadedAt)} view of the queue. Refresh to
              sync before acting.
            </div>
          )}

          {queue.kind === "loading" && (
            <div className="ops-loading" role="status">
              <div className="ops-skeleton" style={{ width: "40%" }} />
              <div className="ops-skeleton" style={{ width: "85%" }} />
              <div className="ops-skeleton" style={{ width: "70%" }} />
            </div>
          )}

          {queue.kind === "error" && (
            <div className="ops-empty" role="alert">
              <p>
                Could not load the order queue. {queue.error.code}: {queue.error.message}
                {queue.error.traceId ? ` (trace ${queue.error.traceId})` : ""}
              </p>
              <button type="button" className="ops-ghost" onClick={props.onRefreshQueue}>
                Try again
              </button>
            </div>
          )}

          {queue.kind === "ready" && queue.items.length === 0 && (
            <div className="ops-empty">
              <p>No orders in this queue yet.</p>
              <p className="ops-mini ops-muted">
                New bookings appear once the server route grants this session's
                scope. Refresh from the header when the shift starts.
              </p>
            </div>
          )}

          {queue.kind === "ready" && queue.items.length > 0 && (
            <div className="ops-scroll">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th scope="col">Order</th>
                    <th scope="col">Status</th>
                    <th scope="col">Pickup window</th>
                    <th scope="col" className="num">Items</th>
                    <th scope="col" className="num">Total</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.items.map((order) => (
                    <tr key={order.id} className={order.id === selectedId ? "ops-row-selected" : undefined} data-ops-order-row={order.id}>
                      <td>
                        {shortId(order.id)}
                        <span className="ops-mini ops-muted"> · v{order.version}</span>
                      </td>
                      <td>{statusPill(order.status)}</td>
                      <td>{formatWindow(order.pickupWindow)}</td>
                      <td className="num">{queueLineCell(order)}</td>
                      <td className="num">{formatInrMinor(order.totalMinor)}</td>
                      <td>
                        <button
                          type="button"
                          className="ops-ghost"
                          aria-label={`Open order ${shortId(order.id)}`}
                          onClick={() => props.onOpenOrder?.(order.id)}
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {queue.kind === "ready" && queue.pageInfo.hasMore && (
            <div className="ops-sheet-foot">
              <button type="button" className="ops-ghost" onClick={props.onLoadMore}>
                Load more
              </button>
            </div>
          )}
        </section>

        <section className="ops-sheet" aria-label="Selected order">
          <div className="ops-sheet-head">
            <h2 className="ops-h2">Order detail</h2>
            {detail.kind === "ready" && (
              <FreshnessLine state={detail} onRefresh={props.onRefreshDetail} />
            )}
          </div>

          {detail.kind === "idle" && (
            <p className="ops-placeholder">Select an order in the queue to open its detail.</p>
          )}

          {detail.kind === "loading" && (
            <div className="ops-loading" role="status">
              <div className="ops-skeleton" style={{ width: "35%" }} />
              <div className="ops-skeleton" style={{ width: "90%" }} />
              <div className="ops-skeleton" style={{ width: "60%" }} />
            </div>
          )}

          {detail.kind === "error" && (
            <div className="ops-empty" role="alert">
              <p>
                Could not load order {shortId(detail.orderId)}. {detail.error.code}:{" "}
                {detail.error.message}
                {detail.error.traceId ? ` (trace ${detail.error.traceId})` : ""}
              </p>
              <button type="button" className="ops-ghost" onClick={props.onRefreshDetail}>
                Try again
              </button>
            </div>
          )}

          {detail.kind === "ready" && (
            <OrderDetailBody
              order={detail.order}
              actor={actor}
              action={action}
              attempt={attempt}
              refreshError={detail.refreshError}
              stale={detail.stale}
              loadedAt={detail.loadedAt}
              onRefreshDetail={props.onRefreshDetail}
              onStartCare={props.onStartCare}
              onRetryCare={props.onRetryCare}
            />
          )}
        </section>
      </main>
    </div>
  );
}

function OrderDetailBody(props: {
  order: v2.Order;
  actor: v2.Actor;
  action: StaffCareAction | null;
  attempt: CareAttempt;
  refreshError?: { code: string; message: string; traceId: string | undefined };
  stale: boolean;
  loadedAt: string;
  onRefreshDetail?: () => void;
  onStartCare?: () => void;
  onRetryCare?: () => void;
}) {
  const order = props.order;
  const timezone = order.pickupWindow.timezone;
  const retryBlocked = props.attempt.phase === "unknown";
  const sending = props.attempt.phase === "sending";
  return (
    <div className="ops-detail">
      {props.refreshError && (
        <div className="ops-notice ops-notice-error" role="alert">
          <strong>{props.refreshError.code}</strong> {props.refreshError.message}
          {props.refreshError.traceId && (
            <span className="ops-trace"> (trace {props.refreshError.traceId})</span>
          )}
        </div>
      )}
      {!props.refreshError && props.stale && (
        <div className="ops-notice" role="status">
          Showing the {formatClock(props.loadedAt)} view of this order. Refresh before
          acting.
        </div>
      )}

      <div className="ops-detail-head">
        <div>
          <h3 className="ops-h2" data-testid="ops-order-title">
            Order {shortId(order.id)} <span className="ops-mini ops-muted">v{order.version}</span>
          </h3>
        </div>
        <button type="button" className="ops-ghost" onClick={props.onRefreshDetail}>
          Refresh
        </button>
      </div>

      <dl className="ops-facts">
        <div><dt>Status</dt><dd>{statusPill(order.status)}</dd></div>
        <div>
          <dt>Payment model</dt>
          <dd>{order.paymentModel === "DUE_AT_RETURN" ? "Payment at return" : "Prepaid adapter (v1 order)"}</dd>
        </div>
        <div><dt>Created</dt><dd>{formatInstantInTz(order.createdAt, timezone)}</dd></div>
        <div><dt>Pickup window</dt><dd>{formatWindow(order.pickupWindow)}</dd></div>
        <div><dt>Promised return</dt><dd>{formatWindow(order.promisedReturnWindow)}</dd></div>
        <div><dt className="num">Total</dt><dd className="num">{formatInrMinor(order.totalMinor)}</dd></div>
      </dl>

      <h4 className="ops-h3">Lines</h4>
      <div className="ops-scroll">
        <table className="ops-table">
          <thead>
            <tr>
              <th scope="col">Service</th>
              <th scope="col">Unit</th>
              <th scope="col">Quantity</th>
              <th scope="col" className="num">Garments declared</th>
              <th scope="col" className="num">Line total</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => (
              <tr key={line.orderLineId}>
                <td>{shortId(line.serviceId)}</td>
                <td>{line.billingUnit}</td>
                <td>{formatLineQuantity(line)}</td>
                <td className="num">
                  {line.declaredGarmentCount === undefined
                    ? "—"
                    : line.declaredGarmentCount.toLocaleString("en-IN")}
                </td>
                <td className="num">{formatInrMinor(line.lineTotalMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(order.measuredLines?.length ?? 0) > 0 && (
        <>
          <h4 className="ops-h3">Measured and counted facts</h4>
          <ul className="ops-list">
            {order.measuredLines?.map((entry) => (
              <li key={entry.orderLineId}>{measuredLineText(entry)}</li>
            ))}
          </ul>
        </>
      )}

      <h4 className="ops-h3">Containers</h4>
      {order.containers.length === 0 ? (
        <div className="ops-mini-frame">No container facts recorded yet.</div>
      ) : (
        <div className="ops-scroll">
          <table className="ops-table">
            <thead>
              <tr>
                <th scope="col">Container</th>
                <th scope="col">Seal</th>
                <th scope="col">Condition</th>
                <th scope="col" className="num">Garments</th>
                <th scope="col" className="num">Weight</th>
              </tr>
            </thead>
            <tbody>
              {order.containers.map((container) => (
                <tr key={container.id}>
                  <td>{shortId(container.id)}</td>
                  <td>{container.sealId ?? "—"}</td>
                  <td>{container.condition}</td>
                  <td className="num">{container.garmentCount.toLocaleString("en-IN")}</td>
                  <td className="num">{container.weightGrams === undefined ? "—" : formatWeight(container.weightGrams)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {order.adjustment && (
        <div className="ops-panel">
          <h4 className="ops-h3">Intake adjustment</h4>
          <dl className="ops-facts">
            <div><dt>State</dt><dd>{order.adjustment.state}</dd></div>
            <div><dt>Reason</dt><dd>{order.adjustment.reason}</dd></div>
            <div><dt className="num">Prior total</dt><dd className="num">{formatInrMinor(order.adjustment.previousTotalMinor)}</dd></div>
            <div><dt className="num">Proposed total</dt><dd className="num">{formatInrMinor(order.adjustment.newTotalMinor)}</dd></div>
            <div><dt className="num">Change</dt><dd className="num">{formatSignedInrMinor(order.adjustment.deltaMinor)}</dd></div>
            <div><dt>Decision by</dt><dd>{formatInstantInTz(order.adjustment.expiresAt, timezone)}</dd></div>
          </dl>
        </div>
      )}

      <h4 className="ops-h3">Delivery legs</h4>
      {order.deliveryLegs.length === 0 ? (
        <div className="ops-mini-frame">No delivery leg has been recorded for this order yet.</div>
      ) : (
        <ul className="ops-list">
          {order.deliveryLegs.map((leg) => (
            <li key={leg.leg}>
              {leg.leg} leg · status {leg.status}
              {leg.assignedTo ? ` · assigned ${shortId(leg.assignedTo)}` : ""}
              {leg.handoffMethod ? ` · handover ${leg.handoffMethod}` : ""}
            </li>
          ))}
        </ul>
      )}

      <h4 className="ops-h3">History</h4>
      {order.timeline.length === 0 ? (
        <div className="ops-mini-frame">No history recorded yet.</div>
      ) : (
        <ul className="ops-list">
          {order.timeline.map((event, index) => (
            <li key={`${event.at}-${index}`}>
              {formatInstantInTz(event.at, timezone)} · {event.label} ({event.status})
            </li>
          ))}
        </ul>
      )}

      <div className="ops-panel" data-testid="ops-staff-action-panel">
        <h4 className="ops-h3">Staff next action</h4>
        {props.action && (
          <>
            <button
              type="button"
              className="ops-primary"
              disabled={props.action.target === undefined || sending || retryBlocked}
              onClick={() => {
                if (props.action?.target === undefined) return;
                props.onStartCare?.();
              }}
            >
              {sending ? "Sending…" : props.action.label}
            </button>
            {props.action.blockedReason && (
              <p className="ops-blocked">{props.action.blockedReason}</p>
            )}
          </>
        )}

        {props.attempt.phase === "unknown" && (
          <div className="ops-notice" role="alert">
            <strong>Outcome unknown.</strong> The care command (key {shortId(props.attempt.commandKey)}) was not
            confirmed by the server. Retry sends the identical command with the same
            key — do not re-count or re-measure until the server confirms.
            <div className="ops-form-actions">
              <button type="button" className="ops-ghost" onClick={props.onRetryCare}>
                Retry with same key
              </button>
            </div>
          </div>
        )}

        {props.attempt.phase === "rejected" && (
          <div className="ops-notice ops-notice-error" role="alert">
            <strong>{props.attempt.code}</strong> {props.attempt.message}
            {props.attempt.traceId && (
              <span className="ops-trace"> (trace {props.attempt.traceId})</span>
            )}
            {props.attempt.currentVersion !== undefined && (
              <span>
                {" "}The server now holds version v{props.attempt.currentVersion}; refresh
                the order before acting again.
              </span>
            )}
            <div className="ops-form-actions">
              <button type="button" className="ops-ghost" onClick={props.onRefreshDetail}>
                Refresh order
              </button>
            </div>
          </div>
        )}

        {!order.permittedActions || order.permittedActions.length === 0 ? (
          <p className="ops-mini ops-muted">
            No customer decisions remain open on this order.
          </p>
        ) : (
          <div className="ops-chips">
            {order.permittedActions.map((permitted) => (
              <span key={permitted} className="ops-chip">
                {PERMITTED_ACTION_LABEL[permitted]}
              </span>
            ))}
          </div>
        )}
        <p className="ops-mini ops-muted">
          Customer actions follow the server's own permission list; staff cannot
          decide them on the customer's behalf.
        </p>
      </div>
    </div>
  );
}
