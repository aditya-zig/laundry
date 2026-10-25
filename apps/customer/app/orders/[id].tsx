import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Text } from "react-native";
import type { v2 } from "@laundry/contracts";
import { apiV2 } from "../../src/api-v2";
import { CustomerPrivateScreen } from "../../src/features/booking/CustomerPrivateScreen";
import { describeError } from "../../src/features/booking/presenters";
import { Card, Loading, NoteCard, Page } from "../../src/features/booking/ui";
import { formatINR } from "../../src/guards";
import { colors } from "../../src/theme";

export default function OrderDetails() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = typeof params.id === "string" ? params.id : "";
  return <Page title="Order details"><CustomerPrivateScreen><OwnedDetail key={id} id={id} /></CustomerPrivateScreen></Page>;
}

function OwnedDetail({ id }: { id: string }) {
  const [data, setData] = useState<{ order: v2.Order; events: v2.OrderTimelineEvent[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null); setError(null);
    Promise.all([apiV2.getOrder(id), apiV2.getOrderTimeline(id)]).then(([order, events]) => { if (active) setData({ order, events }); }).catch(cause => { if (active) setError(cause); });
    return () => { active = false; };
  }, [id, revision]);
  if (error) return <NoteCard kind="error" title={describeError(error).title} body={describeError(error).body} actionLabel="Retry" onAction={() => setRevision(value => value + 1)} />;
  if (!data) return <Loading label="Loading owned order" />;
  const { order, events } = data;
  return <>
    <Card title={order.status.replaceAll("_", " ")}>
      <Text style={{ color: colors.ink, marginTop: 8 }}>Order {order.id}</Text>
      <Text style={{ color: colors.ink, marginTop: 8 }}>{formatINR(order.totalMinor)} · {order.paymentModel === "DUE_AT_RETURN" ? "Payment due at return" : "Prepaid order"}</Text>
      <Text style={{ color: colors.inkMuted, marginTop: 8 }}>Scheduled pickup: {order.pickupWindow.start} — {order.pickupWindow.end}</Text>
      <Text style={{ color: colors.inkMuted, marginTop: 8 }}>Promised return: {order.promisedReturnWindow.start} — {order.promisedReturnWindow.end}</Text>
    </Card>
    <Card title="Recorded history">
      {events.length === 0 ? <Text style={{ color: colors.inkMuted }}>No timeline events have been recorded.</Text> : events.map((event, index) => <Text key={`${event.at}:${event.status}:${index}`} style={{ color: colors.ink, marginTop: 12 }}>{event.label}{"\n"}{event.at}{event.reason ? `\n${event.reason}` : ""}</Text>)}
    </Card>
    <NoteCard kind="note" title="Authoritative order record" body="A scheduled return is not a custody receipt or proof of payment. No rider location is simulated here. Adjustment decisions, rescheduling, cancellation, payment detail and reviews are not yet connected on this screen." actionLabel="Refresh" onAction={() => setRevision(value => value + 1)} />
  </>;
}
