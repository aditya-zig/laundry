import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { v2 } from "@laundry/contracts";
import { getV2Client } from "../src/foundation/session";
import {
  removeBagLine,
  setKgWeightGrams,
  setPieceQuantity,
  type BagLine,
  type InvalidLineReason,
} from "../src/features/booking/lines";
import { bagHeadline, describeError } from "../src/features/booking/presenters";
import { bagTotals, staleLabel, viewBagLines } from "../src/features/booking/view";
import { bagStore } from "../src/features/booking/basket-store";
import { Loading, NoteCard } from "../src/features/booking/ui";
import { colors, minTouchTarget, radius, spacing } from "../src/theme";

// Product bag. Lines are reconciled against the live server catalog: stale
// lines are labelled honestly, excluded from the quote, and removable. No
// authoritative price is computed here — the server quote does that.

interface BagRow {
  line: BagLine;
  status: "ok" | InvalidLineReason;
  service?: v2.Service;
  garment?: v2.GarmentEligibility;
}

export default function Basket() {
  const router = useRouter();
  const bag = bagStore();
  const lines = useSyncExternalStore(bag.subscribe, bag.getLines, bag.getLines);
  const [services, setServices] = useState<v2.Service[] | null>(null);
  const [catalogError, setCatalogError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setCatalogError(null);
    try {
      setServices(await getV2Client().listServices());
    } catch (caught) {
      setCatalogError(caught);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  const rows: BagRow[] = services
    ? viewBagLines(lines, services)
    : lines.map((line) => ({ line, status: "ok" as const }));
  const validCount = bagTotals(rows);

  function mutate(update: (current: BagLine[]) => BagLine[]) {
    try {
      bag.setLines(update(lines));
      setNotice(null);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not update the bag");
    }
  }

  const rowsMeta = rows;

  function lineTitle(row: BagRow): string {
    if (row.line.kind === "KG") return "By weight";
    return row.garment?.name ?? "Item";
  }

  function lineSub(row: (typeof rows)[number]): string {
    const service = row.service?.name ?? "Service";
    if (row.line.kind === "KG") {
      const grams = row.line.weightGrams >= 1000 ? `${(row.line.weightGrams / 1000).toLocaleString("en-GB")} kg` : `${row.line.weightGrams} g`;
      const custody = row.line.custodyCount === undefined ? "" : ` · ${row.line.custodyCount} item${row.line.custodyCount === 1 ? "" : "s"} declared`;
      return `${service} · about ${grams}${custody}`;
    }
    return `${service} · ${row.line.pieceQuantity} item${row.line.pieceQuantity === 1 ? "" : "s"}`;
  }

  if (lines.length === 0) {
    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title} accessibilityRole="header">
            Your bag
          </Text>
          <NoteCard
            kind="note"
            title="Your bag is empty"
            body="Pick a service on the home screen to start filling it."
            actionLabel="Browse services"
            onAction={() => router.push("/")}
          />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.titleRow}>
          <Text style={styles.title} accessibilityRole="header">
            Your bag
          </Text>
          <Text style={styles.counter}>{bagHeadline(validCount.units)}</Text>
        </View>

        {loading ? <Loading label="Checking the live catalog" /> : null}
        {catalogError !== null ? (
          <NoteCard
            kind="error"
            title={describeError(catalogError).title}
            body={`${describeError(catalogError).body} The bag still holds your lines, but the live catalog is needed to reconcile them.`}
            actionLabel="Retry"
            onAction={() => void loadProducts()}
          />
        ) : null}

        {rowsMeta.map((row, index) => {
          const piece = row.status === "ok" && row.line.kind === "PIECE" ? row.line : null;
          const kg = row.status === "ok" && row.line.kind === "KG" ? row.line : null;
          return (
            <View key={`${row.line.serviceId}-${index}`} style={styles.lineCard}>
              <View style={styles.lineTop}>
                <View style={styles.lineCopy}>
                  <Text style={[styles.lineTitle, row.status !== "ok" && styles.staleTitle]}>{lineTitle(row)}</Text>
                  <Text style={styles.lineSub}>{lineSub(row)}</Text>
                  {row.line.kind === "KG" && row.line.custodyCount !== undefined ? (
                    <Text style={styles.lineMeta}>Count (custody) is separate from billed weight.</Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => mutate((current) => removeBagLine(current, index))}
                  style={styles.remove}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${lineTitle(row)} from bag`}
                >
                  <Text style={styles.removeText}>Remove</Text>
                </Pressable>
              </View>
              {row.status !== "ok" ? (
                <Text style={styles.staleNote} accessibilityRole="alert">
                  {staleLabel(row.status)} It will be excluded from the server quote.
                </Text>
              ) : null}
              {row.status === "ok" && row.line.kind === "PIECE" ? (
                <View style={styles.qtyRow}>
                  <Text style={styles.qtyLabel}>Count</Text>
                  <TextInput
                    value={String(row.line.pieceQuantity)}
                    keyboardType="number-pad"
                    onChangeText={(raw) => {
                      if (!piece) return;
                      const next = Number.parseInt(raw, 10);
                      if (Number.isInteger(next) && next >= 0) mutate((current) => setPieceQuantity(current, piece.serviceId, piece.garmentTypeId, next));
                    }}
                    style={styles.qtyInput}
                    accessibilityLabel={`Count for ${lineTitle(row)}`}
                  />
                </View>
              ) : null}
              {row.status === "ok" && row.line.kind === "KG" ? (
                <View style={styles.qtyRow}>
                  <Text style={styles.qtyLabel}>Billed weight (kg)</Text>
                  <TextInput
                    value={String(row.line.weightGrams / 1000)}
                    keyboardType="decimal-pad"
                    onEndEditing={(event) => {
                      if (!kg) return;
                      const grams = Math.round(Number.parseFloat(event.nativeEvent.text.replace(",", ".")) * 1000);
                      if (Number.isFinite(grams) && grams > 0) mutate((current) => setKgWeightGrams(current, kg.serviceId, grams));
                      else setNotice("Enter a weight greater than 0 kg.");
                    }}
                    style={styles.qtyInput}
                    accessibilityLabel={`Billed weight in kilograms for ${lineTitle(row)}`}
                  />
                </View>
              ) : null}
            </View>
          );
        })}
        {notice ? <NoteCard kind="error" title={notice} /> : null}

        <NoteCard
          kind="note"
          title="What happens next"
          body="You pick a server-published pickup slot and an owned address, the server returns an explicit quote, and booking is confirmed only after you press Confirm. Payment is due when your clothes are returned."
        />

        <Pressable
          onPress={() => router.push("/checkout")}
          disabled={validCount.units === 0}
          style={({ pressed }) => [styles.continue, validCount.units === 0 && styles.disabled, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Continue to booking"
        >
          <Text style={styles.continueText}>Continue to booking</Text>
          <Ionicons name="arrow-forward" size={18} color={colors.surface} />
        </Pressable>
        {validCount.units === 0 ? (
          <Text style={styles.finePrint}>Every line is out of date or disabled. Remove them and add current services.</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceTint },
  content: { padding: spacing.md, paddingBottom: 64, maxWidth: 560, width: "100%", alignSelf: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { color: colors.ink, fontSize: 26, fontWeight: "700" },
  counter: { color: colors.inkMuted, fontSize: 13, fontWeight: "600", textAlign: "right", flexShrink: 1 },
  lineCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  lineTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  lineCopy: { flex: 1, minWidth: 0 },
  lineTitle: { color: colors.ink, fontSize: 16, fontWeight: "700" },
  staleTitle: { color: colors.warning },
  lineSub: { color: colors.inkMuted, fontSize: 13, lineHeight: 19, marginTop: 2 },
  lineMeta: { color: colors.inkMuted, fontSize: 12, marginTop: 4 },
  remove: { minHeight: minTouchTarget, justifyContent: "center", paddingHorizontal: 8 },
  removeText: { color: colors.danger, fontSize: 14, fontWeight: "700" },
  staleNote: { color: colors.warning, fontSize: 13, lineHeight: 19, marginTop: 8 },
  qtyRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  qtyLabel: { color: colors.inkMuted, fontSize: 13, flex: 1 },
  qtyInput: {
    color: colors.ink,
    backgroundColor: colors.surfaceCard,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    fontSize: 16,
    paddingHorizontal: 10,
    minHeight: 44,
    width: 96,
    textAlign: "center",
  },
  continue: { backgroundColor: colors.action, minHeight: minTouchTarget + 10, borderRadius: radius.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginTop: spacing.md, padding: 12 },
  pressed: { backgroundColor: colors.actionPressed },
  disabled: { opacity: 0.5 },
  continueText: { color: colors.surface, fontSize: 16, fontWeight: "700" },
  finePrint: { color: colors.inkMuted, fontSize: 12, lineHeight: 18, marginTop: 10, textAlign: "center" },
});
