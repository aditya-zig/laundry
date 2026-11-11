import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { v2 } from '@laundry/contracts';
import { isMutationOutcomePending } from '@laundry/app-foundation';
import { getFoundation } from '../../api-v2';
import { colors, minTouchTarget } from '../../theme';
import { incidentFor, incidentMessageFor, pendingSupport } from './order-support';
import { describeError } from './presenters';
import { Card, Loading, NoteCard } from './ui';

type Pending = ReturnType<typeof pendingSupport>;
const pageSize = 20;
const mergePage = <T extends { id: string }>(previous: T[], next: T[]) => [...new Map([...previous, ...next].map(value => [value.id, value])).values()];
const categoryLabels: Record<v2.IncidentCategory, string> = { DAMAGED: 'Damaged item', MISSING: 'Missing item', LATE: 'Late delivery', QUALITY: 'Care quality', BILLING: 'Payment', OTHER: 'Other concern' };
const fieldStyle = { minHeight: minTouchTarget, marginTop: 8, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, color: colors.ink, textAlignVertical: 'top' as const };

export function OrderSupportCard({ orderId }: { orderId: string }) {
  const [cases, setCases] = useState<v2.Incident[]>([]), [selected, setSelected] = useState<v2.Incident | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(), [more, setMore] = useState(false);
  const [category, setCategory] = useState(''), [summary, setSummary] = useState(''), [detail, setDetail] = useState('');
  const [pending, setPending] = useState<Pending['incident']>(null);
  const [ready, setReady] = useState(false), [reading, setReading] = useState(false), [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false);
  const [notice, setNotice] = useState<string | null>(null), [revision, setRevision] = useState(0);
  const alive = useRef(true), sending = useRef(false);
  useEffect(() => {
    let active = true; alive.current = true; setReady(false); setNotice(null);
    Promise.all([getFoundation().authorized(client => client.listIncidents({ limit: pageSize })), getFoundation().listQueuedMutations()]).then(([page, records]) => {
      if (!active) return;
      const original = pendingSupport(records, orderId).incident;
      setCases(page.items); setCursor(page.pageInfo.nextCursor); setMore(page.pageInfo.hasMore); setPending(original); setBlocked(previous => previous && !original); setReady(true);
    }).catch(error => { if (active) setNotice(describeError(error).body); });
    return () => { active = false; alive.current = false; };
  }, [orderId, revision]);

  async function loadMore() {
    if (reading || !more || !cursor) return;
    setReading(true); setNotice(null);
    try {
      const page = await getFoundation().authorized(client => client.listIncidents({ cursor, limit: pageSize }));
      if (alive.current) { setCases(previous => mergePage(previous, page.items)); setCursor(page.pageInfo.nextCursor); setMore(page.pageInfo.hasMore); }
    } catch (error) { if (alive.current) setNotice(describeError(error).body); }
    finally { if (alive.current) setReading(false); }
  }
  async function submit() {
    if (sending.current || !ready || blocked) return;
    let intent: { body: v2.IncidentInput } | NonNullable<Pending['incident']>;
    try { intent = pending ?? { body: incidentFor(orderId, { category, summary, detail }) }; }
    catch { setNotice('Select a category and enter a summary. Summary and optional details must each be within 2,000 characters.'); return; }
    sending.current = true; setBusy(true); setNotice(null);
    try {
      const value = await getFoundation().enqueueMutation({ routeId: 'support.incidents.create', ...intent });
      if (alive.current) { setPending(null); setCategory(''); setSummary(''); setDetail(''); setSelected(value); }
    } catch (error) {
      if (!alive.current) return;
      if (isMutationOutcomePending(error)) {
        try {
          const original = pendingSupport(await getFoundation().listQueuedMutations(), orderId).incident;
          if (!original) throw new Error('Original case intent unavailable');
          if (alive.current) { setPending(original); setNotice('The case result is unconfirmed. Check the original request below; do not open a replacement or reload this memory-only session.'); }
        } catch { if (alive.current) { setBlocked(true); setNotice('The original request could not be recovered safely. Reconcile the server case before opening another; no replacement was created.'); } }
      } else { setPending(null); setReady(false); setNotice(`${describeError(error).body} Refresh support cases before trying again.`); }
    } finally { sending.current = false; if (alive.current) setBusy(false); }
  }

  if (selected) return <SupportThread key={selected.id} incident={selected} orderId={orderId} onBack={() => { setSelected(null); setRevision(value => value + 1); }} />;
  const ownedCases = cases.filter(value => value.orderId === orderId);
  return <Card title="Support for this order">
    <Text style={{ color: colors.inkMuted, marginTop: 8 }}>Cases and replies are saved here. Opening a case does not change your order or issue a refund. Photos and automated SMS/WhatsApp notifications are not connected on this screen.</Text>
    {notice ? <NoteCard kind="warning" title="Support status" body={notice} /> : null}
    {!ready && !notice ? <Loading label="Reading your support cases" /> : null}
    <Action label="Refresh support cases" disabled={busy || reading} onPress={() => setRevision(value => value + 1)} />
    {ownedCases.map(value => <View key={value.id} style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: colors.ink, fontWeight: '700' }}>{value.summary}</Text>
      <Text style={{ color: colors.inkMuted, marginTop: 4 }}>{categoryLabels[value.category]} · {value.status} · Case {value.id}</Text>
      <Action label={`Open case: ${value.summary}`} disabled={busy} onPress={() => setSelected(value)} />
    </View>)}
    {ready && !pending && !busy && !blocked && ownedCases.length === 0 ? <Text style={{ color: colors.inkMuted, marginTop: 12 }}>{more ? 'No case for this order in the pages loaded so far. Load more saved cases to check the rest.' : 'No support cases are recorded for this order.'}</Text> : null}
    {more ? <Action label={reading ? 'Loading cases…' : 'Load more saved cases'} disabled={reading || busy} onPress={() => void loadMore()} /> : null}
    {ready ? pending ? <>
      <Text style={{ color: colors.ink, marginTop: 16, fontWeight: '700' }}>Original case request</Text>
      <Text style={{ color: colors.ink, marginTop: 8 }}>{categoryLabels[pending.body.category]}: {pending.body.summary}</Text>
      {pending.body.detail ? <Text style={{ color: colors.ink, marginTop: 8 }}>{pending.body.detail}</Text> : null}
      {pending.body.mediaIds.length ? <Text style={{ color: colors.inkMuted, marginTop: 8 }}>Retained attachments: {pending.body.mediaIds.length}</Text> : null}
      <Action label={busy ? 'Checking original case…' : 'Check original support case'} disabled={busy || blocked} onPress={() => void submit()} />
    </> : !blocked ? <>
      <Text style={{ color: colors.ink, marginTop: 16, fontWeight: '700' }}>Open a support case</Text>
      <Text style={{ color: colors.ink, marginTop: 12 }}>Category (required)</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {v2.incidentCategorySchema.options.map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={categoryLabels[value]} accessibilityState={{ checked: category === value, disabled: busy }} disabled={busy} onPress={() => setCategory(value)} style={{ minHeight: minTouchTarget, padding: 12, borderRadius: 8, backgroundColor: category === value ? colors.action : colors.surface, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' }}><Text style={{ color: category === value ? colors.surface : colors.ink }}>{categoryLabels[value]}</Text></Pressable>)}
      </View>
      <Text style={{ color: colors.ink, marginTop: 12 }}>Summary (required, up to 2,000 characters)</Text>
      <TextInput accessibilityLabel="Support case summary" value={summary} onChangeText={setSummary} editable={!busy} maxLength={2000} multiline style={fieldStyle} />
      <Text style={{ color: colors.ink, marginTop: 12 }}>More details (optional, up to 2,000 characters)</Text>
      <TextInput accessibilityLabel="Support case details" value={detail} onChangeText={setDetail} editable={!busy} maxLength={2000} multiline style={{ ...fieldStyle, minHeight: 90 }} />
      <Action label={busy ? 'Opening support case…' : 'Open support case'} disabled={busy || !category || !summary.trim()} onPress={() => void submit()} />
    </> : <Text style={{ color: colors.inkMuted, marginTop: 12 }}>New requests are blocked until the original command is reconciled.</Text> : null}
  </Card>;
}

function SupportThread({ incident, orderId, onBack }: { incident: v2.Incident; orderId: string; onBack: () => void }) {
  const [messages, setMessages] = useState<v2.IncidentMessage[]>([]), [confirmed, setConfirmed] = useState<v2.IncidentMessage | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(), [more, setMore] = useState(false), [text, setText] = useState('');
  const [pending, setPending] = useState<Pending['message']>(null);
  const [ready, setReady] = useState(false), [reading, setReading] = useState(false), [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false);
  const [notice, setNotice] = useState<string | null>(null), [revision, setRevision] = useState(0);
  const alive = useRef(true), sending = useRef(false);
  useEffect(() => {
    let active = true; alive.current = true; setReady(false); setNotice(null);
    Promise.all([getFoundation().authorized(client => client.listIncidentMessages(incident.id, { limit: pageSize })), getFoundation().listQueuedMutations()]).then(([page, records]) => {
      if (!active) return;
      const original = pendingSupport(records, orderId, incident.id).message;
      setMessages(page.items); setCursor(page.pageInfo.nextCursor); setMore(page.pageInfo.hasMore); setPending(original); setBlocked(previous => previous && !original); setReady(true);
    }).catch(error => { if (active) setNotice(describeError(error).body); });
    return () => { active = false; alive.current = false; };
  }, [incident.id, orderId, revision]);
  async function loadMore() {
    if (reading || !more || !cursor) return;
    setReading(true); setNotice(null);
    try {
      const page = await getFoundation().authorized(client => client.listIncidentMessages(incident.id, { cursor, limit: pageSize }));
      if (alive.current) { setMessages(previous => mergePage(previous, page.items)); setCursor(page.pageInfo.nextCursor); setMore(page.pageInfo.hasMore); }
    } catch (error) { if (alive.current) setNotice(describeError(error).body); }
    finally { if (alive.current) setReading(false); }
  }
  async function submit() {
    if (sending.current || !ready || blocked) return;
    let intent: { body: v2.IncidentMessageInput; params: { incidentId: string } } | NonNullable<Pending['message']>;
    try { intent = pending ?? { body: incidentMessageFor(text), params: { incidentId: incident.id } }; }
    catch { setNotice('Enter a message within 5,000 characters.'); return; }
    sending.current = true; setBusy(true); setNotice(null);
    try {
      const value = await getFoundation().enqueueMutation({ routeId: 'support.incidents.messages', ...intent });
      if (alive.current) { setConfirmed(value); setText(''); setPending(null); if (!more) setMessages(previous => mergePage(previous, [value])); }
    } catch (error) {
      if (!alive.current) return;
      if (isMutationOutcomePending(error)) {
        try {
          const original = pendingSupport(await getFoundation().listQueuedMutations(), orderId, incident.id).message;
          if (!original) throw new Error('Original message intent unavailable');
          if (alive.current) { setPending(original); setNotice('The message result is unconfirmed. Check the original message below; do not send replacement text or reload this memory-only session.'); }
        } catch { if (alive.current) { setBlocked(true); setNotice('The original message could not be recovered safely. Reconcile the server case before sending another; no replacement was created.'); } }
      } else { setPending(null); setReady(false); setNotice(`${describeError(error).body} Refresh messages before trying again.`); }
    } finally { sending.current = false; if (alive.current) setBusy(false); }
  }
  return <Card title="Support conversation">
    <Text style={{ color: colors.ink, marginTop: 8, fontWeight: '700' }}>{incident.summary}</Text>
    <Text style={{ color: colors.inkMuted, marginTop: 8 }}>Case {incident.id} · Status when opened: {incident.status}</Text>
    {incident.detail ? <Text style={{ color: colors.ink, marginTop: 8 }}>{incident.detail}</Text> : null}
    {incident.resolution ? <NoteCard kind="note" title="Recorded resolution" body={incident.resolution} /> : null}
    <Action label="Back to support cases" disabled={busy || reading} onPress={onBack} />
    <Action label="Refresh case messages" disabled={busy || reading} onPress={() => setRevision(value => value + 1)} />
    {notice ? <NoteCard kind="warning" title="Support message status" body={notice} /> : null}
    {confirmed ? <NoteCard kind="note" title="Message recorded" body={`Message ${confirmed.id}: ${confirmed.body}`} /> : null}
    {!ready && !notice ? <Loading label="Reading case messages" /> : null}
    {messages.map(value => <View key={value.id} style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: colors.inkMuted }}>{value.authorRole} · {new Date(value.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</Text>
      <Text style={{ color: colors.ink, marginTop: 4 }}>{value.body}</Text>
      {value.mediaIds.length ? <Text style={{ color: colors.inkMuted, marginTop: 4 }}>Saved attachments: {value.mediaIds.length}. Media viewing is not connected here.</Text> : null}
    </View>)}
    {ready && !pending && !busy && !blocked && messages.length === 0 ? <Text style={{ color: colors.inkMuted, marginTop: 12 }}>No messages in this case yet.</Text> : null}
    {more ? <Action label={reading ? 'Loading messages…' : 'Load more case messages'} disabled={busy || reading} onPress={() => void loadMore()} /> : null}
    {ready ? pending ? <>
      <Text style={{ color: colors.ink, marginTop: 16, fontWeight: '700' }}>Original unconfirmed message</Text>
      <Text style={{ color: colors.ink, marginTop: 8 }}>{pending.body.body}</Text>
      {pending.body.mediaIds.length ? <Text style={{ color: colors.inkMuted, marginTop: 8 }}>Retained attachments: {pending.body.mediaIds.length}</Text> : null}
      <Action label={busy ? 'Checking original message…' : 'Check original support message'} disabled={busy || blocked} onPress={() => void submit()} />
    </> : !blocked ? <>
      <Text style={{ color: colors.ink, marginTop: 16 }}>Message (up to 5,000 characters)</Text>
      <TextInput accessibilityLabel="Support case message" value={text} onChangeText={setText} editable={!busy} maxLength={5000} multiline style={{ ...fieldStyle, minHeight: 90 }} />
      <Text style={{ color: colors.inkMuted, marginTop: 8 }}>A message does not reopen or resolve the case, alter your order, or issue a refund.</Text>
      <Action label={busy ? 'Saving message…' : 'Send support message'} disabled={busy || !text.trim()} onPress={() => void submit()} />
    </> : <Text style={{ color: colors.inkMuted, marginTop: 12 }}>Sending is blocked until the original message is reconciled.</Text> : null}
  </Card>;
}
function Action({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={{ minHeight: minTouchTarget, marginTop: 12, padding: 12, borderRadius: 8, backgroundColor: colors.action, justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}><Text style={{ color: colors.surface, fontWeight: '700', textAlign: 'center' }}>{label}</Text></Pressable>;
}
