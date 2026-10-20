import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { getBasket, setBasket } from "./services/[id]";
import { removeLine, totalGarments, updateQuantity } from "../src/cart";
import { colors, spacing, minTouchTarget, radius, typography, maxContentWidth } from "../src/theme";

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
    <ScrollView style={{ backgroundColor: colors.surfaceTint }} contentContainerStyle={{ alignItems: "center" }}>
      <View style={{ width: "100%", maxWidth: maxContentWidth, padding: spacing.md, paddingBottom: 48 }}>
        <Text style={styles.title}>Basket</Text>
        <Text style={styles.subtitle}>Step 1 of 2. Times use Asia/Kolkata and stay editable until checkout.</Text>
        {lines.length === 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Your basket is empty</Text>
            <Text style={styles.subtitle}>Browse services to add garments. Quantities count garments, never weight.</Text>
          </View>
        )}
        {lines.map((l, i) => (
          <View key={i} style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.lineTitle}>
                {l.quantity} x garment ({l.garmentTypeId.slice(0, 8)})
              </Text>
              <Pressable onPress={() => refresh(removeLine(lines, i))} style={styles.remove} accessibilityRole="button" accessibilityLabel={`Remove line ${i + 1}`}>
                <Text style={{ color: colors.danger, fontWeight: "700" }}>Remove</Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12, alignItems: "center" }}>
              <Text style={styles.qtyLabel}>Qty</Text>
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
                style={styles.qtyInput}
                accessibilityLabel={`Quantity for line ${i + 1}`}
              />
              <Text style={styles.hint}>1 to 100 per line</Text>
            </View>
          </View>
        ))}
        {lines.length > 0 && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total garments</Text>
            <Text style={styles.totalValue}>{totalGarments(lines)}</Text>
          </View>
        )}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>SCHEDULE</Text>
          <Text style={styles.cardTitle}>Pickup window (UTC)</Text>
          <TextInput value={pickupStart} onChangeText={setPickupStart} style={styles.input} accessibilityLabel="Pickup window start" />
          <TextInput value={pickupEnd} onChangeText={setPickupEnd} style={styles.input} accessibilityLabel="Pickup window end" />
          <Text style={[styles.cardTitle, { marginTop: spacing.md }]}>Requested return by (UTC)</Text>
          <TextInput value={returnBy} onChangeText={setReturnBy} style={styles.input} accessibilityLabel="Requested return deadline" />
        </View>
        <Pressable
          onPress={() =>
            router.push({ pathname: "/checkout", params: { pickupStart, pickupEnd, returnBy } })
          }
          style={({ pressed }) => [styles.primaryButton, pressed && { backgroundColor: colors.actionPressed }]}
          accessibilityRole="button"
          accessibilityLabel="Get quote and checkout"
        >
          <Text style={styles.primaryButtonText}>Get quote and checkout</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = {
  title: {
    color: colors.ink,
    fontSize: typography.sizes.display,
    fontWeight: "800" as const,
  },
  subtitle: {
    color: colors.inkMuted,
    marginTop: 4,
    fontSize: typography.sizes.body,
    lineHeight: 22,
  },
  card: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  cardLabel: {
    color: colors.action,
    fontSize: 11,
    fontWeight: "800" as const,
    letterSpacing: 0.8,
  },
  cardTitle: {
    color: colors.ink,
    marginTop: 4,
    fontWeight: "700" as const,
    fontSize: typography.sizes.body,
  },
  cardTop: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: 8,
  },
  lineTitle: {
    color: colors.ink,
    fontWeight: "700" as const,
    flex: 1,
  },
  remove: {
    minHeight: minTouchTarget,
    justifyContent: "center" as const,
    paddingHorizontal: 8,
  },
  qtyLabel: {
    color: colors.inkMuted,
    fontWeight: "700" as const,
  },
  qtyInput: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: 8,
    width: 72,
    minHeight: minTouchTarget,
    textAlign: "center" as const,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  hint: {
    color: colors.inkMuted,
    fontSize: typography.sizes.caption,
  },
  input: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: 10,
    marginTop: 8,
    color: colors.ink,
    backgroundColor: colors.surface,
    minHeight: minTouchTarget,
  },
  totalRow: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
  totalLabel: {
    color: colors.inkMuted,
    fontWeight: "600" as const,
  },
  totalValue: {
    color: colors.ink,
    fontWeight: "800" as const,
    fontSize: typography.sizes.title,
  },
  primaryButton: {
    backgroundColor: colors.action,
    borderRadius: radius.md,
    padding: 12,
    marginTop: spacing.lg,
    minHeight: minTouchTarget,
    justifyContent: "center" as const,
  },
  primaryButtonText: {
    color: "#fff",
    textAlign: "center" as const,
    fontWeight: "700" as const,
    fontSize: typography.sizes.body,
  },
};
