import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Text } from "react-native";
import type { v2 } from "@laundry/contracts";
import { apiV2 } from "../../src/api-v2";
import { CustomerPrivateScreen } from "../../src/features/booking/CustomerPrivateScreen";
import { AdjustmentDecisionCard } from "../../src/features/booking/AdjustmentDecisionCard";
import { OrderReviewCard } from "../../src/features/booking/OrderReviewCard";
import { OrderSupportCard } from "../../src/features/booking/OrderSupportCard";
import { OrderBillingCard } from "../../src/features/booking/OrderBillingCard";
import { OrderCustodyCard, OrderTrackingCards } from "../../src/features/booking/OrderTrackingCards";
import { checkedTrackingSnapshot } from "../../src/features/booking/order-tracking";
import { paymentModelLabel } from "../../src/features/booking/order-billing";
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
  const [data, setData] = useState<{ order: v2.Order; events: v2.OrderTimelineEvent[]; readAt: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setError(null); setRefreshing(true);
    Promise.all([apiV2.getOrder(id), apiV2.getOrderTimeline(id)]).then(([order, events]) => {
      if (active) setData({ ...checkedTrackingSnapshot(order, events), readAt: new Date().toISOString() });
    }).catch(cause => { if (active) setError(cause); }).finally(() => { if (active) setRefreshing(false); });
    return () => { active = false; };
  }, [id, revision]);
  if (!data) return error ? <NoteCard kind="error" title={describeError(error).title} body={describeError(error).body} actionLabel="Retry" onAction={() => setRevision(value => value + 1)} /> : <Loading label="Loading owned order" />;
  const { order, events, readAt } = data;
  return <>
    {error ? <NoteCard kind="warning" title="Order update unavailable" body={`Showing the last available record, not a current confirmation. ${describeError(error).body} Refresh before making a decision or review.`} actionLabel="Retry order update" onAction={() => setRevision(value => value + 1)} /> : null}
    {refreshing ? <Loading label="Refreshing order record" /> : null}
    <OrderTrackingCards order={order} events={events} readAt={readAt} />
    <Card title="Order total">
      <Text style={{ color: colors.ink, marginTop: 8 }}>Order {order.id}</Text>
      <Text style={{ color: colors.ink, marginTop: 8 }}>{formatINR(order.totalMinor)} · {paymentModelLabel(order.paymentModel)}</Text>
      <Text style={{ color: colors.inkMuted, marginTop: 8 }}>An order total or delivery update is not proof of payment. See the payment records below.</Text>
    </Card>
    {!error && !refreshing ? <AdjustmentDecisionCard key={`${order.id}:${order.version}`} order={order} onUpdated={() => setRevision(value => value + 1)} /> : null}
    {/* Re-read independent projections after a successful refresh, even without a version change. */}
    <OrderCustodyCard key={`custody:${order.id}:${readAt}`} orderId={order.id} timezone={order.pickupWindow.timezone} />
    <OrderBillingCard key={`billing:${order.id}:${readAt}`} orderId={order.id} />
    {!error && !refreshing ? <OrderReviewCard key={order.id} order={order} /> : null}
    <OrderSupportCard key={`support:${order.id}`} orderId={order.id} />
    <NoteCard kind="note" title="Check for updates" body="Rescheduling and cancellation are not yet connected on this screen. Payment records are read-only and do not initiate collection or a refund." actionLabel="Refresh" actionDisabled={refreshing} onAction={() => setRevision(value => value + 1)} />
  </>;
}
