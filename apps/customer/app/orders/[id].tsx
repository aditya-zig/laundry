import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { Order } from "@wandary/contracts";
import { getClient } from "../../src/api";
import { formatINR, paymentStatusLabel } from "../../src/guards";
import { colors, spacing, minTouchTarget } from "../../src/theme";

const TRACKING = ["CONFIRMED", "PICKUP_PENDING", "AT_FACILITY", "IN_CARE", "QUALITY_CHECK", "READY_FOR_RETURN", "RETURNING", "DELIVERED"];

export default function OrderDetail() {
  const { id, paymentId } = useLocalSearchParams<{ id: string; paymentId?: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState("");
  const [score, setScore] = useState("5");
  const [notice, setNotice] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  function load() {
    getClient().getOrder(id).then(setOrder).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }
  useEffect(load, [id]);

  if (error) return <Text style={{ color: colors.danger, padding: spacing.md }}>{error}</Text>;
  if (!order) return <ActivityIndicator style={{ marginTop: 48 }} />;

  async function submitReview() {
    setNotice(null);
    try {
      await getClient().createReview({
        orderId: order!.id,
        overall: Math.min(5, Math.max(1, Number(score))),
        comment: review || undefined,
        publishConsent: true,
      });
      setNotice("Review submitted. It appears after moderation.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Review failed. Only delivered orders accept one review each.");
    }
  }

  async function captureDemo() {
    if (typeof paymentId !== "string" || paymentId.length === 0) return;
    setNotice(null);
    setCapturing(true);
    try {
      const next = await getClient().captureDemoPayment(paymentId);
      setOrder(next);
      setNotice("DEMO capture recorded. The authoritative order status is shown above.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "DEMO capture failed");
    } finally {
      setCapturing(false);
    }
  }

  async function cancel() {
    setNotice(null);
    try {
      const next = await getClient().cancelOrder(order!.id, "Customer requested cancellation", order!.version);
      setOrder(next);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  return (
    <ScrollView style={{ padding: spacing.md }}>
      <Text style={{ color: colors.ink, fontSize: 24, fontWeight: "700" }}>Order {order.id.slice(0, 8)}</Text>
      <Text style={{ color: colors.ink, marginTop: 8 }}>Status: {order.status}</Text>
      <Text style={{ color: colors.ink, marginTop: 4 }}>{paymentStatusLabel(order.paymentStatus)}</Text>
      <Text style={{ color: colors.ink, marginTop: 4 }}>Total {formatINR(order.totalMinor)}</Text>
      <Text style={{ color: colors.inkMuted, marginTop: 4 }}>
        Pickup {order.pickupWindow.start} to {order.pickupWindow.end}
      </Text>
      <Text style={{ color: colors.inkMuted, marginTop: 4 }}>
        Return {order.promisedReturnWindow.start} to {order.promisedReturnWindow.end}
      </Text>
      <Text style={{ marginTop: spacing.md, fontWeight: "700", color: colors.ink }}>Tracking</Text>
      {TRACKING.map((s) => (
        <Text key={s} style={{ color: order.timeline.some((t) => t.status === s) ? colors.success : colors.inkMuted }}>
          {order.timeline.some((t) => t.status === s) ? "Done" : "Pending"}: {s}
        </Text>
      ))}
      {(order.paymentStatus === "PENDING" || order.paymentStatus === "CREATED") &&
        typeof paymentId === "string" &&
        paymentId.length > 0 && (
          <Pressable
            onPress={captureDemo}
            disabled={capturing}
            style={{ backgroundColor: colors.action, borderRadius: 12, padding: 12, marginTop: spacing.md, minHeight: minTouchTarget, justifyContent: "center", opacity: capturing ? 0.6 : 1 }}
          >
            <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>
              {capturing ? "Capturing…" : "Simulate payment capture (DEMO)"}
            </Text>
          </Pressable>
        )}
      <Text style={{ marginTop: spacing.md, fontWeight: "700", color: colors.ink }}>Review (delivered orders, one per order)</Text>
      {order.status === "DELIVERED" ? (
        <View>
          <TextInput value={score} onChangeText={setScore} keyboardType="numeric" style={{ borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 8, marginTop: 8, width: 72 }} accessibilityLabel="Overall score 1 to 5" />
          <TextInput value={review} onChangeText={setReview} placeholder="How was the service?" multiline style={{ borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 8, marginTop: 8, minHeight: 72 }} />
          <Pressable onPress={submitReview} style={{ backgroundColor: colors.action, borderRadius: 12, padding: 12, marginTop: 8, minHeight: minTouchTarget, justifyContent: "center" }}>
            <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>Submit review</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={{ color: colors.inkMuted, marginTop: 8 }}>
          Reviews open after delivery. Only delivered orders accept one review each.
        </Text>
      )}
      <Pressable onPress={cancel} style={{ marginTop: 12, minHeight: minTouchTarget, justifyContent: "center" }}>
        <Text style={{ color: colors.danger, fontWeight: "700" }}>Cancel order (when allowed)</Text>
      </Pressable>
      {notice && <Text style={{ marginTop: 12, color: colors.ink }}>{notice}</Text>}
    </ScrollView>
  );
}
