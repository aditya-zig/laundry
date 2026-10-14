import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import type { Service } from "@wandary/contracts";
import { getBasket, setBasket } from "./services/[id]";
import { removeLine, totalGarments, updateQuantity } from "../src/cart";
import { getClient } from "../src/api";
import { formatINR } from "../src/guards";
import { defaultSchedule, localToInstant, scheduleError, scheduleSummary } from "../src/schedule";
import { colors, minTouchTarget } from "../src/theme";

export default function Basket() {
  const router = useRouter();
  const [lines, setLines] = useState(getBasket());
  const [services, setServices] = useState<Service[]>([]);
  const [catalogError, setCatalogError] = useState(false);
  const [schedule, setSchedule] = useState(() => defaultSchedule());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { getClient().listServices().then(setServices).catch(() => setCatalogError(true)); }, []);
  function refresh(next: typeof lines) { setBasket(next); setLines(next); }
  const dateError = scheduleError(schedule);
  function checkout() {
    if (!lines.length) return;
    const invalid = scheduleError(schedule);
    if (invalid) { setError(invalid); return; }
    router.push({ pathname: "/checkout", params: { pickupStart: localToInstant(schedule.pickupStart), pickupEnd: localToInstant(schedule.pickupEnd), returnBy: localToInstant(schedule.returnBy) } });
  }
  return <ScrollView style={styles.page} contentContainerStyle={styles.container}>
    <Pressable accessibilityRole="button" onPress={() => router.push("/")} style={styles.nav}><Text style={styles.link}>Continue browsing</Text></Pressable>
    <Text accessibilityRole="header" style={styles.title}>Your basket</Text>
    <Text style={styles.body}>Clothes selected. A little more time for you.</Text>
    {!lines.length ? <View style={styles.empty}><Text style={styles.section}>Your basket is empty</Text><Text style={styles.body}>Choose a service and add your garments to plan a pickup.</Text><Pressable accessibilityRole="button" onPress={() => router.push("/")} style={styles.primary}><Text style={styles.primaryText}>Browse laundry services</Text></Pressable></View> : <>
      {catalogError && <Text style={styles.body}>Garment names could not load. Your selection is saved; try reopening this page.</Text>}
      {lines.map((line, index) => {
        const service = services.find(s => s.id === line.serviceId);
        const garment = service?.garments.find(g => g.id === line.garmentTypeId);
        const name = garment?.name ?? `Garment selection ${index + 1}`;
        return <View key={`${line.serviceId}-${line.garmentTypeId}-${index}`} style={styles.line}>
          <View style={{ flex: 1, minWidth: 150 }}><Text style={styles.name}>{name}</Text><Text style={styles.body}>{service?.name ?? "Laundry service"}</Text>{garment && <Text style={styles.body}>{formatINR(garment.priceMinor)} per garment</Text>}</View>
          <View style={styles.controls}><TextInput value={String(line.quantity)} keyboardType="numeric" accessibilityLabel={`Quantity for ${name}`} style={styles.quantity} onChangeText={value => {
            const quantity = Number(value);
            if (!Number.isInteger(quantity)) { setError("Choose a whole number from 1 to 100."); return; }
            try { refresh(updateQuantity(lines, index, quantity)); setError(null); } catch (e) { setError(e instanceof Error ? e.message : "Check the garment quantity."); }
          }} /><Pressable accessibilityRole="button" accessibilityLabel={`Remove ${name}`} onPress={() => refresh(removeLine(lines, index))} style={styles.remove}><Text style={styles.removeText}>Remove</Text></Pressable></View>
        </View>;
      })}
      <View style={styles.summary}><Text style={styles.name}>{totalGarments(lines)} garments selected</Text><Text style={styles.body}>Your quote will show the full price, fees and return availability before payment.</Text></View>
      <Text accessibilityRole="header" style={styles.section}>Plan your pickup</Text>
      <Text style={styles.body}>All times are India time (IST). Enter YYYY-MM-DD HH:mm. These are requested times; availability is confirmed in your quote.</Text>
      {([{ key: "pickupStart", label: "Pickup starts" }, { key: "pickupEnd", label: "Pickup ends" }, { key: "returnBy", label: "Requested return by" }] as const).map(field => <View key={field.key} style={styles.field}>
        <Text style={styles.label}>{field.label}</Text><TextInput value={schedule[field.key]} onChangeText={value => { setSchedule(current => ({ ...current, [field.key]: value })); setError(null); }} accessibilityLabel={`${field.label}, India time, YYYY-MM-DD HH:mm`} placeholder="YYYY-MM-DD HH:mm" autoCapitalize="none" style={styles.input} />
        <Text style={styles.helper}>{scheduleSummary(schedule[field.key])}</Text>
      </View>)}
    </>}
    {(error || (lines.length > 0 && dateError)) && <Text accessibilityLiveRegion="polite" style={styles.error}>{error || dateError}</Text>}
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: lines.length === 0 || Boolean(dateError) }} disabled={lines.length === 0 || Boolean(dateError)} onPress={checkout} style={({ pressed }) => [styles.primary, (lines.length === 0 || Boolean(dateError)) && styles.disabled, pressed && { opacity: .9 }]}><Text style={styles.primaryText}>Get quote and checkout</Text></Pressable>
    <Text style={styles.demo}>Demo ordering. Checkout uses a payment simulator and never makes a live charge.</Text>
  </ScrollView>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface }, container: { width: "100%", maxWidth: 760, alignSelf: "center", padding: 24, paddingBottom: 60 }, nav: { minHeight: minTouchTarget, justifyContent: "center", marginBottom: 20 }, link: { color: colors.actionPressed, fontSize: 16, fontWeight: "600" }, title: { color: colors.ink, fontSize: 34, lineHeight: 42, fontWeight: "700", marginBottom: 8 }, body: { color: colors.inkMuted, fontSize: 16, lineHeight: 25 },
  empty: { backgroundColor: colors.surfaceTint, borderRadius: 12, padding: 24, marginTop: 24 }, section: { color: colors.ink, fontSize: 24, fontWeight: "700", marginTop: 24, marginBottom: 12 }, line: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 16, paddingVertical: 22, borderBottomColor: colors.border, borderBottomWidth: 1 }, name: { color: colors.ink, fontSize: 18, fontWeight: "600", marginBottom: 4 }, controls: { flexDirection: "row", gap: 16, alignItems: "center" }, quantity: { width: 64, minHeight: minTouchTarget, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 10, textAlign: "center", color: colors.ink, fontSize: 16 }, remove: { minHeight: minTouchTarget, justifyContent: "center", paddingHorizontal: 8 }, removeText: { color: colors.danger, fontSize: 16, fontWeight: "600" },
  summary: { backgroundColor: colors.surfaceTint, padding: 20, borderRadius: 12, gap: 6, marginTop: 24 }, field: { marginTop: 20 }, label: { color: colors.ink, fontSize: 16, fontWeight: "600", marginBottom: 8 }, input: { minHeight: 48, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 12, color: colors.ink, fontSize: 16 }, helper: { color: colors.inkMuted, fontSize: 14, lineHeight: 22, marginTop: 6 }, primary: { backgroundColor: colors.action, borderRadius: 10, minHeight: 52, justifyContent: "center", padding: 16, marginTop: 24 }, disabled: { backgroundColor: colors.inkMuted }, primaryText: { color: colors.surface, fontSize: 16, fontWeight: "700", textAlign: "center" }, error: { color: colors.danger, fontSize: 16, lineHeight: 24, marginTop: 16 }, demo: { color: colors.inkMuted, fontSize: 14, lineHeight: 22, marginTop: 16 },
});
