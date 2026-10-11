import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { getBasket, setBasket } from "./services/[id]";
import { removeLine, totalGarments, updateQuantity } from "../src/cart";
import { colors, spacing, minTouchTarget } from "../src/theme";

export default function Basket() {
  const router = useRouter();
  const [lines, setLines] = useState(getBasket());
  const [pickupStart, setPickupStart] = useState("2026-10-12T09:00:00.000Z");
  const [pickupEnd, setPickupEnd] = useState("2026-10-12T10:00:00.000Z");
  const [returnBy, setReturnBy] = useState("2026-10-17T18:00:00.000Z");

  function refresh(next: typeof lines) {
    setBasket(next);
    setLines(next);
  }

  return (
    <ScrollView style={{ padding: spacing.md }}>
      <Text style={{ color: colors.ink, fontSize: 24, fontWeight: "700" }}>Basket</Text>
      {lines.length === 0 && (
        <Text style={{ marginTop: spacing.md, color: colors.inkMuted }}>
          Your basket is empty. Browse services to add garments.
        </Text>
      )}
      {lines.map((l, i) => (
        <View key={i} style={{ marginTop: 12, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: spacing.md }}>
          <Text style={{ color: colors.ink, fontWeight: "600" }}>
            {l.quantity} x garment ({l.garmentTypeId.slice(0, 8)})
          </Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8, alignItems: "center" }}>
            <TextInput
              value={String(l.quantity)}
              keyboardType="numeric"
              onChangeText={(v) => {
                try {
                  refresh(updateQuantity(lines, i, Number(v)));
                } catch {
                  // Keep old value on invalid input; validation message lives in guards.
                }
              }}
              style={{ borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 8, width: 72 }}
              accessibilityLabel={`Quantity for line ${i + 1}`}
            />
            <Pressable onPress={() => refresh(removeLine(lines, i))} style={{ minHeight: minTouchTarget, justifyContent: "center" }}>
              <Text style={{ color: colors.danger, fontWeight: "700" }}>Remove</Text>
            </Pressable>
          </View>
        </View>
      ))}
      {lines.length > 0 && (
        <Text style={{ marginTop: 12, color: colors.ink }}>Total garments: {totalGarments(lines)}</Text>
      )}
      <Text style={{ marginTop: spacing.lg, fontWeight: "700", color: colors.ink }}>Pickup window (UTC)</Text>
      <TextInput value={pickupStart} onChangeText={setPickupStart} style={{ borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 8, marginTop: 8 }} />
      <TextInput value={pickupEnd} onChangeText={setPickupEnd} style={{ borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 8, marginTop: 8 }} />
      <Text style={{ marginTop: 12, fontWeight: "700", color: colors.ink }}>Requested return by (UTC)</Text>
      <TextInput value={returnBy} onChangeText={setReturnBy} style={{ borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 8, marginTop: 8 }} />
      <Pressable
        onPress={() =>
          router.push({ pathname: "/checkout", params: { pickupStart, pickupEnd, returnBy } })
        }
        style={{ backgroundColor: colors.action, borderRadius: 12, padding: 12, marginTop: spacing.lg, minHeight: minTouchTarget, justifyContent: "center" }}
      >
        <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>Get quote and checkout</Text>
      </Pressable>
    </ScrollView>
  );
}
