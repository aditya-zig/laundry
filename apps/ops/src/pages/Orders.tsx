import { useEffect, useState } from "react";
import type { Order } from "@laundry/contracts";
import { getClient } from "../api";
import { formatINR, visibleOrders } from "../guards";
import { Link } from "../components";

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
      <div>
        <p className="err">{error}</p>
        <button onClick={load}>Retry</button>
      </div>
    );
  if (!orders) return <p>Loading order queue…</p>;
  const visible = visibleOrders(orders, role, facilityId);
  if (visible.length === 0) return <p>No orders in your scope. Facility staff see only assigned facilities.</p>;
  return (
    <div>
      <h2>Order queue</h2>
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
              <td>{o.status}</td>
              <td>{formatINR(o.totalMinor)}</td>
              <td>{o.paymentStatus}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
