import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { v2 } from '@laundry/contracts';
import { apiV2 } from '../../api-v2';
import { colors } from '../../theme';
import { Card, Loading, NoteCard } from './ui';
import { describeError } from './presenters';
import { custodyView, deliveryLegView, formatTrackingTime, formatTrackingWindow, orderStatusView, recordedHistory } from './order-tracking';

// Keep the existing framed sheet, brand ink and teal on recorded facts only.
// One question: where is my laundry, and which handovers are actually recorded?
export function OrderTrackingCards({ order, events, readAt }: { order: v2.Order; events: v2.OrderTimelineEvent[]; readAt: string }) {
  const status = orderStatusView(order.status);
  const timezone = order.pickupWindow.timezone;
  const history = recordedHistory(events, timezone);
  return <>
    <Card title={status.title}>
      <Text style={[styles.body, status.attention && styles.attention]}>{status.detail}</Text>
      <Text style={styles.meta}>Last checked: {formatTrackingTime(readAt, timezone)} ({timezone}). Updates are not live; refresh to check again.</Text>
      <Text style={styles.label}>Scheduled pickup</Text>
      <Text style={styles.body}>{formatTrackingWindow(order.pickupWindow)}</Text>
      <Text style={styles.label}>Promised return window</Text>
      <Text style={styles.body}>{formatTrackingWindow(order.promisedReturnWindow)}</Text>
      <Text style={styles.meta}>These are scheduled windows, not a live arrival estimate. No rider location is being shown.</Text>
    </Card>
    <Card title="Pickup and return journeys">
      {(['PICKUP', 'RETURN'] as const).map(kind => {
        const leg = order.deliveryLegs.find(value => value.leg === kind);
        const view = leg ? deliveryLegView(leg) : null;
        return <View key={kind} style={styles.row}>
          <Text style={styles.label}>{kind === 'PICKUP' ? 'Pickup' : 'Return'}</Text>
          <Text style={styles.body}>{view?.detail ?? 'No dispatch record available. This does not confirm a rider booking.'}</Text>
          {view?.completedAt ? <Text style={styles.meta}>Completion recorded: {formatTrackingTime(view.completedAt, timezone)} ({timezone})</Text> : null}
        </View>;
      })}
    </Card>
    <Card title="Recorded history">
      <Text style={styles.meta}>Only recorded updates, in their original sequence. Times shown in {timezone}.</Text>
      {history.length === 0 ? <Text style={styles.body}>No timeline events have been recorded.</Text> : history.map((event, index) => <View key={`${event.at}:${index}`} style={styles.event}>
        <View style={styles.mark} />
        <View style={styles.eventText}>
          <Text style={styles.label}>{event.label}</Text>
          <Text style={styles.meta}>{event.time}</Text>
          {event.reason ? <Text style={styles.body}>{event.reason}</Text> : null}
        </View>
      </View>)}
    </Card>
  </>;
}

/** This read can fail without hiding the order, support or payment records. */
export function OrderCustodyCard({ orderId, timezone }: { orderId: string; timezone: string }) {
  const [receipt, setReceipt] = useState<v2.CustodyReceipt | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setError(null);
    apiV2.getCustodyReceipt(orderId).then(value => { if (active) setReceipt(value); }).catch(cause => { if (active) setError(cause); });
    return () => { active = false; };
  }, [orderId, revision]);
  const view = receipt ? custodyView(receipt) : null;
  return <>
    <Card title="Custody record">
      {!receipt && !error ? <Loading label="Loading custody record" /> : null}
      {view && receipt ? <>
        <Text style={styles.label}>{view.handoff}</Text>
        <Text style={styles.meta}>Record updated: {formatTrackingTime(receipt.updatedAt, timezone)} ({timezone}){error ? '. Last available record; refresh failed.' : ''}</Text>
        {([['Declared garments', view.declared], ['Counted at intake', view.counted], ['Measured weight', view.weight], ['Sealed containers', view.sealed]] as const).map(([label, value]) => <View key={label} style={styles.fact}>
          <Text style={styles.body}>{label}</Text><Text style={styles.value}>{value}</Text>
        </View>)}
        <Text style={styles.meta}>A custody entry is not a live location or proof of payment. Unrecorded quantities are not assumed to be zero.</Text>
      </> : null}
      {error && !receipt ? <Text style={styles.body}>Custody could not be loaded. No handover or quantities can be confirmed from this read.</Text> : null}
    </Card>
    {error ? <NoteCard kind="warning" title="Custody update unavailable" body={describeError(error).body} actionLabel="Retry custody" onAction={() => setRevision(value => value + 1)} /> : null}
  </>;
}
const styles = StyleSheet.create({
  body: { color: colors.ink, fontSize: 15, lineHeight: 22, marginTop: 6 },
  meta: { color: colors.inkMuted, fontSize: 13, lineHeight: 20, marginTop: 8 },
  label: { color: colors.ink, fontSize: 15, fontWeight: '600', lineHeight: 22, marginTop: 12 },
  attention: { color: colors.warning },
  row: { borderTopWidth: 1, borderColor: colors.border, marginTop: 12, paddingBottom: 4 },
  event: { flexDirection: 'row', gap: 12, marginTop: 12 },
  mark: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.action, marginTop: 19 },
  eventText: { flex: 1, borderBottomWidth: 1, borderColor: colors.border, paddingBottom: 12 },
  fact: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  value: { color: colors.ink, fontSize: 15, lineHeight: 22, marginTop: 6, fontVariant: ['tabular-nums'] },
});
