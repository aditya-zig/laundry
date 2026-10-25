import { useEffect, useState } from "react";
import { Link } from "expo-router";
import { Pressable, Text } from "react-native";
import type { v2 } from "@laundry/contracts";
import { apiV2 } from "../../src/api-v2";
import { CustomerPrivateScreen } from "../../src/features/booking/CustomerPrivateScreen";
import { describeError } from "../../src/features/booking/presenters";
import { Card, Loading, NoteCard, Page } from "../../src/features/booking/ui";
import { formatINR } from "../../src/guards";
import { colors, minTouchTarget } from "../../src/theme";

export default function Orders() {
  return <Page title="Your orders"><CustomerPrivateScreen><OwnedOrders /></CustomerPrivateScreen></Page>;
}

function OwnedOrders() {
  const [page, setPage] = useState<v2.Page<v2.Order> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setPage(null); setError(null);
    apiV2.listOrders().then(value => { if (active) setPage(value); }).catch(cause => { if (active) setError(cause); });
    return () => { active = false; };
  }, [revision]);
  if (error) return <NoteCard kind="error" title={describeError(error).title} body={describeError(error).body} actionLabel="Retry" onAction={() => setRevision(value => value + 1)} />;
  if (!page) return <Loading label="Loading your orders" />;
  return <>
    {page.items.length === 0 ? <NoteCard kind="note" title="No orders yet" body="Confirmed bookings will appear here. A bag or pending command is not an order." /> : null}
    {page.items.map(order => <Card key={order.id} title={order.status.replaceAll("_", " ")}>
      <Text style={{ color: colors.ink, marginTop: 8 }}>{formatINR(order.totalMinor)} · {order.paymentModel === "DUE_AT_RETURN" ? "Payment due at return" : "Prepaid order"}</Text>
      <Link href={{ pathname: "/orders/[id]", params: { id: order.id } }} asChild>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open order ${order.id}`} style={{ minHeight: minTouchTarget, justifyContent: "center" }}><Text style={{ color: colors.action }}>View order {order.id.slice(0, 8)}</Text></Pressable>
      </Link>
    </Card>)}
    {page.pageInfo.hasMore ? <NoteCard kind="note" title="More orders exist" body="This screen currently shows the first server page only; older-order pagination is not implemented." /> : null}
    <NoteCard kind="note" title="Server status" body="Only confirmed server records appear above. Refresh to check for updates." actionLabel="Refresh" onAction={() => setRevision(value => value + 1)} />
  </>;
}
