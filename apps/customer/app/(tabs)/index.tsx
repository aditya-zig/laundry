import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { v2 } from "@laundry/contracts";
import { getV2Client } from "../../src/foundation/session";
import {
  catalogCardBookable,
  catalogEmptyReason,
  serviceCards,
  indexPublishedRates,
  type ServiceCard,
} from "../../src/features/booking/catalog-view";
import {
  bagHeadline,
  describeError,
  rateMissingCopy,
} from "../../src/features/booking/presenters";
import { bagTotals } from "../../src/features/booking/view";
import { bagStore } from "../../src/features/booking/basket-store";
import { Loading, NoteCard } from "../../src/features/booking/ui";
import { colors, minTouchTarget, radius, spacing } from "../../src/theme";

// Product home: public server catalog only. Rates are what the server
// publishes; services the catalog disables are shown as paused; nothing is
// invented here (no demo rates, imagery claims, ratings or delivery promises).

type RateLookup = Partial<Record<v2.ServiceCode, v2.EffectiveRateSummary |undefined>>;

function serviceIcon(code: string): keyof typeof Ionicons.glyphMap {
  switch (code) {
    case "WASH_FOLD":
      return "water-outline";
    case "WASH_PRESS":
      return "shirt-outline";
    case "PRESS_ONLY":
      return "flame-outline";
    case "DRY_CLEAN":
      return "sparkles-outline";
    default:
      return "layers-outline";
  }
}

export default function ProductHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [services, setServices] = useState<v2.Service[] | null>(null);
  const [rates, setRates] = useState<RateLookup>({});
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const bagLines = useSyncExternalStore(bagStore().subscribe, bagStore().getLines, bagStore().getLines);
  const bagCount = bagTotals(
    bagLines.map((line) => ({ line, status: "ok" as const })),
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setServices(null);
    setRates({});
    try {
      const client = getV2Client();
      const listed = await client.listServices();
      // The wire response is an ARRAY even when filtered by serviceCode.
      // Index validated summaries, never treat the whole response as a rate.
      const summaries = await Promise.all(listed.filter(service => service.active).map(service =>
        client.getEffectiveRates({ serviceCode: service.code }).catch(() => [])));
      setRates(indexPublishedRates(summaries.flat()));
      setServices(listed);
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cards = services ? serviceCards(services, (code) => rates[code]) : [];
  const emptyReason = services ? catalogEmptyReason(services) : null;

  return (
    <View style={[styles.screen, { paddingTop: 12 }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 96 + insets.bottom }]}>
        <Text style={styles.brand} accessibilityRole="header">
          Laundry
        </Text>
        <Text style={styles.tagline}>Browse freely. Sign-in is only asked when you book.</Text>

        {loading ? <Loading label="Loading services" /> : null}
        {error !== null ? (
          <NoteCard
            kind="error"
            title={describeError(error).title}
            body={describeError(error).body}
            actionLabel="Retry"
            onAction={() => void load()}
          />
        ) : null}
        {services !== null && services.length > 0 ? (
          <>
            {cards.map((card) => (
              <ServiceCardRow key={card.service.id} card={card} />
            ))}
            <Text style={styles.finePrint}>
              Prices shown come from the server rate cards. Your order is priced by an explicit
              quote before booking, and payment is due when your clothes are returned.
            </Text>
          </>
        ) : null}
        {emptyReason === "NO_CATALOG" && !error ? (
          <NoteCard
            kind="blocked"
            title="No services are published here yet"
            body="The server has not published a service catalog for this environment. Nothing can be browsed or booked until the operator publishes one."
            actionLabel="Refresh"
            onAction={() => void load()}
          />
        ) : null}
        {emptyReason === "ALL_PAUSED" && !error ? (
          <NoteCard
            kind="blocked"
            title="Laundry is paused right now"
            body="Every service in the catalog is currently paused by the operator. Check back later."
            actionLabel="Refresh"
            onAction={() => void load()}
          />
        ) : null}
      </ScrollView>

      {bagCount.units > 0 ? (
        <View style={[styles.bagBar, { bottom: 12 + insets.bottom }]}>
          <Pressable
            onPress={() => router.push("/basket")}
            style={styles.bagSummary}
            accessibilityRole="button"
            accessibilityLabel="Open bag"
          >
            <Text style={styles.bagTitle}>{bagHeadline(bagCount.units)}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function ServiceCardRow({ card }: { card: ServiceCard }) {
  const bookable = catalogCardBookable(card);
  const router = useRouter();
  return (
      <Pressable
        onPress={() => router.push({ pathname: "/services/[id]", params: { id: card.service.id } })}
        style={({ pressed }) => [styles.card, pressed && styles.pressed, !bookable && styles.pausedCard]}
        accessibilityRole="button"
        accessibilityLabel={`${card.service.name}. ${card.unitTitle}. ${card.paused ? "Paused" : "Open details"}`}
      >
        <View style={styles.cardTop}>
          <View style={styles.iconWrap}>
            <Ionicons name={serviceIcon(card.service.code)} size={22} color={colors.action} />
          </View>
          <View style={styles.cardCopy}>
            <Text style={styles.name}>{card.service.name}</Text>
            <Text style={styles.unit}>{card.unitTitle}</Text>
          </View>
          {card.paused ? (
            <View style={styles.pausedPill}>
              <Text style={styles.pausedText}>Paused</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.rate}>{card.rate ? card.rate.title : rateMissingCopy()}</Text>
        {card.rate?.sub ? <Text style={styles.rateSub}>{card.rate.sub}</Text> : null}
        {card.synthetic ? <Text style={styles.rateSub}>Indicative demo rate — not approved launch pricing</Text> : null}
        <Text style={styles.description}>{card.service.description}</Text>
      </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceTint },
  content: { padding: spacing.md, maxWidth: 560, width: "100%", alignSelf: "center" },
  brand: { color: colors.ink, fontSize: 28, fontWeight: "700" },
  tagline: { color: colors.inkMuted, fontSize: 15, marginTop: 4, lineHeight: 22 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  pressed: { backgroundColor: colors.surfaceCard },
  pausedCard: { opacity: 0.7 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconWrap: {
    width: 26,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  cardCopy: { flex: 1, minWidth: 0 },
  name: { color: colors.ink, fontSize: 17, fontWeight: "700" },
  unit: { color: colors.inkMuted, fontSize: 13, marginTop: 2 },
  pausedPill: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pausedText: { color: colors.warning, fontSize: 12, fontWeight: "700" },
  rate: { color: colors.ink, fontSize: 15, fontWeight: "700", marginTop: 10 },
  rateSub: { color: colors.inkMuted, fontSize: 12, marginTop: 2 },
  description: { color: colors.inkMuted, fontSize: 14, lineHeight: 20, marginTop: 6 },
  finePrint: { color: colors.inkMuted, fontSize: 12, lineHeight: 18, marginTop: spacing.md },
  bagBar: {
    position: "absolute",
    left: 12,
    right: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    flexDirection: "row",
    padding: 8,
    shadowColor: colors.ink,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  bagSummary: { flex: 1, minHeight: minTouchTarget, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8 },
  bagTitle: { color: colors.ink, fontSize: 16, fontWeight: "700", flex: 1 },
});
