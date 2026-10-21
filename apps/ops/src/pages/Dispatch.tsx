import { useEffect, useState } from "react";
import type { DeliveryJob } from "@laundry/contracts";
import { getClient } from "../api";
import { dispatchFlag } from "../guards";

export function DispatchPage() {
  const [jobs, setJobs] = useState<DeliveryJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [riderId, setRiderId] = useState("");

  function load() {
    setError(null);
    getClient()
      .listOpsDeliveries()
      .then(setJobs)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load deliveries"));
  }
  useEffect(load, []);

  async function dispatch(job: DeliveryJob) {
    setNotice(null);
    if (!riderId.trim()) {
      setNotice("Enter a provisioned rider ID. Dispatch does not allow riders to self-assign.");
      return;
    }
    try {
      const next = await getClient().dispatchDelivery(job.id, { assignedTo: riderId.trim(), expectedVersion: job.version });
      setJobs((js) => (js ?? []).map((j) => (j.id === job.id ? next : j)));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Dispatch failed. Unknown outcomes reconcile before retry.");
    }
  }

  if (error)
    return (
      <div>
        <p className="err">{error}</p>
        <button onClick={load}>Retry</button>
      </div>
    );
  if (!jobs) return <p>Loading dispatch board…</p>;
  if (jobs.length === 0) return <p>No delivery legs awaiting dispatch.</p>;
  return (
    <div>
      <h2>Dispatch board</h2>
      <label htmlFor="rider-id">Provisioned rider ID</label>
      <input id="rider-id" value={riderId} onChange={(e) => setRiderId(e.target.value)} placeholder="UUID of an authorized rider" />
      <p>DEMO rider ID: dddddddd-dddd-4ddd-8ddd-dddddddddddd. No external dispatch provider is connected.</p>
      {jobs.map((j) => (
        <div key={j.id} className="card">
          <p>
            <strong>{j.leg}</strong> · {j.status} · {j.address}
          </p>
          <p>
            Order {j.orderId.slice(0, 8)} · Window {j.window.start} to {j.window.end} · Bags {j.bagIds.length}
          </p>
          {dispatchFlag(j) && <p className="warn">{dispatchFlag(j)}</p>}
          <button onClick={() => dispatch(j)} disabled={!riderId.trim() || !["REQUESTED", "BOOKED", "ASSIGNED"].includes(j.status)}>
            Assign and dispatch
          </button>
        </div>
      ))}
      {notice && <p>{notice}</p>}
    </div>
  );
}
