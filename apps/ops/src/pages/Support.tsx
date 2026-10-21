import { useEffect, useState } from "react";
import type { Order } from "@laundry/contracts";
import { getClient } from "../api";
import { formatINR, overrideRequiresReason, refundStatusLabel } from "../guards";
import { Link } from "../components";

const ATTENTION = ["AWAITING_ADJUSTMENT", "ON_HOLD", "RESOLUTION_REQUIRED", "CANCEL_REQUESTED"];

export function SupportPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [selectedOrder, setSelectedOrder] = useState("");

  useEffect(() => {
    getClient().listOpsOrders().then(setOrders).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, []);

  async function refund() {
    const reasonError = overrideRequiresReason(reason);
    if (!selectedOrder || !paymentId || !amount || reasonError) {
      setNotice(reasonError ?? "Select an order and fill payment, amount, and reason.");
      return;
    }
    setNotice(null);
    try {
      await getClient().createRefund(selectedOrder, paymentId, Math.round(Number(amount) * 100), reason);
      setNotice("Refund requested. Status stays refund pending until the provider confirms.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Refund failed");
    }
  }

  if (error) return <p className="err">{error}</p>;
  if (!orders) return <p>Loading support queue…</p>;
  const flagged = orders.filter((o) => ATTENTION.includes(o.status));
  return (
    <div>
      <h2>Support and refunds</h2>
      <p>Missing or damaged items own an incident trail here. Orders are never silently marked successful.</p>
      {flagged.length === 0 ? (
        <p>No orders need attention.</p>
      ) : (
        flagged.map((o) => (
          <div key={o.id} className="card">
            <p>
              <Link to={`#/orders/${o.id}`}>{o.id.slice(0, 8)}</Link> · {o.status} · {formatINR(o.totalMinor)} ·{" "}
              {refundStatusLabel(undefined)}
            </p>
            <button onClick={() => setSelectedOrder(o.id)}>Refund this order</button>
          </div>
        ))
      )}
      <h3>Request refund</h3>
      <p>Order {selectedOrder ? selectedOrder.slice(0, 8) : "(pick one above)"}</p>
      <label>
        Payment ID
        <input value={paymentId} onChange={(e) => setPaymentId(e.target.value)} />
      </label>
      <label>
        Amount (INR)
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
      </label>
      <label>
        Reason (required)
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button onClick={refund}>Request refund</button>
      {notice && <p>{notice}</p>}
    </div>
  );
}
