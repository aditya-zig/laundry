import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { Link } from "expo-router";
import type { Order } from "@laundry/contracts";
import { getClient } from "../../src/api";
import { paymentStatusLabel } from "../../src/guards";
import { colors, spacing, minTouchTarget } from "../../src/theme";

export default function Orders() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    getClient().listOrders().then(setOrders).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }

  useEffect(load, []);

  return (
    <ScrollView style={{ padding: spacing.md }}>
      <Text style={{ color: colors.ink, fontSize: 24, fontWeight: "700" }}>Orders</Text>
      {error && (
        <View style={{ marginTop: 12 }}>
          <Text style={{ color: colors.danger }}>{error}</Text>
          <Pressable onPress={load} style={{ marginTop: 8, minHeight: minTouchTarget, justifyContent: "center" }}>
            <Text style={{ color: colors.action, fontWeight: "700" }}>Retry</Text>
          </Pressable>
        </View>
      )}
      {!orders && !error && <ActivityIndicator style={{ marginTop: 24 }} />}
      {orders && orders.length === 0 && (
        <Text style={{ marginTop: 12, color: colors.inkMuted }}>No orders yet. Your history appears here.</Text>
      )}
      {(orders ?? []).map((o) => (
        <Link
          key={o.id}
          href={{ pathname: "/orders/[id]", params: { id: o.id } }}
          style={{ marginTop: 12, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: spacing.md }}
        >
          <View>
            <Text style={{ color: colors.ink, fontWeight: "700" }}>{o.id.slice(0, 8)} - {o.status}</Text>
            <Text style={{ color: colors.inkMuted }}>{paymentStatusLabel(o.paymentStatus)}</Text>
          </View>
        </Link>
      ))}
    </ScrollView>
  );
}
