import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Link, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { Service } from "@wandary/contracts";
import { getClient, ensureDemoSession } from "../../src/api";
import {
  countForGarment,
  estimateSubtotalMinor,
  totalGarments,
  MAX_GARMENTS,
  type CartLine,
} from "../../src/cart";
import {
  addBasketLine,
  getBasketLines,
  setBasketGarmentQuantity,
  subscribeBasket,
} from "../../src/cart-store";
import { formatINR } from "../../src/guards";
import { colors, spacing, minTouchTarget, radius, typography } from "../../src/theme";

type IoniconName = keyof typeof Ionicons.glyphMap;

// Slot hours come from the backend area check ("09:00-18:00 Asia/Kolkata");
// nothing on this screen invents turnaround or delivery promises.
function chipText(hours: string): string {
  const firstHalf = hours.split(" ").slice(0, 2).join(" ");
  return `Pickup ${firstHalf}`;
}

type AreaCheck = { serviceable: boolean; areaId: string; hours: string };

// Icon per service code. Labels under each circle carry the meaning; icons
// are only shape. Unknown codes fall back to a plain list glyph.
function serviceIcon(code: string): IoniconName {
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

interface Product {
  key: string;
  serviceId: string;
  garmentTypeId: string;
  serviceCode: string;
  serviceName: string;
  garmentName: string;
  priceMinor: number;
  turnaroundHours: number;
  allFiltered: boolean;
}

function buildProducts(services: Service[], serviceFilter: string, query: string): Product[] {
  const q = query.trim().toLowerCase();
  const out: Product[] = [];
  for (const s of services) {
    if (serviceFilter !== "ALL" && s.id !== serviceFilter) continue;
    for (const g of s.garments) {
      const hits =
        !q ||
        g.name.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q);
      if (!hits) continue;
      out.push({
        key: `${s.id}|${g.id}`,
        serviceId: s.id,
        garmentTypeId: g.id,
        serviceCode: s.code,
        serviceName: s.name,
        garmentName: g.name,
        priceMinor: g.priceMinor,
        turnaroundHours: s.turnaroundHours,
        allFiltered: serviceFilter !== "ALL" || q.length > 0,
      });
    }
  }
  return out;
}

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // useSyncExternalStore keeps every cart surface on one snapshot.
  const lines = useSyncExternalStore(subscribeBasket, getBasketLines, getBasketLines);
  const [services, setServices] = useState<Service[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [area, setArea] = useState<AreaCheck | null>(null);
  const [query, setQuery] = useState("");
  const [activeService, setActiveService] = useState<string>("ALL");
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setArea(await getClient().checkServiceArea());
      await ensureDemoSession();
      setServices(await getClient().listServices());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load services");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const priceByGarmentId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of services ?? []) for (const g of s.garments) map[g.id] = g.priceMinor;
    return map;
  }, [services]);

  const catalog = useMemo(
    () => buildProducts(services ?? [], activeService, query),
    [services, activeService, query],
  );

  const cartGarments = totalGarments(lines);
  const estimate = estimateSubtotalMinor(lines, priceByGarmentId);

  const mutateBasket = useCallback((update: () => void) => {
    try { update(); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not update basket"); }
  }, []);
  const onAdd = useCallback((serviceId: string, garmentTypeId: string) => {
    mutateBasket(() => addBasketLine({ serviceId, garmentTypeId, quantity: 1 }));
  }, [mutateBasket]);
  const onStep = useCallback((serviceId: string, garmentTypeId: string, next: number) => {
    mutateBasket(() => setBasketGarmentQuantity(serviceId, garmentTypeId, next));
  }, [mutateBasket]);

  const sectionTitle =
    activeService === "ALL"
      ? query.trim()
        ? "Search results"
        : "Services"
      : (services?.find((s) => s.id === activeService)?.name ?? "Services");

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <FlatList
        data={catalog}
        numColumns={2}
        keyExtractor={(p) => p.key}
        columnWrapperStyle={styles.tileRow}
        extraData={[lines, services, activeService, query]}
        contentContainerStyle={{ paddingBottom: 92 + insets.bottom }}
        ListHeaderComponent={
          <HomeHeader
            area={area}
            error={error}
            loading={loading}
            onRetry={load}
            services={services}
            activeService={activeService}
            onSelectService={setActiveService}
            query={query}
            onQuery={setQuery}
            sectionTitle={sectionTitle}
          />
        }
        ListEmptyComponent={
          services === null && !error && loading === false ? (
            <ActivityIndicator color={colors.action} accessibilityLabel="Loading services" />
          ) : services !== null && !error && catalog.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Nothing matches yet</Text>
              <Text style={styles.emptyText}>
                Try a shorter search term. All services count garments only.
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <ProductTile
            product={item}
            count={countForGarment(lines, item.serviceId, item.garmentTypeId)}
            onAdd={onAdd}
            onStep={onStep}
            atLimit={cartGarments >= MAX_GARMENTS}
          />
        )}
      />

      {cartGarments > 0 && (
        <FloatingCartBar
          cartGarments={cartGarments}
          estimate={estimate}
          onOpenSheet={() => setSheetOpen(true)}
          onPay={() => router.push("/basket")}
        />
      )}

      <CartSheet
        visible={sheetOpen}
        lines={lines}
        services={services}
        priceByGarmentId={priceByGarmentId}
        onStep={onStep}
        onClose={() => setSheetOpen(false)}
        onReviewBasket={() => {
          setSheetOpen(false);
          router.push("/basket");
        }}
      />
    </View>
  );
}

function HomeHeader(props: {
  area: AreaCheck | null;
  error: string | null;
  loading: boolean;
  onRetry: () => void;
  services: Service[] | null;
  activeService: string;
  onSelectService: (id: string) => void;
  query: string;
  sectionTitle: string;
  onQuery: (q: string) => void;
}) {
  const { area, error, loading, onRetry, services, activeService, onSelectService, query, onQuery, sectionTitle } = props;
  const areaEligible = area === null ? true : area.serviceable;
  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <Text style={styles.brand} accessibilityRole="header">
          Laundry
        </Text>
        <View style={styles.demoPill}>
          <Text style={styles.demoPillText}>DEMO</Text>
        </View>
      </View>

      {area !== null && (
        <View
          style={[styles.etaChip, !areaEligible && styles.etaChipWarning]}
          accessibilityLabel={
            areaEligible
              ? `Serviceable area. ${chipText(area.hours)}`
              : "This address is outside the current service area."
          }
        >
          <Ionicons name="location-outline" size={14} color={areaEligible ? colors.action : colors.warning} />
          <Text style={[styles.etaChipText, !areaEligible && styles.etaChipTextWarning]}>
            {areaEligible ? `${area.areaId} · ${chipText(area.hours)}` : "Outside current service area"}
          </Text>
        </View>
      )}

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color={colors.inkMuted} />
        <TextInput
          value={query}
          onChangeText={onQuery}
          placeholder="Search wash, press, dry clean"
          placeholderTextColor={colors.inkMuted}
          style={styles.searchInput}
          accessibilityLabel="Search services"
        />
        {query.length > 0 && (
          <Pressable
            onPress={() => onQuery("")}
            style={styles.step}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Ionicons name="close" size={16} color={colors.inkMuted} />
          </Pressable>
        )}
      </View>

      {services !== null && services.length > 0 && (
        <View style={{ paddingTop: 4 }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}
          >
            {[{ id: "ALL", name: "All", code: "ALL" }, ...services].map((service) => {
              const selected = activeService === service.id;
              return (
                <Pressable key={service.id} onPress={() => onSelectService(service.id)} style={styles.category} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`Filter ${service.name}`}>
                  <View style={[styles.categoryCircle, selected && styles.categoryCircleActive]}>
                    <Ionicons name={serviceIcon(service.code)} size={22} color={selected ? colors.surface : colors.inkMuted} />
                  </View>
                  <Text style={styles.categoryText} numberOfLines={1}>{service.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {error && (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Could not load services</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            onPress={onRetry}
            style={styles.retryButton}
            accessibilityRole="button"
            accessibilityLabel="Retry loading services"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      {services === null && !error && loading && (
        <ActivityIndicator style={{ marginTop: spacing.md }} color={colors.action} />
      )}

      <Text style={styles.sectionTitle} accessibilityRole="header">{sectionTitle}</Text>

      <View style={styles.railSpacer} />

      {loading ? <ActivityIndicator style={{ marginTop: spacing.md }} color={colors.action} /> : null}
    </View>
  );
}


function ProductTile({ product, count, onAdd, onStep, atLimit }: {
  product: Product; count: number; onAdd: (s: string, g: string) => void;
  onStep: (s: string, g: string, n: number) => void; atLimit: boolean;
}) {
  return (
    <View style={styles.tile}>
      <Link href={{ pathname: "/services/[id]", params: { id: product.serviceId } }} asChild>
        <Pressable style={styles.tileTop} accessibilityRole="link" accessibilityLabel={`Details for ${product.serviceName}, ${product.garmentName}`}>
          <View style={styles.productArt}>
            <Ionicons name={serviceIcon(product.serviceCode)} size={30} color={colors.action} />
          </View>
          <Text style={styles.serviceLabel}>{product.serviceName}</Text>
          <Text style={styles.productName}>{product.garmentName}</Text>
        </Pressable>
      </Link>
      <Text style={styles.price}>
        {formatINR(product.priceMinor)}
        <Text style={styles.priceUnit}> / garment</Text>
      </Text>
      <View style={styles.tileFooter}>
        {count === 0 ? (
          <Pressable onPress={() => onAdd(product.serviceId, product.garmentTypeId)} disabled={atLimit} style={[styles.addButton, atLimit && styles.disabled]} accessibilityRole="button" accessibilityLabel={`Add ${product.garmentName} for ${product.serviceName}`}>
            <Text style={styles.addText}>ADD</Text>
          </Pressable>
        ) : (
          <View style={styles.stepper}>
            <Pressable onPress={() => onStep(product.serviceId, product.garmentTypeId, count - 1)} style={styles.step} accessibilityRole="button" accessibilityLabel={`Remove one ${product.garmentName} for ${product.serviceName}`}>
              <Ionicons name="remove" size={16} color={colors.action} />
            </Pressable>
            <Text style={styles.quantity}>{count}</Text>
            <Pressable onPress={() => onStep(product.serviceId, product.garmentTypeId, count + 1)} disabled={atLimit} style={[styles.step, atLimit && styles.disabled]} accessibilityRole="button" accessibilityLabel={`Add one ${product.garmentName} for ${product.serviceName}`}>
              <Ionicons name="add" size={16} color={colors.action} />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

function FloatingCartBar({ cartGarments, estimate, onOpenSheet, onPay }: {
  cartGarments: number; estimate: number | null; onOpenSheet: () => void; onPay: () => void;
}) {
  return (
    <View style={styles.cartBar}>
      <Pressable onPress={onOpenSheet} style={styles.cartSummary} accessibilityRole="button" accessibilityLabel="Open bag summary">
        <View style={styles.cartSummaryRow}>
          <Text style={styles.cartTitle}>{estimate === null ? "Quote at checkout" : `Estimate ${formatINR(estimate)}`}</Text>
          <Ionicons name="chevron-up" size={16} color={colors.inkMuted} />
        </View>
        <Text style={styles.cartSubtitle}>{cartGarments} item{cartGarments === 1 ? "" : "s"} · server quote at checkout</Text>
      </Pressable>
      <Pressable onPress={onPay} style={styles.cartAction} accessibilityRole="button" accessibilityLabel="Pay for bag items">
        <Text style={styles.cartActionText}>{cartGarments === 1 ? "Pay for 1 item" : `Pay for ${cartGarments} items`}</Text>
      </Pressable>
    </View>
  );
}

function CartSheet({ visible, lines, services, priceByGarmentId, onStep, onClose, onReviewBasket }: {
  visible: boolean; lines: CartLine[]; services: Service[] | null; priceByGarmentId: Record<string, number>;
  onStep: (s: string, g: string, n: number) => void; onClose: () => void; onReviewBasket: () => void;
}) {
  const estimate = estimateSubtotalMinor(lines, priceByGarmentId);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.headerRow}><Text style={styles.sectionTitle}>Your bag</Text><Pressable onPress={onClose} style={styles.step} accessibilityRole="button" accessibilityLabel="Close bag summary"><Ionicons name="close" size={24} color={colors.ink} /></Pressable></View>
          <ScrollView>
            {lines.length === 0 && <Text style={styles.emptyText}>Your bag is empty. Add a garment to get started.</Text>}
            {lines.map((line, index) => {
              const service = services?.find(s => s.id === line.serviceId);
              const garment = service?.garments.find(g => g.id === line.garmentTypeId);
              const unitPrice = priceByGarmentId[line.garmentTypeId];
              return (
                <View key={`${line.serviceId}-${line.garmentTypeId}-${index}`} style={styles.sheetLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.productName}>{garment?.name ?? "Garment"}</Text>
                    <Text style={styles.sheetSub}>
                      {service?.name ?? "Service"}
                      {unitPrice === undefined ? "" : ` · ${formatINR(unitPrice)} each`}
                    </Text>
                  </View>
                  <View style={styles.sheetStepper}>
                    <Pressable onPress={() => onStep(line.serviceId, line.garmentTypeId, line.quantity - 1)} style={styles.step} accessibilityRole="button" accessibilityLabel={`Remove one ${garment?.name ?? "garment"}`}>
                      <Ionicons name="remove" size={16} color={colors.action} />
                    </Pressable>
                    <Text style={styles.quantity}>{line.quantity}</Text>
                    <Pressable onPress={() => onStep(line.serviceId, line.garmentTypeId, line.quantity + 1)} style={styles.step} accessibilityRole="button" accessibilityLabel={`Add one ${garment?.name ?? "garment"}`}>
                      <Ionicons name="add" size={16} color={colors.action} />
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </ScrollView>
          <Text style={styles.sheetTotal}>{estimate === null ? "Quote at checkout" : `Estimated subtotal ${formatINR(estimate)}`}</Text>
          <Text style={styles.emptyText}>Demo prices. The server confirms fees and the final quote at checkout.</Text>
          <Pressable onPress={onReviewBasket} disabled={lines.length === 0} style={[styles.retryButton, lines.length === 0 && styles.disabled]} accessibilityRole="button" accessibilityLabel="Review basket from bag"><Text style={styles.retryText}>Review basket</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceTint, width: "100%", maxWidth: 560, alignSelf: "center" },
  header: { padding: spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  brand: { fontSize: typography.sizes.display, fontWeight: "700", color: colors.ink },
  demoPill: { backgroundColor: colors.warningSoft, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  demoPillText: { color: colors.warning, fontSize: 12, fontWeight: "700" },
  etaChip: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12, alignSelf: "flex-start", backgroundColor: colors.actionSoft, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8, maxWidth: "100%" },
  etaChipText: { color: colors.ink, fontSize: 12, fontWeight: "600", flexShrink: 1 },
  etaChipWarning: { backgroundColor: colors.warningSoft },
  etaChipTextWarning: { color: colors.warning },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, marginTop: 16, paddingHorizontal: 12 },
  searchInput: { flex: 1, minWidth: 0, minHeight: minTouchTarget, color: colors.ink, fontSize: 16 },
  rail: { gap: 10, paddingVertical: 16 },
  category: { width: 88, alignItems: "center", borderRadius: radius.sm, paddingVertical: 4 },
  categoryCircle: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  categoryCircleActive: { backgroundColor: colors.action, borderColor: colors.action },
  categoryText: { color: colors.ink, fontSize: 11, fontWeight: "600", marginTop: 6, textAlign: "center" },
  sectionTitle: { fontSize: 20, fontWeight: "700", color: colors.ink, marginTop: 12 },
  railSpacer: { height: 4 },
  tileRow: { gap: 12, paddingHorizontal: spacing.md },
  tile: { flex: 1, maxWidth: "50%", minWidth: 0, backgroundColor: colors.surface, padding: 12, marginBottom: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  tileTop: {},
  productArt: { height: 88, backgroundColor: colors.surfaceCard, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  serviceLabel: { color: colors.inkMuted, fontSize: 11, fontWeight: "600" },
  productName: { color: colors.ink, fontSize: 15, fontWeight: "600", marginTop: 2 },
  price: { color: colors.ink, fontSize: 14, fontWeight: "700", marginTop: 8 },
  priceUnit: { color: colors.inkMuted, fontSize: 11, fontWeight: "400" },
  tileFooter: { flexDirection: "row", justifyContent: "flex-end", marginTop: 8 },
  addButton: { minHeight: minTouchTarget, paddingHorizontal: 16, borderRadius: radius.sm, backgroundColor: colors.actionSoft, alignItems: "center", justifyContent: "center" },
  addText: { color: colors.action, fontSize: 13, fontWeight: "700", letterSpacing: 0.5 },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minWidth: 128, borderWidth: 1, borderColor: colors.action, borderRadius: radius.sm },
  step: { minWidth: minTouchTarget, minHeight: minTouchTarget, paddingHorizontal: 8, justifyContent: "center", alignItems: "center" },
  quantity: { color: colors.ink, fontSize: 16, fontWeight: "600" },
  disabled: { opacity: 0.5 },
  emptyCard: { padding: spacing.md },
  emptyTitle: { fontSize: 20, color: colors.ink, fontWeight: "700" },
  emptyText: { color: colors.inkMuted, fontSize: 16, paddingVertical: 8, lineHeight: 22 },
  errorCard: { backgroundColor: colors.dangerSoft, padding: spacing.md, borderRadius: radius.md, marginTop: 12 },
  errorTitle: { color: colors.danger, fontWeight: "700", fontSize: 16 },
  errorText: { color: colors.danger, fontSize: 16, marginVertical: 8 },
  retryButton: { backgroundColor: colors.action, minHeight: minTouchTarget, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, marginTop: 12 },
  retryText: { color: colors.surface, fontSize: 16, fontWeight: "700" },
  cartBar: { position: "absolute", left: 12, right: 12, bottom: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, flexDirection: "row", alignItems: "center", padding: 8, gap: 8, shadowColor: colors.ink, shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  cartSummary: { flex: 1, minHeight: minTouchTarget, justifyContent: "center", paddingHorizontal: 4 },
  cartSummaryRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  cartTitle: { color: colors.ink, fontSize: 16, fontWeight: "700" },
  cartSubtitle: { color: colors.inkMuted, fontSize: 12, marginTop: 2 },
  cartAction: { minHeight: minTouchTarget, borderRadius: radius.sm, backgroundColor: colors.action, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  cartActionText: { color: colors.surface, fontSize: 14, fontWeight: "700" },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,31,61,0.4)" },
  sheet: { backgroundColor: colors.surface, maxHeight: "80%", padding: spacing.md, paddingBottom: 32, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, width: "100%", maxWidth: 560, alignSelf: "center" },
  sheetLine: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 12 },
  sheetSub: { color: colors.inkMuted, fontSize: 12, marginTop: 2 },
  sheetStepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: colors.action, borderRadius: radius.sm },
  sheetTotal: { color: colors.ink, fontSize: 18, fontWeight: "700", marginTop: 12 },
});
