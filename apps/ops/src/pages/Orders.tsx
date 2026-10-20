import { useEffect, useState } from "react";
import type { Order } from "@wandary/contracts";
import { getClient } from "../api";
import { formatINR, visibleOrders } from "../guards";
import { Link } from "../components";

function pillFor(status: string): string {
  if (status.includes("DELIVERED") || status === "READY_FOR_RETURN") return "pill pill-good";
  if (status.includes("CANCEL") || status.includes("FAIL") || status === "RESOLUTION_REQUIRED") return "pill pill-bad";
  if (status.includes("HOLD") || status.includes("ADJUSTMENT") || status.includes("PENDING")) return "pill pill-warn";
  return "pill pill-action";
}

export function OrdersPage({ role, facilityId }: { role: string; facilityId?: string }) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    getClient()
      .listOpsOrders()
      .then(setOrders)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load orders"));
  }
  useEffect(load, []);

  if (error)
    return (
      <div className="card">
        <p className="err">{error}</p>
        <button onClick={load}>Retry</button>
      </div>
    );
  if (!orders) return <div className="card"><p>Loading order queue…</p></div>;
  const visible = visibleOrders(orders, role, facilityId);
  if (visible.length === 0)
    return (
      <div className="card">
        <h3>No orders in your scope</h3>
        <p className="muted">Facility staff see only assigned facilities. Ask an operator if a missing order belongs to another facility.</p>
      </div>
    );

  const awaiting = visible.filter((o) => o.status === "AWAITING_PAYMENT" || o.status === "CONFIRMED").length;
  const inCare = visible.filter((o) => ["AT_FACILITY", "IN_CARE", "QUALITY_CHECK"].includes(o.status)).length;
  const returning = visible.filter((o) => ["READY_FOR_RETURN", "RETURNING"].includes(o.status)).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="kpi-grid">
        <div className="kpi"><small>IN SCOPE</small><strong>{visible.length}</strong><span>orders for {role}</span></div>
        <div className="kpi"><small>AWAITING START</small><strong>{awaiting}</strong><span>payment or pickup pending</span></div>
        <div className="kpi"><small>IN CARE</small><strong>{inCare}</strong><span>at facility or quality check</span></div>
        <div className="kpi"><small>RETURNING</small><strong>{returning}</strong><span>ready or out for return</span></div>
      </div>
      <div className="table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Status</th>
                <th>Total</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link to={`#/orders/${o.id}`}>{o.id.slice(0, 8)}</Link>
                  </td>
                  <td><span className={pillFor(o.status)}>{o.status}</span></td>
                  <td>{formatINR(o.totalMinor)}</td>
                  <td><span className="pill">{o.paymentStatus}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
