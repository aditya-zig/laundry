import { useEffect, useRef, useState, type FormEvent } from 'react';
import { v2 } from '@laundry/contracts';
import { isMutationOutcomePending, StorageError, type SessionFoundation } from '@laundry/app-foundation';
import { describeError } from './errors';
import { formatInstantInTz, shortId } from './format';
import { appendSupportPage, canStaffReply, checkedSupportPage, retainedStaffReply, type StaffReplyIntent } from './supportActions';

const limit = 25;

export function SupportConsole({ foundation, actorId }: { foundation: SessionFoundation; actorId: string }) {
  const [cases, setCases] = useState<v2.Page<v2.Incident> | null>(null);
  const [selected, setSelected] = useState<v2.Incident | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  useEffect(() => {
    const clear = foundation.registerPrivateCache(() => { epoch.current++; setCases(null); setSelected(null); setError(''); });
    return () => { epoch.current++; clear(); };
  }, [foundation]);

  async function load(more = false) {
    if (loading || busy) return;
    const sequence = ++epoch.current;
    setLoading(true); setError('');
    if (!more) setSelected(null);
    try {
      const page = checkedSupportPage(await foundation.authorized(client => client.listOpsIncidents({ limit, ...(more ? { cursor: cases?.pageInfo.nextCursor } : {}) })));
      if (sequence !== epoch.current) return;
      const next = more && cases ? appendSupportPage(cases, page) : page;
      setCases(next);
    } catch (cause) { if (sequence === epoch.current) setError(describeError(cause).message); }
    finally { if (sequence === epoch.current) setLoading(false); }
  }

  return <section className="ops-sheet" aria-label="Staff support console">
    <div className="ops-sheet-head"><h2 className="ops-h2">Customer support</h2>
      <button className="ops-ghost" type="button" disabled={loading || busy} onClick={() => void load()}>{cases ? 'Refresh support cases' : 'Load support cases'}</button>
    </div>
    <p className="ops-mini">Cases are listed by opening time, not unread priority. Refresh for a new server snapshot. Replies do not resolve cases, issue refunds or change order/delivery state.</p>
    {loading && <p role="status">Loading support cases…</p>}
    {error && <p className="ops-notice ops-notice-error" role="alert">Support read failed; this is not an empty queue. {error}</p>}
    {!cases && !loading && !error && <p>Load the server queue to open a case.</p>}
    {cases && <>
      {cases.items.length === 0 && !error && <p>No support cases were returned.</p>}
      <ul className="ops-list">{cases.items.map(incident => <li key={incident.id} style={{ overflowWrap: 'anywhere' }}>
        <button className="ops-ghost" type="button" disabled={loading || busy || !!error} aria-pressed={selected?.id === incident.id} onClick={() => setSelected(incident)}>{incident.summary}</button>
        <span className="ops-mini"> · {incident.category} · {incident.status} · case {shortId(incident.id)} · order {shortId(incident.orderId)}</span>
      </li>)}</ul>
      {cases.pageInfo.hasMore && <button className="ops-ghost" type="button" disabled={loading || busy || !!error} onClick={() => void load(true)}>Load more support cases</button>}
    </>}
    {selected && <StaffThread key={selected.id} foundation={foundation} actorId={actorId} incident={selected} onBusyChange={setBusy} />}
  </section>;
}

function StaffThread({ foundation, actorId, incident, onBusyChange }: {
  foundation: SessionFoundation; actorId: string; incident: v2.Incident; onBusyChange: (busy: boolean) => void;
}) {
  const [thread, setThread] = useState<v2.Page<v2.IncidentMessage> | null>(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<StaffReplyIntent | null>(null);
  const [readError, setReadError] = useState('');
  const [notice, setNotice] = useState('');
  const [reading, setReading] = useState(true);
  const [sending, setSending] = useState(false);
  const [reconcileOnly, setReconcileOnly] = useState(false);
  const live = useRef(true);
  const inFlight = useRef(false);
  const sequence = useRef(0);
  useEffect(() => { onBusyChange(reading || sending || pending !== null); return () => onBusyChange(false); }, [reading, sending, pending, onBusyChange]);

  async function load(more = false) {
    const started = ++sequence.current;
    setReading(true); setReadError('');
    try {
      const [raw, records] = await Promise.all([
        foundation.authorized(client => client.listIncidentMessages(incident.id, { limit, ...(more ? { cursor: thread?.pageInfo.nextCursor } : {}) })),
        foundation.listQueuedMutations(),
      ]);
      const page = checkedSupportPage(raw);
      if (page.items.some(message => message.incidentId !== incident.id)) throw new Error('The server thread did not match this case. Reload before replying.');
      const retained = retainedStaffReply(records, incident.id, actorId);
      const next = more && thread ? appendSupportPage(thread, page) : page;
      if (!live.current || started !== sequence.current) return;
      setThread(next); setPending(retained);
      if (retained) setDraft(retained.body.body);
    } catch (cause) { if (live.current && started === sequence.current) setReadError(describeError(cause).message); }
    finally { if (live.current && started === sequence.current) setReading(false); }
  }
  useEffect(() => { live.current = true; void load(); return () => { live.current = false; sequence.current++; }; }, [foundation, incident.id, actorId]);

  async function send(intent: StaffReplyIntent) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true); setNotice(''); setPending(intent);
    try {
      const reply = await foundation.enqueueMutation(intent);
      if (!live.current) return;
      if (reply.incidentId !== incident.id) {
        setNotice('The acknowledgement did not match this case. Reconcile the server thread; do not create a replacement reply.');
        return;
      }
      if (thread) setThread(appendSupportPage(thread, { items: [reply], pageInfo: { hasMore: false } }));
      setPending(null); setDraft(''); setNotice('Staff reply recorded. This does not close the case or change the order.');
    } catch (cause) {
      if (!live.current) return;
      const detail = describeError(cause);
      if (intent.retainedKey && cause instanceof StorageError) {
        setPending(intent); setReconcileOnly(true);
        setNotice('The retained key cannot be safely replayed. Reconcile the server thread; no replacement reply will be created.');
      } else if (isMutationOutcomePending(cause)) {
        let retained: StaffReplyIntent | null = null;
        try { retained = retainedStaffReply(await foundation.listQueuedMutations(), incident.id, actorId); } catch { /* Keep the original intent locked, never replace its key. */ }
        if (!live.current) return;
        setPending(retained ?? intent);
        setNotice(retained ? `Outcome not confirmed. Retry the retained reply, without editing it. ${detail.message}` : 'The original reply cannot be safely replayed here. Reconcile the server thread without creating a replacement.');
      } else {
        setPending(null); setNotice(`${detail.code}: ${detail.message}`); await load();
      }
    } finally { inFlight.current = false; if (live.current) setSending(false); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (reading || sending || readError || !canStaffReply(incident, thread, pending !== null)) return;
    const parsed = v2.incidentMessageInputSchema.safeParse({ body: draft, mediaIds: [] });
    if (!parsed.success) { setNotice('Enter a reply of 1–5,000 characters.'); return; }
    void send({ routeId: 'support.incidents.messages', params: { incidentId: incident.id }, body: parsed.data });
  }
  const allowed = !reading && !sending && !readError && canStaffReply(incident, thread, pending !== null);
  return <section className="ops-command-panel" aria-label="Staff support thread">
    <h3 className="ops-h3">{incident.summary}</h3>
    <p className="ops-mini">Case {incident.id} · status when opened: {incident.status}, version {incident.version}. Times: Asia/Kolkata. Keep this console open until uncertain replies are reconciled.</p>
    {incident.detail && <p style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{incident.detail}</p>}
    {incident.mediaIds.length > 0 && <p>{incident.mediaIds.length} media reference(s); media viewing is not provided by this text console.</p>}
    {notice && <p className="ops-notice" role="status">{notice}</p>}
    {pending && <div className="ops-notice" role="alert"><p>A retained reply needs reconciliation. Case switching and new replies stay locked.</p>
      <p style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{pending.body.body}</p>
      <button className="ops-primary" type="button" disabled={sending || reconcileOnly || !pending.retainedKey} onClick={() => void send(pending)}>Retry retained staff reply</button>
    </div>}
    {reading && <p role="status">Loading case messages…</p>}
    {readError && <p className="ops-notice ops-notice-error" role="alert">Messages could not be read; this is not an empty conversation. {readError}</p>}
    {thread && !readError && <>
      {thread.items.length === 0 && <p>No messages recorded yet.</p>}
      <ol className="ops-list">{thread.items.map(message => <li key={message.id} style={{ overflowWrap: 'anywhere' }}><span className="ops-mini">{message.authorRole} · <time dateTime={message.createdAt}>{formatInstantInTz(message.createdAt, 'Asia/Kolkata')}</time></span><p style={{ whiteSpace: 'pre-wrap' }}>{message.body}</p>{message.mediaIds.length > 0 && <span className="ops-mini">{message.mediaIds.length} media reference(s)</span>}</li>)}</ol>
      {thread.pageInfo.hasMore && <><p>Load the remaining messages before replying.</p><button className="ops-ghost" type="button" disabled={reading || sending || pending !== null} onClick={() => void load(true)}>Load more case messages</button></>}
    </>}
    <button className="ops-ghost" type="button" disabled={reading || sending || pending !== null} onClick={() => void load()}>Refresh case messages</button>
    {!['RESOLVED', 'REJECTED'].includes(incident.status) ? <form className="ops-form" onSubmit={submit}>
      <label className="ops-label" htmlFor={`staff-reply-${incident.id}`}>Staff reply</label>
      <textarea id={`staff-reply-${incident.id}`} className="ops-input" rows={3} maxLength={5000} value={draft} disabled={!allowed} onChange={event => setDraft(event.target.value)} />
      <button className="ops-primary" type="submit" disabled={!allowed || draft.trim().length === 0}>Send staff reply</button>
    </form> : <p>This case is closed. This console cannot reopen it.</p>}
  </section>;
}
