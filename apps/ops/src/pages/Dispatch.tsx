import { useEffect, useState } from "react";
import type { DeliveryJob } from "@wandary/contracts";
import { getClient } from "../api";
import { dispatchFlag } from "../guards";

export function DispatchPage() {
  const [jobs, setJobs] = useState<DeliveryJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    setError(null);
    getClient()
      .listOpsDeliveries()
      .then(setJobs)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load deliveries"));
  }
  useEffect(load, []);

  async function dispatch(id: string) {
    setNotice(null);
    try {
      const next = await getClient().dispatchDelivery(id);
      setJobs((js) => (js ?? []).map((j) => (j.id === id ? next : j)));
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
      {jobs.map((j) => (
        <div key={j.id} className="card">
          <p>
            <strong>{j.leg}</strong> · {j.status} · {j.address}
          </p>
          <p>
            Window {j.window.start} to {j.window.end} · Bags {j.bagIds.length}
          </p>
          {dispatchFlag(j) && <p className="warn">{dispatchFlag(j)}</p>}
          <button onClick={() => dispatch(j.id)} disabled={j.status === "BOOKING_UNKNOWN"}>
            Dispatch
          </button>
        </div>
      ))}
      {notice && <p>{notice}</p>}
    </div>
  );
}
