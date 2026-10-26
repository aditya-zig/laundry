import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { v2 } from '@laundry/contracts';
import { getFoundation } from '../../api-v2';
import { formatINR } from '../../guards';
import { colors, minTouchTarget } from '../../theme';
import { appendBillingPage, checkedBillingPage, obligationView, receiptLabel, refundLabel } from './order-billing';
import { describeError } from './presenters';
import { Card, Loading, NoteCard } from './ui';

type Pages = { obligations: v2.Page<v2.Obligation>; receipts: v2.Page<v2.Receipt>; refunds: v2.Page<v2.Refund> };
type Lane = keyof Pages;
const pageSize = 20;
const rowStyle = { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderColor: colors.border };
const ink = { color: colors.ink, marginTop: 6 };

/** Read-only owned ledger: never derive collection or a refund from order delivery. */
export function OrderBillingCard({ orderId }: { orderId: string }) {
  const [pages, setPages] = useState<Pages | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0), [loading, setLoading] = useState<Lane | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    let active = true; alive.current = true; setPages(null); setNotice(null);
    getFoundation().authorized(async client => {
      const [obligations, receipts, refunds] = await Promise.all([
        client.listOrderObligations(orderId, { limit: pageSize }),
        client.listOrderReceipts(orderId, { limit: pageSize }),
        client.listOrderRefunds(orderId, { limit: pageSize }),
      ]);
      return { obligations: checkedBillingPage(obligations), receipts: checkedBillingPage(receipts), refunds: checkedBillingPage(refunds) };
    }).then(value => { if (active) setPages(value); }).catch(error => { if (active) setNotice(describeError(error).body); });
    return () => { active = false; alive.current = false; };
  }, [orderId, revision]);

  async function loadMore(lane: Lane) {
    const cursor = pages?.[lane].pageInfo.nextCursor;
    if (!pages || loading || !pages[lane].pageInfo.hasMore || !cursor) return;
    setLoading(lane); setNotice(null);
    try {
      if (lane === 'obligations') {
        const next = await getFoundation().authorized(client => client.listOrderObligations(orderId, { cursor, limit: pageSize }));
        const merged = appendBillingPage(pages.obligations, next);
        if (alive.current) setPages(old => old ? { ...old, obligations: merged } : old);
      } else if (lane === 'receipts') {
        const next = await getFoundation().authorized(client => client.listOrderReceipts(orderId, { cursor, limit: pageSize }));
        const merged = appendBillingPage(pages.receipts, next);
        if (alive.current) setPages(old => old ? { ...old, receipts: merged } : old);
      } else {
        const next = await getFoundation().authorized(client => client.listOrderRefunds(orderId, { cursor, limit: pageSize }));
        const merged = appendBillingPage(pages.refunds, next);
        if (alive.current) setPages(old => old ? { ...old, refunds: merged } : old);
      }
    } catch (error) { if (alive.current) setNotice(describeError(error).body); }
    finally { if (alive.current) setLoading(null); }
  }
  const more = (lane: Lane, label: string) => pages?.[lane].pageInfo.hasMore ? <Pressable
    accessibilityRole="button" accessibilityState={{ disabled: loading !== null }} disabled={loading !== null}
    onPress={() => void loadMore(lane)} style={{ minHeight: minTouchTarget, marginTop: 12, padding: 12, borderRadius: 8, backgroundColor: colors.action }}>
    <Text style={{ color: colors.surface, fontWeight: '700', textAlign: 'center' }}>{loading === lane ? 'Loading records…' : label}</Text>
  </Pressable> : null;
  return <Card title="Recorded payments">
    <Text style={{ color: colors.inkMuted, marginTop: 8 }}>Obligations, receipts and refunds are separate server records. Delivery or a pay-on-return arrangement is not proof of collection. This screen cannot take a payment, request a refund or mark delivery complete.</Text>
    <Text style={{ color: colors.inkMuted, marginTop: 8 }}>For pay-on-return, final billing is reconciled after a passed quality check, before dispatch. Before that, the recorded obligation can still show the booking amount rather than a newly accepted care total. Do not treat that earlier amount as the final bill.</Text>
    <NoteCard kind="note" title="Read the latest ledger" actionLabel="Refresh payment records" actionDisabled={loading !== null || (!pages && !notice)} onAction={() => setRevision(value => value + 1)} />
    {notice ? <NoteCard kind="warning" title="Payment records unavailable or incomplete" body={`${notice} No payment or zero balance is inferred from missing records.`} /> : null}
    {!pages && !notice ? <Loading label="Reading owned payment records" /> : null}
    {pages ? <>
      <Text accessibilityRole="header" style={{ ...ink, fontWeight: '700' }}>Obligations</Text>
      {pages.obligations.items.map(value => { const view = obligationView(value); return <View key={value.id} style={rowStyle}>
        <Text style={ink}>{view.label}</Text><Text style={ink}>Obligation {value.id} · Version {value.version}</Text>
        <Text style={ink}>Recorded amount due: {formatINR(value.amountDueMinor)} · Recorded settlement: {formatINR(value.amountSettledMinor)}</Text>
        <Text style={ink}>Recorded outstanding: {formatINR(view.remainingMinor)}</Text>
        <Text style={ink}>Due: {new Date(value.dueAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</Text>
        {value.voidReason ? <Text style={ink}>Void reason: {value.voidReason}</Text> : null}
      </View>; })}
      {!pages.obligations.items.length ? <Text style={ink}>No obligations in the loaded records. This does not confirm zero due or payment.</Text> : null}
      {more('obligations', 'Load more payment obligations')}
      <Text accessibilityRole="header" style={{ ...ink, fontWeight: '700', marginTop: 18 }}>Receipts</Text>
      {pages.receipts.items.map(value => <View key={value.id} style={rowStyle}>
        <Text style={ink}>{receiptLabel(value.confirmedVia)} · {formatINR(value.amountMinor)}</Text>
        <Text style={ink}>Receipt {value.id} · Obligation {value.obligationId}</Text>
        <Text style={ink}>Method: {value.method} · {new Date(value.issuedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</Text>
        {value.externalReference ? <Text style={ink}>Recorded reference: {value.externalReference}</Text> : null}
      </View>)}
      {!pages.receipts.items.length ? <Text style={ink}>No receipts in the loaded records.</Text> : null}
      {more('receipts', 'Load more payment receipts')}
      <Text accessibilityRole="header" style={{ ...ink, fontWeight: '700', marginTop: 18 }}>Refunds</Text>
      <Text style={{ color: colors.inkMuted, marginTop: 6 }}>A requested, processing or unconfirmed refund is not proof of returned funds. Refund records do not erase the original receipt.</Text>
      {pages.refunds.items.map(value => <View key={value.id} style={rowStyle}>
        <Text style={ink}>{refundLabel(value.status)} · {formatINR(value.amountMinor)}</Text>
        <Text style={ink}>Refund {value.id}</Text><Text style={ink}>Recorded reason: {value.reason}</Text>
        {value.externalReference ? <Text style={ink}>Recorded reference: {value.externalReference}</Text> : null}
      </View>)}
      {!pages.refunds.items.length ? <Text style={ink}>No refunds in the loaded records.</Text> : null}
      {more('refunds', 'Load more refund records')}
    </> : null}
  </Card>;
}
