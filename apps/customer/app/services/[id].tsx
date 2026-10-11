import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Service } from "@wandary/contracts";
import { getClient } from "../../src/api";
import { addLine, type CartLine } from "../../src/cart";
import { colors, spacing, minTouchTarget } from "../../src/theme";

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

  if (error) return <Text style={{ color: colors.danger, padding: spacing.md }}>{error}</Text>;
  if (!service) return <ActivityIndicator style={{ marginTop: 48 }} />;

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
    <ScrollView style={{ padding: spacing.md }}>
      <Text style={{ color: colors.ink, fontSize: 24, fontWeight: "700" }}>{service.name}</Text>
      <Text style={{ color: colors.inkMuted, marginTop: 4 }}>{service.description}</Text>
      <Text style={{ color: colors.ink, marginTop: 8, fontWeight: "600" }}>{service.priceUnit}</Text>
      <Text style={{ color: colors.inkMuted, marginTop: 4 }}>
        Indicative turnaround: {service.turnaroundHours}h. Final quote confirms the return window.
      </Text>
      {service.garments.map((g) => (
        <View key={g.id} style={{ marginTop: spacing.md, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: spacing.md }}>
          <Text style={{ color: colors.ink, fontWeight: "700" }}>{g.name}</Text>
          <Text style={{ color: colors.inkMuted }}>INR {(g.priceMinor / 100).toFixed(2)} per garment</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8, alignItems: "center" }}>
            <TextInput
              value={qty[g.id] ?? "1"}
              onChangeText={(v) => setQty((q) => ({ ...q, [g.id]: v }))}
              keyboardType="numeric"
              style={{ borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 8, width: 72 }}
              accessibilityLabel={`Quantity for ${g.name}`}
            />
            <Pressable
              onPress={() => add(g.id)}
              style={{ backgroundColor: colors.action, borderRadius: 12, padding: 12, minHeight: minTouchTarget, justifyContent: "center" }}
            >
              <Text style={{ color: "#fff", fontWeight: "700" }}>Add to basket</Text>
            </Pressable>
          </View>
        </View>
      ))}
      {notice && <Text style={{ marginTop: 12, color: colors.ink }}>{notice}</Text>}
      <Pressable
        onPress={() => router.push("/basket")}
        style={{ marginTop: spacing.lg, minHeight: minTouchTarget, justifyContent: "center" }}
      >
        <Text style={{ color: colors.action, fontWeight: "700" }}>Review basket</Text>
      </Pressable>
    </ScrollView>
  );
}
