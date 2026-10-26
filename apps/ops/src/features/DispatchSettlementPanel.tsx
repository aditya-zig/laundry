import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { v2 } from "@laundry/contracts";
import { isMutationOutcomePending, type QueuedMutationRecord, type SessionFoundation } from "@laundry/app-foundation";
import { describeError } from "./errors";
import { formatInrMinor, shortId } from "./format";

type Intent = (
  | { routeId: "logistics.ops.assign"; body: v2.AssignmentInput }
  | { routeId: "billing.manual.confirm"; params: { obligationId: string }; body: v2.ManualPaymentConfirmation }
) & { retainedKey?: string };
type Facts = { legs: v2.LegAttempt[]; obligations: v2.Obligation[]; retained: QueuedMutationRecord[] };

/** Persisted data can only select these two approved SDK commands, never a URL. */
function restoreIntent(record: QueuedMutationRecord, facts: Facts): Intent | null {
  try {
    const raw: unknown = JSON.parse(record.bodyJson ?? "null");
    if (record.routeId === "logistics.ops.assign") {
      const body = v2.assignmentInputSchema.parse(raw);
      return facts.legs.some(leg => leg.id === body.legAttemptId)
        ? { routeId: "logistics.ops.assign", body, retainedKey: record.idempotencyKey } : null;
    }
    if (record.routeId === "billing.manual.confirm") {
      const obligationId = v2.idSchema.parse(record.params.obligationId);
      const body = v2.manualPaymentConfirmationSchema.parse(raw);
      return facts.obligations.some(item => item.id === obligationId)
        ? { routeId: "billing.manual.confirm", params: { obligationId }, body, retainedKey: record.idempotencyKey } : null;
    }
  } catch { /* Invalid or unrelated retained data must be reconciled, not rewritten. */ }
  return null;
}

export function DispatchSettlementPanel(props: {
  foundation: SessionFoundation;
  order: v2.Order;
  onChanged: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { foundation, order } = props;
  const [facts, setFacts] = useState<Facts | null>(null);
  const [message, setMessage] = useState("");
  const [readError, setReadError] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<Intent | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    props.onBusyChange?.(sending || pending !== null);
    return () => props.onBusyChange?.(false);
  }, [props.onBusyChange, sending, pending]);
  const inFlight = useRef(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  useEffect(() => {
    let current = true;
    setFacts(null); setReadError("");
    void Promise.all([
      foundation.authorized(client => client.getDispatchLegs(order.id)),
      foundation.authorized(client => client.listOpsOrderObligations(order.id)),
      foundation.listQueuedMutations(),
    ]).then(([legs, page, retained]) => {
      if (!current) return;
      // Do not pretend the first page covers every obligation.
      if (page.pageInfo.hasMore) throw new Error("More obligations exist. Reconcile this order through the billing workflow before recording money here.");
      const loaded = { legs, obligations: page.items, retained };
      setFacts(loaded);
      setPending(retained.map(record => restoreIntent(record, loaded)).find(intent => intent !== null) ?? null);
    }).catch(error => { if (current) setReadError(describeError(error).message); });
    return () => { current = false; };
  }, [foundation, order.id, order.version, revision]);

  async function send(intent: Intent) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true); setMessage(""); setPending(intent);
    try {
      // The foundation journals the immutable DTO/key BEFORE sending. A retry
      // or a recreated host using the same store reuses that exact intent.
      await foundation.enqueueMutation(intent);
      if (!live.current) return;
      setPending(null);
      setMessage(intent.routeId === "logistics.ops.assign"
        ? "Rider assignment recorded. This does not prove pickup or return handover."
        : "Manual receipt recorded, not an online capture. Delivery still requires accepted return custody.");
      setRevision(value => value + 1);
      props.onChanged();
    } catch (error) {
      if (!live.current) return;
      const detail = describeError(error);
      if (isMutationOutcomePending(error)) {
        const records = await foundation.listQueuedMutations().catch(() => []);
        if (!live.current) return;
        const retained = facts ? records.map(record => restoreIntent(record, facts)).find(candidate => candidate !== null && candidate.routeId === intent.routeId && JSON.stringify(candidate.body) === JSON.stringify(intent.body) && JSON.stringify("params" in candidate ? candidate.params : {}) === JSON.stringify("params" in intent ? intent.params : {})) : undefined;
        setPending(retained ?? intent);
        setMessage(retained
          ? `Outcome not confirmed. Retry this retained command; do not create another payment or assignment. ${detail.message}`
          : `The original command cannot be safely replayed from this session. Reconcile the server ledger before creating anything else; no replacement key was created. ${detail.message}`);
      } else {
        setPending(null);
        setMessage(`${detail.code}: ${detail.message}${detail.traceId ? ` (trace ${detail.traceId})` : ""}`);
        setRevision(value => value + 1);
      }
    } finally {
      inFlight.current = false;
      if (live.current) setSending(false);
    }
  }

  const blocked = sending || pending !== null || (facts?.retained.length ?? 0) > 0;
  const returnLeg = facts?.legs.find(leg => leg.leg === "RETURN");
  const collectingAtReturn = order.status === "RETURNING" && returnLeg !== undefined && ["IN_TRANSIT", "COMPLETED"].includes(returnLeg.status);
  return <section className="ops-command-panel" aria-label="Dispatch and payment at return">
    <h3 className="ops-h3">Dispatch & payment at return</h3>
    <p className="ops-mini">Operator tools. Sealed-bag custody and payment remain separate server records. Keep this console open until uncertain commands are reconciled.</p>
    {message && <p role="status" className="ops-notice">{message}</p>}
    {pending && <div className="ops-notice" role="alert">
      A retained {pending.routeId === "logistics.ops.assign" ? "assignment" : "manual receipt"} has not been reconciled.
      <button className="ops-primary" type="button" disabled={sending || !pending.retainedKey} onClick={() => void send(pending)}>Retry retained command</button>
    </div>}
    {readError ? <div role="alert"><p>{readError}</p><button type="button" className="ops-ghost" disabled={sending || pending !== null} onClick={() => setRevision(value => value + 1)}>Reload dispatch facts</button></div>
      : facts === null ? <p role="status">Loading dispatch and payment facts…</p>
      : <>
        {facts.retained.length > 0 && !pending && <p role="alert">Another retained command needs reconciliation. Reopen its original order before creating any new dispatch or payment.</p>}
        {facts.legs.length === 0 && <p>No delivery attempt is recorded. This screen cannot invent one.</p>}
        {facts.legs.map(leg => <div className="ops-record-group" key={`${leg.id}:${leg.version}`}>
          <p><strong>{leg.leg === "RETURN" ? "Return" : "Pickup"}</strong> · {leg.status} · attempt {leg.attemptNumber} · version {leg.version}</p>
          {leg.assignedTo && <p className="ops-mini">Assigned rider {shortId(leg.assignedTo)}</p>}
          {leg.leg === "RETURN" && leg.status === "BOOKED" && order.status === "READY_FOR_RETURN" && <AssignmentForm leg={leg} disabled={blocked} onSubmit={body => void send({ routeId: "logistics.ops.assign", body })} />}
        </div>)}
        <h4 className="ops-h3">Manual payment ledger</h4>
        <p className="ops-mini">This panel does not reconcile online attempts. Resolve any pending or unknown online payment before collecting cash or manual UPI.</p>
        {!collectingAtReturn && <p className="ops-mini">Collection is available only during the physical return journey. Never record an expected transfer as received.</p>}
        {facts.obligations.length === 0 && <p>No obligation is recorded. Do not enter an invented payment.</p>}
        {facts.obligations.map(item => <PaymentForm key={`${item.id}:${item.version}`} obligation={item} disabled={blocked || !collectingAtReturn} onSubmit={body => void send({ routeId: "billing.manual.confirm", params: { obligationId: item.id }, body })} />)}
      </>}
  </section>;
}

function AssignmentForm(props: { leg: v2.LegAttempt; disabled: boolean; onSubmit: (body: v2.AssignmentInput) => void }) {
  const [riderId, setRiderId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = v2.assignmentInputSchema.safeParse({ legAttemptId: props.leg.id, expectedVersion: props.leg.version, riderId: riderId.trim(), reason: reason.trim() });
    if (!parsed.success) { setError("Enter a provisioned rider ID and an assignment reason."); return; }
    setError(""); props.onSubmit(parsed.data);
  }
  return <form onSubmit={submit} aria-label={`Assign ${props.leg.leg.toLowerCase()} rider`}>
    <fieldset className="ops-record-fields" disabled={props.disabled}>
      <label className="ops-label">Provisioned rider ID<input className="ops-input" value={riderId} onChange={event => setRiderId(event.target.value)} required /></label>
      <p className="ops-mini">Use the ID from staff provisioning. No rider directory or auto-assignment is implied.</p>
      <label className="ops-label">Assignment reason<input className="ops-input" value={reason} onChange={event => setReason(event.target.value)} required maxLength={1000} /></label>
      {error && <p role="alert">{error}</p>}
      <button className="ops-primary" type="submit">Assign rider</button>
    </fieldset>
  </form>;
}

function PaymentForm(props: { obligation: v2.Obligation; disabled: boolean; onSubmit: (body: v2.ManualPaymentConfirmation) => void }) {
  const { obligation } = props;
  const methodId = useId();
  const remaining = Math.max(0, obligation.amountDueMinor - obligation.amountSettledMinor);
  const [method, setMethod] = useState<"CASH" | "UPI">("CASH");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!confirmed || (method === "UPI" && reference.trim() === "")) { setError("Confirm actual receipt and enter the UPI transaction reference when applicable."); return; }
    const parsed = v2.manualPaymentConfirmationSchema.safeParse({ expectedVersion: obligation.version, method, amountMinor: remaining, currency: "INR", reason: reason.trim(), ...(reference.trim() ? { externalReference: reference.trim() } : {}) });
    if (!parsed.success) { setError("Enter a valid collection reason and reference. The amount comes from the server obligation."); return; }
    setError(""); props.onSubmit(parsed.data);
  }
  return <div className="ops-record-group">
    <p>Obligation {shortId(obligation.id)} · {obligation.status} · remaining <strong>{formatInrMinor(remaining)}</strong></p>
    {remaining > 0 && obligation.status !== "VOID" && <form onSubmit={submit} aria-label="Record payment at return">
      <fieldset className="ops-record-fields" disabled={props.disabled}>
        <label className="ops-label" htmlFor={methodId}>Received by</label>
        <select id={methodId} className="ops-input" value={method} onChange={event => { setMethod(event.target.value === "UPI" ? "UPI" : "CASH"); setConfirmed(false); }}><option value="CASH">Cash</option><option value="UPI">Manual UPI transfer</option></select>
        <label className="ops-label">Transaction reference{method === "UPI" ? " (required)" : " (optional)"}<input className="ops-input" value={reference} onChange={event => { setReference(event.target.value); setConfirmed(false); }} required={method === "UPI"} maxLength={500} /></label>
        <label className="ops-label">Collection reason<input className="ops-input" value={reason} onChange={event => { setReason(event.target.value); setConfirmed(false); }} required maxLength={1000} /></label>
        <label className="ops-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required />I verified receipt of {formatInrMinor(remaining)}; this is not a promised or pending transfer.</label>
        {error && <p role="alert">{error}</p>}
        <button className="ops-primary" type="submit">Record received payment</button>
      </fieldset>
    </form>}
  </div>;
}
