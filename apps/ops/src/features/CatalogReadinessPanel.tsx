import { useEffect, useState } from 'react';
import type { SessionFoundation } from '@laundry/app-foundation';
import { loadCatalogReadiness, type CatalogReadinessRow } from './catalogReadiness';
import { describeError, type PresentableError } from './errors';
import { formatInrMinor } from './format';

type ReadState = { kind: 'loading' } | { kind: 'error'; error: PresentableError } | { kind: 'ready'; rows: CatalogReadinessRow[] };

export function CatalogReadinessPanel({ foundation }: { foundation: SessionFoundation }) {
  const [open, setOpen] = useState(false), [revision, setRevision] = useState(0);
  const [state, setState] = useState<ReadState>({ kind: 'loading' });
  useEffect(() => {
    if (!open) return;
    let active = true; setState({ kind: 'loading' });
    void foundation.authorized(loadCatalogReadiness).then(rows => {
      if (active) setState({ kind: 'ready', rows });
    }).catch(error => { if (active) setState({ kind: 'error', error: describeError(error) }); });
    return () => { active = false; };
  }, [foundation, open, revision]);
  return <details className="ops-sheet" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="ops-h2">Service and price configuration</summary>
    {open && <section aria-label="Catalog and effective rates">
      <p className="ops-mini">Read-only published service records and current server rates. Drafts and publishing are not available here.</p>
      <button type="button" className="ops-ghost" disabled={state.kind === 'loading'} onClick={() => setRevision(value => value + 1)}>Refresh catalog and rates</button>
      {state.kind === 'loading' && <p role="status">Loading catalog and rates…</p>}
      {state.kind === 'error' && <p role="alert">Catalog records unavailable. {state.error.code}: {state.error.message}{state.error.traceId ? ` (trace ${state.error.traceId})` : ''}</p>}
      {state.kind === 'ready' && (state.rows.length === 0
        ? <p>No services in the returned catalog.</p>
        : <>
        {state.rows.some(row => row.rate.kind === 'ready' && row.rate.value.synthetic) && <p className="ops-notice ops-notice-error" role="note">Demo rates shown — not approved launch pricing.</p>}
        <p className="ops-mini ops-muted">On narrow screens, scroll the table sideways to read rate provenance.</p>
        <div className="ops-scroll" role="region" aria-label="Service rates table" tabIndex={0}><table className="ops-table">
          <thead><tr><th>Service</th><th>Billing</th><th>Effective rate</th><th>Rate provenance</th></tr></thead>
          <tbody>{state.rows.map(({ service, rate }) => <tr key={service.id}>
            <td><strong>{service.name}</strong><br />{service.code} · v{service.version} · {service.active ? 'Active service record' : 'Inactive'}</td>
            <td>{service.billingUnit} · {service.turnaroundHours} h server target</td>
            <td>{rate.kind === 'ready' ? `${formatInrMinor(rate.value.unitPriceMinor)} · ${rate.value.unitLabel}` : rate.kind === 'unpublished' ? 'No effective rate returned' : 'Effective rate unavailable — refresh to retry'}</td>
            <td>{rate.kind !== 'ready' ? 'Unverified' : rate.value.synthetic ? 'Demo rate — not approved launch pricing' : 'Server rate; launch approval not inferred'}</td>
          </tr>)}</tbody>
        </table></div></>)}
      <p className="ops-mini ops-muted">An active service or a returned rate does not prove publication readiness. Image licensing evidence is not returned by these APIs. This view cannot approve prices, publish services or enable ordering.</p>
    </section>}
  </details>;
}
