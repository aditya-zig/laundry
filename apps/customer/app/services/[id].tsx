import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Service } from "@wandary/contracts";
import { getClient } from "../../src/api";
import { addLine, totalGarments, type CartLine } from "../../src/cart";
import { colors, minTouchTarget } from "../../src/theme";
import { formatINR } from "../../src/guards";

let basket: CartLine[] = [];
export function getBasket(): CartLine[] { return basket; }
export function setBasket(next: CartLine[]): void { basket = next; }

export default function ServiceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [service, setService] = useState<Service | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [count, setCount] = useState(totalGarments(getBasket()));
  function load() {
    setError(null); setService(null); setImageFailed(false);
    getClient().listServices().then((all) => {
      const found = all.find((s) => s.id === id);
      if (!found) setError("This service is unavailable. Browse another service."); else setService(found);
    }).catch(() => setError("Services could not load. Check your connection and try again."));
  }
  useEffect(load, [id]);
  function add(garmentTypeId: string) {
    const n = Number(qty[garmentTypeId] ?? "1");
    if (!Number.isInteger(n) || n < 1 || n > 100) { setNotice("Choose a whole number from 1 to 100."); return; }
    try {
      setBasket(addLine(getBasket(), { serviceId: service!.id, garmentTypeId, quantity: n }));
      setCount(totalGarments(getBasket()));
      setNotice(`Added ${n} × ${service!.garments.find(g => g.id === garmentTypeId)?.name ?? "garment"} to your basket.`);
    } catch (e) { setNotice(e instanceof Error ? e.message : "Could not add to basket"); }
  }
  return <ScrollView style={styles.page} contentContainerStyle={styles.container}>
    <View style={styles.topbar}>
      <Pressable accessibilityRole="button" onPress={() => router.push("/")} style={styles.nav}><Text style={styles.navText}>Back to services</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push("/basket")} style={styles.nav}><Text style={styles.navText}>Basket ({count})</Text></Pressable>
    </View>
    {error ? <View style={styles.panel}><Text style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={load} style={styles.primary}><Text style={styles.primaryText}>Try again</Text></Pressable></View> : !service ? <ActivityIndicator accessibilityLabel="Loading service" style={{ margin: 48 }} /> : <>
      {!imageFailed && service.imageUrl ? <Image source={{ uri: service.imageUrl }} accessibilityLabel={`${service.name} laundry service`} onError={() => setImageFailed(true)} style={styles.photo} /> : null}
      <Text accessibilityRole="header" style={styles.title}>{service.name}</Text>
      <Text style={styles.body}>{service.description}</Text>
      <View style={styles.facts}><Text style={styles.fact}>{/\bINR\b|₹/i.test(service.priceUnit) ? service.priceUnit : `From ${formatINR(service.priceMinor)} ${service.priceUnit}`}</Text><Text style={styles.body}>Typical care time: {service.turnaroundHours} hours. Your quote confirms availability and return time.</Text></View>
      {service.features.length > 0 && <View style={styles.features}>{service.features.map(feature => <Text key={feature} style={styles.body}>{feature}</Text>)}</View>}
      <Text accessibilityRole="header" style={styles.sectionTitle}>Choose your garments</Text>
      <Text style={styles.body}>Add each garment type. You can review everything before checkout.</Text>
      {service.garments.map(g => <View key={g.id} style={styles.garment}>
        <View style={{ flex: 1, minWidth: 160 }}><Text style={styles.name}>{g.name}</Text><Text style={styles.body}>{formatINR(g.priceMinor)} per garment</Text></View>
        <View style={styles.controls}><TextInput value={qty[g.id] ?? "1"} onChangeText={v => setQty(q => ({ ...q, [g.id]: v }))} keyboardType="numeric" style={styles.input} accessibilityLabel={`Quantity for ${g.name}`} />
          <Pressable accessibilityRole="button" accessibilityLabel={`Add ${g.name} to basket`} onPress={() => add(g.id)} style={({ pressed }) => [styles.add, pressed && { backgroundColor: colors.actionPressed }]}><Text style={styles.primaryText}>Add to basket</Text></Pressable>
        </View>
      </View>)}
      {notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}
      <Pressable accessibilityRole="button" onPress={() => router.push("/basket")} style={styles.primary}><Text style={styles.primaryText}>Review basket · {count} garments</Text></Pressable>
      <Text style={styles.demo}>Demo catalog. Final pricing and availability are confirmed by the quote.</Text>
    </>}
  </ScrollView>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface }, container: { width: "100%", maxWidth: 760, alignSelf: "center", padding: 24, paddingBottom: 60 },
  topbar: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", marginBottom: 20 }, nav: { minHeight: minTouchTarget, justifyContent: "center" }, navText: { color: colors.actionPressed, fontSize: 16, fontWeight: "600" },
  photo: { width: "100%", height: 230, borderRadius: 16, backgroundColor: colors.surfaceTint, marginBottom: 24 },
  title: { color: colors.ink, fontSize: 34, lineHeight: 42, fontWeight: "700", marginBottom: 12 }, body: { color: colors.inkMuted, fontSize: 16, lineHeight: 25 },
  facts: { backgroundColor: colors.surfaceTint, padding: 20, borderRadius: 12, marginVertical: 20, gap: 8 }, fact: { color: colors.ink, fontSize: 18, fontWeight: "600" }, features: { gap: 6, marginBottom: 24 },
  sectionTitle: { color: colors.ink, fontSize: 24, fontWeight: "700", marginBottom: 8 }, garment: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 16, paddingVertical: 20, borderBottomColor: colors.border, borderBottomWidth: 1 }, name: { color: colors.ink, fontSize: 18, fontWeight: "600", marginBottom: 4 }, controls: { flexDirection: "row", gap: 10, alignItems: "center" },
  input: { borderColor: colors.border, borderWidth: 1, borderRadius: 8, width: 64, minHeight: minTouchTarget, padding: 10, textAlign: "center", color: colors.ink, fontSize: 16 }, add: { backgroundColor: colors.action, borderRadius: 8, minHeight: minTouchTarget, justifyContent: "center", paddingHorizontal: 16 }, primary: { backgroundColor: colors.action, borderRadius: 10, minHeight: 52, justifyContent: "center", padding: 16, marginTop: 24 }, primaryText: { color: colors.surface, fontSize: 16, fontWeight: "700", textAlign: "center" },
  notice: { color: colors.ink, fontSize: 16, lineHeight: 24, marginTop: 16 }, demo: { color: colors.inkMuted, fontSize: 14, lineHeight: 22, marginTop: 16 }, panel: { padding: 24, backgroundColor: colors.surfaceTint, borderRadius: 12 }, error: { color: colors.danger, fontSize: 16, lineHeight: 24 },
});
