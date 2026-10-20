import { useEffect, useState } from "react";
import type { Order } from "@wandary/contracts";
import { getClient } from "../api";
import type { CareTarget } from "@wandary/api-client";
import { careBlockedReason, formatINR, intakeDiscrepancy, overrideRequiresReason } from "../guards";

const CARE_TARGETS = ["IN_CARE", "QUALITY_CHECK", "READY_FOR_RETURN"] as const;

export function OrderDetailPage({ id }: { id: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bagIds, setBagIds] = useState("");
  const [careTo, setCareTo] = useState<CareTarget>(CARE_TARGETS[0]);
  const [reason, setReason] = useState("");

  function load() {
    setError(null);
    getClient()
      .listOpsOrders()
      .then((all) => {
        const found = all.find((o) => o.id === id);
        if (!found) setError("Order not found in your scope.");
        else setOrder(found);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load order"));
  }
  useEffect(load, [id]);

  if (error) return <div className="card"><p className="err">{error}</p></div>;
  if (!order) return <div className="card"><p>Loading…</p></div>;

  const blocked = careBlockedReason(order);
  const discrepancy = intakeDiscrepancy(order);

  async function intake() {
    const reasonError = overrideRequiresReason(reason);
    if (reasonError) {
      setNotice(reasonError);
      return;
    }
    setNotice(null);
    try {
      const bags = bagIds.split(",").map((b) => b.trim()).filter(Boolean);
      const measuredLines = (order!.lines ?? []).map((l) => ({
        orderLineId: l.orderLineId,
        quantity: l.quantity,
        ...(l.estimatedWeightGrams === undefined ? {} : { weightGrams: l.estimatedWeightGrams }),
        conditionMediaIds: [] as string[],
      }));
      const next = await getClient().recordIntake(
        order!.id,
        order!.version,
        measuredLines,
        bags.length > 0 ? { bagIds: bags } : undefined,
      );
      setOrder(next);
      setNotice("Intake recorded with reason and actor audit.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Intake failed");
    }
  }

  async function advance() {
    if (blocked) return;
    setNotice(null);
    try {
      const next = await getClient().advanceCare(order!.id, order!.version, careTo);
      setOrder(next);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Care transition failed");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card">
        <span className="pill pill-action">{order.status}</span>{" "}
        <span className="pill">PAYMENT {order.paymentStatus}</span>
        <h3 style={{ marginTop: 8 }}>Order {order.id.slice(0, 8)}</h3>
        <p className="muted" style={{ margin: "4px 0 0" }}>
          {formatINR(order.totalMinor)} · version {order.version}
        </p>
        {discrepancy && <p className="warn" style={{ marginTop: 12 }}>{discrepancy}</p>}
      </div>
      <div className="grid-2">
        <div className="card">
          <h3>Intake and count reconciliation</h3>
          <p className="muted">Compare the sealed bag against the order lines. Intake stays visible when counts differ.</p>
          <label>
            Sealed bag IDs (comma separated)
            <input value={bagIds} onChange={(e) => setBagIds(e.target.value)} placeholder="bag-1, bag-2" />
          </label>
          <label>
            Reason (required for every override)
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Counted 5 shirts, 1 stain noted" />
          </label>
          <button onClick={intake}>Record intake</button>
        </div>
        <div className="card">
          <h3>Care workflow</h3>
          {blocked ? (
            <p className="warn">{blocked}</p>
          ) : (
            <div>
              <label>
                Next care state
                <select value={careTo} onChange={(e) => setCareTo(e.target.value as CareTarget)}>
                  {CARE_TARGETS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <button onClick={advance}>Advance care</button>
            </div>
          )}
        </div>
      </div>
      <div className="card">
        <h3>History</h3>
        <ul className="timeline">
          {order.timeline.map((t, i) => (
            <li key={i}>
              <strong>{t.status}</strong>: {t.label} ({t.at})
            </li>
          ))}
        </ul>
        {notice && <p className="notice" style={{ marginTop: 12 }}>{notice}</p>}
      </div>
    </div>
  );
}
