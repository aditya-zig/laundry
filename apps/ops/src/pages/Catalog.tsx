import { useEffect, useState } from "react";
import type { Service } from "@laundry/contracts";
import { getClient } from "../api";
import { catalogPublishBlocked, formatINR } from "../guards";

export function CatalogPage() {
  const [services, setServices] = useState<Service[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getClient().listServices().then(setServices).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, []);

  if (error) return <p className="err">{error}</p>;
  if (!services) return <p>Loading catalog…</p>;
  return (
    <div>
      <h2>Service and price configuration</h2>
      <p>Price card versions are immutable once quoted. Drafts cannot publish without licensed images and rate data.</p>
      {services.map((s) => {
        const blocked = catalogPublishBlocked({ imageUrl: s.imageUrl, imageLicense: "pending-attribution", priceMinor: s.priceMinor });
        return (
          <div key={s.id} className="card">
            <p>
              <strong>{s.name}</strong> · {s.priceUnit} · {formatINR(s.priceMinor)}
            </p>
            <p>{s.description}</p>
            {blocked ? <p className="warn">{blocked}</p> : <p>Publishable: licensed image and rate present.</p>}
          </div>
        );
      })}
    </div>
  );
}
