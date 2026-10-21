import { useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { Service } from "@laundry/contracts";
import { getClient } from "../src/api";
import { getBasketLines, resetBasket, subscribeBasket } from "../src/cart-store";
import { estimateSubtotalMinor, MAX_GARMENTS, removeLine, totalGarments, updateQuantity } from "../src/cart";
import { defaultSchedule, formatINR, scheduleBlockReason } from "../src/guards";
import { fromISTFields, toISTFields } from "../src/schedule-input";
import { colors, spacing, minTouchTarget, radius, typography, maxContentWidth } from "../src/theme";

export default function Basket() {
  const router = useRouter();
  const lines = useSyncExternalStore(subscribeBasket, getBasketLines, getBasketLines);
  const [services, setServices] = useState<Service[] | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [initialSchedule] = useState(defaultSchedule);
  const [pickupDay, setPickupDay] = useState(() => toISTFields(initialSchedule.pickupStart).date);
  const [pickupTime, setPickupTime] = useState(() => toISTFields(initialSchedule.pickupStart).time);
  const [pickupEndTime, setPickupEndTime] = useState(() => toISTFields(initialSchedule.pickupEnd).time);
  const [returnDay, setReturnDay] = useState(() => toISTFields(initialSchedule.returnBy).date);
  const [returnTime, setReturnTime] = useState(() => toISTFields(initialSchedule.returnBy).time);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [basketError, setBasketError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getClient().listServices().then((all) => {
      if (active) {
        setServices(all);
        setCatalogError(false);
      }
    }).catch(() => { if (active) setCatalogError(true); });
    return () => { active = false; };
  }, []);

  const priceByGarmentId: Record<string, number> = {};
  for (const service of services ?? []) {
    for (const garment of service.garments) priceByGarmentId[garment.id] = garment.priceMinor;
  }
  const estimate = services ? estimateSubtotalMinor(lines, priceByGarmentId) : null;
  const garmentCount = totalGarments(lines);

  function changeQuantity(index: number, quantity: number) {
    try {
      resetBasket(quantity === 0 ? removeLine(lines, index) : updateQuantity(lines, index, quantity));
      setBasketError(null);
    } catch (e) {
      setBasketError(e instanceof Error ? e.message : "Could not update the bag.");
    }
  }

  function continueToCheckout() {
    const pickupStart = fromISTFields(pickupDay, pickupTime);
    const pickupEnd = fromISTFields(pickupDay, pickupEndTime);
    const returnBy = fromISTFields(returnDay, returnTime);
    if (!pickupStart || !pickupEnd || !returnBy) {
      setScheduleError("Enter real dates (YYYY-MM-DD) and 24-hour times (HH:mm).");
      return;
    }
    const reason = scheduleBlockReason({ pickupStart, pickupEnd, returnBy });
    setScheduleError(reason);
    if (!reason && lines.length > 0) {
      router.push({ pathname: "/checkout", params: { pickupStart, pickupEnd, returnBy } });
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.center}>
      <View style={styles.content}>
        <View style={styles.topRow}>
          <Pressable onPress={() => router.push("/")} style={styles.back} accessibilityRole="button" accessibilityLabel="Back to services">
            <Ionicons name="arrow-back" color={colors.action} size={20} />
            <Text style={styles.backText}>Services</Text>
          </Pressable>
          <Text style={styles.demo}>DEMO</Text>
        </View>
        <Text style={styles.title} accessibilityRole="header">Your bag</Text>
        <Text style={styles.subtitle}>Review your clothes and request a pickup time.</Text>

        {lines.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}><Ionicons name="bag-outline" size={30} color={colors.action} /></View>
            <Text style={styles.cardTitle}>Your bag is empty</Text>
            <Text style={styles.muted}>Add clothes from the services page to get started.</Text>
            <Pressable onPress={() => router.push("/")} style={styles.outlineButton} accessibilityRole="button" accessibilityLabel="Browse services">
              <Text style={styles.outlineText}>Browse services</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle} accessibilityRole="header">Clothes</Text>
              <Text style={styles.counter}>{garmentCount} garment{garmentCount === 1 ? "" : "s"}</Text>
            </View>
            {lines.map((line, index) => {
              const service = services?.find((s) => s.id === line.serviceId);
              const garment = service?.garments.find((g) => g.id === line.garmentTypeId);
              const name = garment?.name ?? "Garment";
              return (
                <View key={line.serviceId + "-" + line.garmentTypeId + "-" + index} style={styles.card}>
                  <View style={styles.lineRow}>
                    <View style={styles.garmentIcon}><Ionicons name="shirt-outline" size={25} color={colors.action} /></View>
                    <View style={styles.lineCopy}>
                      <Text style={styles.garmentName}>{name}</Text>
                      <Text style={styles.muted}>{service?.name ?? "Service details unavailable"}</Text>
                      {garment && <Text style={styles.rate}>{formatINR(garment.priceMinor)} / garment</Text>}
                    </View>
                  </View>
                  <View style={styles.lineActions}>
                    <View style={styles.stepper}>
                      <Pressable onPress={() => changeQuantity(index, line.quantity - 1)} style={styles.step} accessibilityRole="button" accessibilityLabel={"Remove one " + name}>
                        <Ionicons name="remove" size={20} color={colors.action} />
                      </Pressable>
                      <Text style={styles.count} accessibilityLabel={line.quantity + " " + name}>{line.quantity}</Text>
                      <Pressable disabled={garmentCount >= MAX_GARMENTS || line.quantity >= 100} onPress={() => changeQuantity(index, line.quantity + 1)} style={styles.step} accessibilityRole="button" accessibilityLabel={"Add one " + name}>
                        <Ionicons name="add" size={20} color={colors.action} />
                      </Pressable>
                    </View>
                    <Pressable onPress={() => changeQuantity(index, 0)} style={styles.remove} accessibilityRole="button" accessibilityLabel={"Remove " + name + " from bag"}>
                      <Text style={styles.removeText}>Remove</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
            {basketError && <Text accessibilityRole="alert" style={styles.error}>{basketError}</Text>}
            <View style={styles.estimateCard}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Estimated subtotal</Text>
                <Text style={styles.summaryAmount}>{estimate === null ? "At checkout" : formatINR(estimate)}</Text>
              </View>
              <Text style={styles.finePrint}>{catalogError ? "Catalog unavailable. " : ""}Taxes, fees and final prices are confirmed in the server quote.</Text>
            </View>
          </>
        )}

        {lines.length > 0 && (
          <View style={styles.scheduleCard}>
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle} accessibilityRole="header">Pickup & return</Text>
              <Text style={styles.timezone}>IST (India)</Text>
            </View>
            <Text style={styles.muted}>Request a time. Available slots and delivery estimates are confirmed at checkout.</Text>
            <Text style={styles.fieldLabel}>Pickup date</Text>
            <TextInput value={pickupDay} onChangeText={(v) => { setPickupDay(v); setScheduleError(null); }} placeholder="YYYY-MM-DD" style={styles.input} accessibilityLabel="Pickup date in India" autoCapitalize="none" />
            <View style={styles.fieldsRow}>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>From (24h)</Text>
                <TextInput value={pickupTime} onChangeText={(v) => { setPickupTime(v); setScheduleError(null); }} placeholder="09:00" style={styles.input} accessibilityLabel="Pickup start time in India" />
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>To (24h)</Text>
                <TextInput value={pickupEndTime} onChangeText={(v) => { setPickupEndTime(v); setScheduleError(null); }} placeholder="10:00" style={styles.input} accessibilityLabel="Pickup end time in India" />
              </View>
            </View>
            <View style={styles.separator} />
            <Text style={styles.fieldLabel}>Requested return date</Text>
            <TextInput value={returnDay} onChangeText={(v) => { setReturnDay(v); setScheduleError(null); }} placeholder="YYYY-MM-DD" style={styles.input} accessibilityLabel="Requested return date in India" />
            <Text style={styles.fieldLabel}>Return before (24h)</Text>
            <TextInput value={returnTime} onChangeText={(v) => { setReturnTime(v); setScheduleError(null); }} placeholder="18:00" style={styles.input} accessibilityLabel="Requested return time in India" />
            {scheduleError && <Text accessibilityRole="alert" style={styles.error}>{scheduleError}</Text>}
          </View>
        )}

        {lines.length > 0 && (
          <Pressable onPress={continueToCheckout} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Get server quote and continue">
            <Text style={styles.primaryText}>Get quote & continue</Text>
            <Ionicons name="arrow-forward" color={colors.surface} size={19} />
          </Pressable>
        )}
        <Text style={styles.footer}>Demo checkout only. No real payment or delivery booking.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceTint },
  center: { alignItems: "center" },
  content: { width: "100%", maxWidth: maxContentWidth, padding: spacing.md, paddingBottom: 64 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  back: { minHeight: minTouchTarget, flexDirection: "row", alignItems: "center", gap: 8 },
  backText: { color: colors.action, fontSize: 16, fontWeight: "700" },
  demo: { color: colors.warning, backgroundColor: colors.warningSoft, overflow: "hidden", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5, fontSize: 12, fontWeight: "700" },
  title: { color: colors.ink, fontSize: typography.sizes.display, fontWeight: "800" },
  subtitle: { color: colors.inkMuted, fontSize: 16, lineHeight: 23, marginTop: 5, marginBottom: 14 },
  sectionHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 8, marginBottom: 12 },
  sectionTitle: { color: colors.ink, fontSize: 20, fontWeight: "700" },
  counter: { color: colors.action, backgroundColor: colors.actionSoft, paddingHorizontal: 10, paddingVertical: 5, overflow: "hidden", borderRadius: radius.pill, fontSize: 13, fontWeight: "700" },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: 14, marginBottom: 10 },
  lineRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  garmentIcon: { height: 56, width: 56, backgroundColor: colors.surfaceTint, alignItems: "center", justifyContent: "center", borderRadius: radius.md },
  lineCopy: { flex: 1, minWidth: 0 },
  garmentName: { fontSize: 17, fontWeight: "700", color: colors.ink },
  muted: { color: colors.inkMuted, fontSize: 14, lineHeight: 20, marginTop: 3 },
  rate: { color: colors.action, fontSize: 14, fontWeight: "700", marginTop: 4 },
  lineActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14, gap: 8 },
  stepper: { flexDirection: "row", alignItems: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceCard },
  step: { width: minTouchTarget, height: minTouchTarget, justifyContent: "center", alignItems: "center" },
  count: { color: colors.ink, fontSize: 16, fontWeight: "700", textAlign: "center", minWidth: 28 },
  remove: { minHeight: minTouchTarget, paddingHorizontal: 10, justifyContent: "center" },
  removeText: { color: colors.danger, fontSize: 14, fontWeight: "700" },
  estimateCard: { backgroundColor: colors.actionSoft, borderRadius: radius.lg, padding: spacing.md, marginTop: 4 },
  summaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  summaryLabel: { color: colors.ink, fontSize: 15, fontWeight: "600", flexShrink: 1 },
  summaryAmount: { color: colors.ink, fontSize: 20, fontWeight: "800" },
  finePrint: { color: colors.inkMuted, fontSize: 13, lineHeight: 19, marginTop: 8 },
  scheduleCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.lg },
  timezone: { color: colors.action, fontSize: 13, fontWeight: "700", backgroundColor: colors.actionSoft, paddingHorizontal: 9, paddingVertical: 5, overflow: "hidden", borderRadius: radius.pill },
  fieldLabel: { color: colors.ink, fontWeight: "700", fontSize: 14, marginTop: 14, marginBottom: 6 },
  input: { color: colors.ink, backgroundColor: colors.surfaceCard, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, fontSize: 16, paddingHorizontal: 12, minHeight: 48, width: "100%" },
  fieldsRow: { flexDirection: "row", gap: 12 },
  field: { flex: 1, minWidth: 0 },
  separator: { height: 1, backgroundColor: colors.border, marginTop: 20 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20, marginTop: 10 },
  primaryButton: { backgroundColor: colors.action, minHeight: 54, marginTop: spacing.lg, borderRadius: radius.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  pressed: { backgroundColor: colors.actionPressed },
  primaryText: { color: colors.surface, fontSize: 16, fontWeight: "700" },
  footer: { color: colors.inkMuted, textAlign: "center", fontSize: 12, lineHeight: 18, marginTop: 15 },
  emptyCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderColor: colors.border, borderWidth: 1, padding: spacing.lg, alignItems: "center", marginTop: 18 },
  emptyIcon: { backgroundColor: colors.actionSoft, padding: 16, borderRadius: radius.pill, marginBottom: 12 },
  cardTitle: { color: colors.ink, fontSize: 20, fontWeight: "700" },
  outlineButton: { minHeight: minTouchTarget, borderRadius: radius.md, borderColor: colors.action, borderWidth: 1, paddingHorizontal: 22, justifyContent: "center", marginTop: 20 },
  outlineText: { color: colors.action, fontSize: 16, fontWeight: "700" },
});
