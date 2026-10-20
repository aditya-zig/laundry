import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Service } from "@wandary/contracts";
import { getClient } from "../../src/api";
import { addLine, type CartLine } from "../../src/cart";
import { colors, spacing, minTouchTarget, radius, typography, maxContentWidth } from "../../src/theme";

let basket: CartLine[] = [];
export function getBasket(): CartLine[] {
  return basket;
}
export function setBasket(next: CartLine[]): void {
  basket = next;
}

export default function ServiceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [service, setService] = useState<Service | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    getClient()
      .listServices()
      .then((all) => {
        const found = all.find((s) => s.id === id);
        if (!found) setError("Service not found.");
        else setService(found);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load service"));
  }, [id]);

  if (error)
    return (
      <View style={{ padding: spacing.md, backgroundColor: colors.surfaceTint, minHeight: "100%" }}>
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Service unavailable</Text>
          <Text style={{ color: colors.danger, marginTop: 4 }}>{error}</Text>
        </View>
      </View>
    );
  if (!service) return <ActivityIndicator style={{ marginTop: 48 }} color={colors.action} />;

  function add(garmentTypeId: string) {
    const n = Math.floor(Number(qty[garmentTypeId] ?? "1"));
    try {
      setBasket(addLine(getBasket(), { serviceId: service!.id, garmentTypeId, quantity: n }));
      setNotice(`${n} item(s) added to basket.`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not add to basket");
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.surfaceTint }} contentContainerStyle={{ alignItems: "center" }}>
      <View style={{ width: "100%", maxWidth: maxContentWidth, padding: spacing.md, paddingBottom: 48 }}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>{service.priceUnit}</Text>
          <Text style={styles.title}>{service.name}</Text>
          <Text style={styles.subtitle}>{service.description}</Text>
          <View style={styles.factRow}>
            <View style={styles.factPill}>
              <Text style={styles.factPillText}>Return in ~{service.turnaroundHours}h</Text>
            </View>
            <Text style={styles.factNote}>Final quote confirms the return window.</Text>
          </View>
        </View>
        {service.garments.map((g) => (
          <View key={g.id} style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.garmentName}>{g.name}</Text>
              <View style={styles.pricePill}>
                <Text style={styles.pricePillText}>INR {(g.priceMinor / 100).toFixed(2)}</Text>
              </View>
            </View>
            <Text style={styles.perUnit}>per garment</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12, alignItems: "center" }}>
              <TextInput
                value={qty[g.id] ?? "1"}
                onChangeText={(v) => setQty((q) => ({ ...q, [g.id]: v }))}
                keyboardType="numeric"
                style={styles.qtyInput}
                accessibilityLabel={`Quantity for ${g.name}`}
              />
              <Pressable
                onPress={() => add(g.id)}
                style={({ pressed }) => [styles.addButton, pressed && { backgroundColor: colors.actionPressed }]}
                accessibilityRole="button"
                accessibilityLabel={`Add ${g.name} to basket`}
              >
                <Text style={{ color: "#fff", fontWeight: "700" }}>Add to basket</Text>
              </Pressable>
            </View>
          </View>
        ))}
        {notice && (
          <View style={styles.notice}>
            <Text style={{ color: colors.ink, fontWeight: "600" }}>{notice}</Text>
          </View>
        )}
        <Pressable
          onPress={() => router.push("/basket")}
          style={styles.reviewBasket}
          accessibilityRole="button"
          accessibilityLabel="Review basket"
        >
          <Text style={{ color: colors.action, fontWeight: "700", fontSize: typography.sizes.body }}>Review basket ({getBasket().length} lines)</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = {
  hero: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  eyebrow: {
    color: colors.action,
    fontSize: 11,
    fontWeight: "800" as const,
    letterSpacing: 0.8,
  },
  title: {
    color: colors.ink,
    fontSize: typography.sizes.display,
    fontWeight: "800" as const,
    marginTop: 4,
  },
  subtitle: {
    color: colors.inkMuted,
    marginTop: 4,
    fontSize: typography.sizes.body,
    lineHeight: 22,
  },
  factRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginTop: 12,
  },
  factPill: {
    backgroundColor: colors.actionSoft,
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  factPillText: {
    color: colors.ink,
    fontSize: typography.sizes.caption,
    fontWeight: "700" as const,
  },
  factNote: {
    color: colors.inkMuted,
    fontSize: typography.sizes.caption,
    flex: 1,
    flexWrap: "wrap" as const,
  },
  card: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  cardTop: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: 8,
  },
  garmentName: {
    color: colors.ink,
    fontWeight: "700" as const,
    fontSize: typography.sizes.body,
    flex: 1,
  },
  pricePill: {
    backgroundColor: colors.surfaceTint,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  pricePillText: {
    color: colors.ink,
    fontWeight: "700" as const,
    fontSize: typography.sizes.caption,
  },
  perUnit: {
    color: colors.inkMuted,
    fontSize: typography.sizes.caption,
    marginTop: 2,
  },
  qtyInput: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: 8,
    width: 72,
    minHeight: minTouchTarget,
    color: colors.ink,
    backgroundColor: colors.surface,
    textAlign: "center" as const,
  },
  addButton: {
    flex: 1,
    backgroundColor: colors.action,
    borderRadius: radius.md,
    padding: 12,
    minHeight: minTouchTarget,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  notice: {
    marginTop: 12,
    backgroundColor: colors.successSoft,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorCard: {
    backgroundColor: colors.dangerSoft,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorTitle: {
    color: colors.danger,
    fontWeight: "700" as const,
    fontSize: typography.sizes.body,
  },
  reviewBasket: {
    marginTop: spacing.lg,
    minHeight: minTouchTarget,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
  },
};
