import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { v2 } from "@laundry/contracts";
import { getV2Client } from "../../src/foundation/session";
import {
  kgLine,
  pieceLine,
  setKgCustodyCount,
  setKgWeightGrams,
  setPieceQuantity,
  kgLineFor,
  pieceCountFor,
  type BagLine,
} from "../../src/features/booking/lines";
import {
  rateHeadline,
  rateMissingCopy,
  unitHeadline,
  describeError,
} from "../../src/features/booking/presenters";
import { bagStore } from "../../src/features/booking/basket-store";
import { Loading, NoteCard } from "../../src/features/booking/ui";
import { colors, minTouchTarget, radius, spacing } from "../../src/theme";

// Product service detail. Everything shown comes from the server service and
// rate card. KG and quantity are kept separate for weight services: declared
// item count is for custody, grams drive the price. Nothing is invented here.

function gramsFromKg(raw: string): number {
  const kg = Number.parseFloat(raw.replace(",", "."));
  if (!Number.isFinite(kg) || kg <= 0) return 0;
  return Math.round(kg * 1000);
}

function countFrom(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export default function ServiceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const bag = bagStore();
  const lines = useSyncExternalStore(bag.subscribe, bag.getLines, bag.getLines);
  const [service, setService] = useState<v2.Service | null>(null);
  const [rate, setRate] = useState<v2.EffectiveRateSummary | null | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ kind: "note" | "error"; text: string } | null>(null);
  const [kgRaw, setKgRaw] = useState("");
  const [custodyRaw, setCustodyRaw] = useState("");
  const [pieceQty, setPieceQty] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setService(null);
    setRate(undefined);
    try {
      const client = getV2Client();
      const found = await client.getService(id);
      setService(found);
      try {
        const summaries = await client.getEffectiveRates({ serviceCode: found.code });
        setRate(summaries.find((summary) => summary.serviceCode === found.code) ?? null);
      } catch {
        // A service without an active rate card is bookable only when the
        // operator publishes one; the bag still records intent.
        setRate(null);
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  function mutateBag(update: (lines: BagLine[]) => BagLine[]) {
    try {
      bag.setLines(update(lines));
      setNotice(null);
    } catch (caught) {
      setNotice({ kind: "error", text: caught instanceof Error ? caught.message : "Could not update the bag" });
    }
  }

  if (error !== null) {
    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <NoteCard kind="error" title={describeError(error).title} body={describeError(error).body} actionLabel="Retry" onAction={() => void load()} />
        </ScrollView>
      </View>
    );
  }
  if (loading) {
    return (
      <View style={styles.screen}>
        <Loading label="Loading service" />
      </View>
    );
  }
  if (!service) {
    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <NoteCard kind="blocked" title="This service is not offered" body="It was removed from the catalog. Pick another service from the home screen." />
        </ScrollView>
      </View>
    );
  }

  const headline = rate ? rateHeadline(rate) : null;
  const activeGarments = service.garments.filter((g) => g.active);
  const eligibleGarmentTypes = service.billingUnit === "KG" ? [] : activeGarments;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        {service.imageUrl ? (
          <Image source={{ uri: service.imageUrl }} style={styles.image} accessibilityLabel={`${service.name} photograph`} />
        ) : null}
        <View style={styles.heroCard}>
          <Text style={styles.title} accessibilityRole="header">
            {service.name}
          </Text>
          <Text style={styles.unit}>{unitHeadline(service)}</Text>
          {headline ? (
            <>
              <Text style={styles.rate}>{headline.title}</Text>
              {headline.sub ? <Text style={styles.rateSub}>{headline.sub}</Text> : null}
              {rate?.synthetic ? <Text style={styles.synthetic}>Indicative demo rate</Text> : null}
            </>
          ) : (
            <Text style={styles.rate}>{rateMissingCopy()}</Text>
          )}
          <Text style={styles.description}>{service.description}</Text>
          <Text style={styles.turnaround}>
            Server turnaround target: {service.turnaroundHours} h. Your quote confirms the actual return window.
          </Text>
        </View>

        {service.careExclusions.length > 0 ? (
          <NoteCard kind="note" title="Not eligible for this service" body={service.careExclusions.join(", ")} />
        ) : null}
        {service.features.length > 0 ? (
          <NoteCard kind="note" title="Included steps" body={service.features.join(" · ")} />
        ) : null}

        {service.billingUnit !== "PIECE" ? (
          <View style={styles.kgCard}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              By weight
            </Text>
            <Text style={styles.kgHelp}>Enter the rough weight. The measured weight is confirmed at the facility, and the pickup team counts items separately.</Text>
            <TextInput
              value={kgRaw}
              onChangeText={setKgRaw}
              keyboardType="decimal-pad"
              placeholder="Weight in kg, e.g. 4"
              placeholderTextColor={colors.inkMuted}
              style={styles.input}
              accessibilityLabel={`Weight in kilograms for ${service.name}`}
            />
            <TextInput
              value={custodyRaw}
              onChangeText={setCustodyRaw}
              keyboardType="number-pad"
              placeholder="Approx item count (optional, for custody)"
              placeholderTextColor={colors.inkMuted}
              style={styles.input}
              accessibilityLabel={`Approximate item count for ${service.name}`}
            />
            <Pressable
              style={({ pressed }) => [styles.addButton, pressed && styles.pressedButton]}
              onPress={() => {
                const grams = gramsFromKg(kgRaw);
                if (grams <= 0) {
                  setNotice({ kind: "error", text: "Enter a weight in kilograms greater than 0." });
                  return;
                }
                mutateBag((all) => {
                  const custody = countFrom(custodyRaw);
                  if (kgLineFor(all, service.id)) {
                    const next = setKgWeightGrams(all, service.id, grams);
                    return custody === 0 ? setKgCustodyCount(next, service.id, undefined) : setKgCustodyCount(next, service.id, custody);
                  }
                  return all.concat(kgLine(service.id, grams, custody === 0 ? undefined : custody));
                });
                setKgRaw("");
                setCustodyRaw("");
                setNotice({ kind: "note", text: "Added to your bag. Loading is confirmed at pickup." });
              }}
              accessibilityRole="button"
              accessibilityLabel="Add weight to bag"
            >
              <Text style={styles.addText}>Add to bag</Text>
            </Pressable>
          </View>
        ) : null}

        {eligibleGarmentTypes.length > 0 ? (
          <View style={styles.pieceCard}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              Per item
            </Text>
            {eligibleGarmentTypes.map((garment) => {
              const count = pieceQty[garment.id] ?? 0;
              const inBag = pieceCountFor(lines, service.id, garment.id);
              return (
                <View key={garment.id} style={styles.garmentRow}>
                  <View style={styles.garmentCopy}>
                    <Text style={styles.garmentName}>{garment.name}</Text>
                  </View>
                  <View style={styles.stepper}>
                    <Pressable
                      onPress={() => {
                        const next = Math.max(0, count - 1);
                        setPieceQty((q) => ({ ...q, [garment.id]: next }));
                        if (inBag > 0) mutateBag((all) => setPieceQuantity(all, service.id, garment.id, Math.max(0, inBag - 1)));
                      }}
                      style={styles.step}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove one ${garment.name}`}
                    >
                      <Ionicons name="remove" size={18} color={colors.action} />
                    </Pressable>
                    <Text style={styles.count} accessibilityLabel={`${count} ${garment.name}`}>
                      {count}
                    </Text>
                    <Pressable
                      onPress={() => {
                        const next = count + 1;
                        setPieceQty((q) => ({ ...q, [garment.id]: next }));
                        mutateBag((all) =>
                          inBag > 0
                            ? setPieceQuantity(all, service.id, garment.id, inBag + 1)
                            : all.concat(pieceLine(service.id, garment.id, 1)),
                        );
                      }}
                      style={styles.step}
                      accessibilityRole="button"
                      accessibilityLabel={`Add one ${garment.name}`}
                    >
                      <Ionicons name="add" size={18} color={colors.action} />
                    </Pressable>
                  </View>
                </View>
              );
            })}
            <Text style={styles.kgHelp}>
              The stepper keeps your bag and this screen in step; the exact count is confirmed at pickup.
            </Text>
          </View>
        ) : null}

        {notice ? <NoteCard kind={notice.kind} title={notice.text} /> : null}
        <Pressable onPress={() => router.push("/basket")} style={styles.reviewBasket} accessibilityRole="button" accessibilityLabel="Review bag">
          <Text style={styles.reviewText}>Review bag ({lines.length} line{lines.length === 1 ? "" : "s"})</Text>
          <Ionicons name="arrow-forward" size={18} color={colors.action} />
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceTint },
  content: { padding: spacing.md, paddingBottom: 48, maxWidth: 560, width: "100%", alignSelf: "center" },
  image: { width: "100%", height: 160, borderRadius: radius.md, backgroundColor: colors.surfaceCard, marginBottom: spacing.md },
  heroCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  title: { color: colors.ink, fontSize: 26, fontWeight: "700" },
  unit: { color: colors.inkMuted, fontSize: 14, marginTop: 4 },
  rate: { color: colors.ink, fontSize: 17, fontWeight: "700", marginTop: 10 },
  rateSub: { color: colors.inkMuted, fontSize: 12, marginTop: 2 },
  synthetic: { color: colors.warning, fontSize: 12, fontWeight: "600", marginTop: 4 },
  description: { color: colors.inkMuted, fontSize: 15, lineHeight: 22, marginTop: 8 },
  turnaround: { color: colors.inkMuted, fontSize: 12, lineHeight: 18, marginTop: 8 },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: "700" },
  kgCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  kgHelp: { color: colors.inkMuted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  input: {
    color: colors.ink,
    backgroundColor: colors.surfaceCard,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    fontSize: 16,
    paddingHorizontal: 12,
    minHeight: minTouchTarget,
    marginTop: 10,
  },
  addButton: { backgroundColor: colors.action, minHeight: minTouchTarget, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", marginTop: 12 },
  pressedButton: { backgroundColor: colors.actionPressed },
  addText: { color: colors.surface, fontSize: 15, fontWeight: "700" },
  pieceCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  garmentRow: { flexDirection: "row", alignItems: "center", marginTop: 12, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 12 },
  garmentCopy: { flex: 1, minWidth: 0 },
  garmentName: { color: colors.ink, fontSize: 16, fontWeight: "600" },
  stepper: { flexDirection: "row", alignItems: "center", borderRadius: radius.sm, borderWidth: 1, borderColor: colors.action },
  step: { width: minTouchTarget, height: minTouchTarget, alignItems: "center", justifyContent: "center" },
  count: { minWidth: 28, textAlign: "center", color: colors.ink, fontSize: 16, fontWeight: "600" },
  reviewBasket: {
    minHeight: minTouchTarget,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    marginTop: spacing.md,
    padding: 12,
  },
  reviewText: { color: colors.action, fontSize: 15, fontWeight: "700" },
});
