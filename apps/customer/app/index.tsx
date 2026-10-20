import { useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Link } from "expo-router";
import type { Service } from "@wandary/contracts";
import { getClient, demoSignIn, getToken } from "../src/api";
import { colors, spacing, minTouchTarget, radius, typography, maxContentWidth } from "../src/theme";
import { reviewEmptyLabel } from "../src/guards";

export default function Home() {
  const [services, setServices] = useState<Service[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [address, setAddress] = useState("Bengaluru 560001");
  const [authed, setAuthed] = useState(() => getToken() !== undefined);
  const [area, setArea] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const areaCheck = await getClient().checkServiceArea();
      setArea(
        areaCheck.serviceable
          ? `Serving ${areaCheck.areaId} · ${areaCheck.hours}`
          : "This address is outside the current service area.",
      );
      if (!getToken()) await demoSignIn();
      setAuthed(true);
      setServices(await getClient().listServices());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load services");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.surfaceTint }} contentContainerStyle={{ alignItems: "center" }}>
      <View style={{ width: "100%", maxWidth: maxContentWidth, padding: spacing.md, paddingBottom: 48 }}>
        <View style={styles.demoPill}>
          <Text style={styles.demoPillText}>DEMO BUILD</Text>
        </View>
        <Text style={styles.display} accessibilityRole="header">Laundry</Text>
        <Text style={styles.subtitle}>Laundry pickup, minus the phone tag.</Text>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>DELIVERY ADDRESS</Text>
          <Text style={styles.cardTitle}>Delivering to: {address}</Text>
          {area ? <Text style={styles.area}>{area}</Text> : null}
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="Enter serviceable address"
            placeholderTextColor={colors.inkMuted}
            style={styles.input}
            accessibilityLabel="Delivery address"
          />
          <Pressable
            onPress={load}
            style={({ pressed }) => [styles.primaryButton, pressed && { backgroundColor: colors.actionPressed }]}
            accessibilityRole="button"
            accessibilityLabel={authed ? "Browse services" : "Continue with demo sign-in"}
          >
            <Text style={styles.primaryButtonText}>
              {authed ? "Browse services" : "Continue with demo sign-in"}
            </Text>
          </Pressable>
          {loading && <ActivityIndicator style={{ marginTop: spacing.md }} color={colors.action} />}
        </View>

        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Could not load services</Text>
            <Text style={{ color: colors.danger, marginTop: 4 }}>{error}</Text>
            <Pressable onPress={load} style={{ marginTop: 8, minHeight: minTouchTarget, justifyContent: "center" }} accessibilityRole="button" accessibilityLabel="Retry loading services">
              <Text style={{ color: colors.action, fontWeight: "700" }}>Retry</Text>
            </Pressable>
          </View>
        )}

        {services && services.length === 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>No services here yet</Text>
            <Text style={styles.subtitle}>Try a nearby serviceable address. Coverage is configured per area.</Text>
          </View>
        )}

        {(services ?? []).length > 0 && (
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Services ({services!.length})</Text>
            <Text style={styles.sectionHint}>Photos explain each service. Prices always show a unit.</Text>
          </View>
        )}
        {(services ?? []).map((s) => (
          <ServiceCard key={s.id} service={s} />
        ))}

        <View style={styles.navGrid}>
          <NavPill href="/orders" label="Orders" />
          <NavPill href="/basket" label="Basket" />
          <NavPill href="/help" label="Help" />
          <NavPill href="/account" label="Account" />
        </View>
      </View>
    </ScrollView>
  );
}

function NavPill({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} asChild>
      <Pressable style={styles.navPill} accessibilityRole="button" accessibilityLabel={label}>
        <Text style={styles.navPillText}>{label}</Text>
      </Pressable>
    </Link>
  );
}

function ServiceCard({ service }: { service: Service }) {
  const [imgOk, setImgOk] = useState(true);
  // React Native Image has no reliable SVG support on Android/iOS, so prefer
  // the native-safe PNG sibling (assets/services/*.png) off-web. The server
  // still serves the SVG originals; onError keeps the text fallback.
  const imageUri =
    Platform.OS !== "web" && service.imageUrl.endsWith(".svg")
      ? service.imageUrl.slice(0, -".svg".length) + ".png"
      : service.imageUrl;
  return (
    <Link
      href={{ pathname: "/services/[id]", params: { id: service.id } }}
      style={{ marginTop: spacing.md, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surface }}
    >
      <View>
        {imgOk ? (
          <Image
            source={{ uri: imageUri }}
            onError={() => setImgOk(false)}
            style={{ width: "100%", height: 168, backgroundColor: colors.surfaceTint }}
            accessibilityLabel={`${service.name} photo`}
          />
        ) : (
          <View style={{ height: 168, backgroundColor: colors.surfaceTint, justifyContent: "center", alignItems: "center", padding: spacing.md }}>
            <Text style={{ color: colors.action, fontSize: 40, fontWeight: "800" }}>
              {service.name.slice(0, 1)}
            </Text>
            <Text style={{ color: colors.inkMuted, marginTop: 4, textAlign: "center" }}>
              Service photography loading. {service.name} is still selectable below.
            </Text>
          </View>
        )}
        <View style={{ padding: spacing.md }}>
          <View style={styles.metaRow}>
            <View style={styles.pricePill}>
              <Text style={styles.pricePillText}>{service.priceUnit}</Text>
            </View>
            <Text style={styles.reviewText}>{reviewEmptyLabel(0)}</Text>
          </View>
          <Text style={styles.serviceName}>{service.name}</Text>
          <Text style={styles.serviceDesc} numberOfLines={3}>{service.description}</Text>
          <Text style={styles.serviceCta}>View details and pricing</Text>
        </View>
      </View>
    </Link>
  );
}

const styles = {
  demoPill: {
    alignSelf: "flex-start" as const,
    backgroundColor: colors.surfaceCard,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  demoPillText: {
    color: colors.inkMuted,
    fontSize: 11,
    fontWeight: "800" as const,
    letterSpacing: 0.6,
  },
  display: {
    color: colors.ink,
    fontSize: typography.sizes.display,
    fontWeight: "800" as const,
    letterSpacing: -0.4,
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
    borderRadius: radius.lg,
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
    fontSize: typography.sizes.title,
  },
  area: {
    color: colors.inkMuted,
    marginTop: 4,
    fontSize: typography.sizes.body,
  },
  input: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 12,
    marginTop: 12,
    color: colors.ink,
    backgroundColor: colors.surface,
    minHeight: minTouchTarget,
  },
  primaryButton: {
    backgroundColor: colors.action,
    borderRadius: radius.md,
    padding: 12,
    marginTop: 12,
    minHeight: minTouchTarget,
    justifyContent: "center" as const,
  },
  primaryButtonText: {
    color: "#fff",
    textAlign: "center" as const,
    fontWeight: "700" as const,
    fontSize: typography.sizes.body,
  },
  errorCard: {
    marginTop: spacing.md,
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
  sectionRow: {
    marginTop: spacing.lg,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: typography.sizes.title,
    fontWeight: "800" as const,
  },
  sectionHint: {
    color: colors.inkMuted,
    marginTop: 4,
    fontSize: typography.sizes.body,
  },
  metaRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: 8,
  },
  pricePill: {
    backgroundColor: colors.actionSoft,
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  pricePillText: {
    color: colors.ink,
    fontSize: typography.sizes.caption,
    fontWeight: "700" as const,
  },
  reviewText: {
    color: colors.inkMuted,
    fontSize: typography.sizes.caption,
  },
  serviceName: {
    color: colors.ink,
    fontSize: typography.sizes.title,
    fontWeight: "800" as const,
    marginTop: 8,
  },
  serviceDesc: {
    color: colors.inkMuted,
    marginTop: 4,
    fontSize: typography.sizes.body,
    lineHeight: 22,
  },
  serviceCta: {
    color: colors.action,
    marginTop: 8,
    fontWeight: "700" as const,
    fontSize: typography.sizes.body,
  },
  navGrid: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 8,
    marginTop: spacing.lg,
  },
  navPill: {
    flexGrow: 1,
    flexBasis: "45%" as const,
    minHeight: minTouchTarget,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    paddingHorizontal: spacing.md,
  },
  navPillText: {
    color: colors.ink,
    fontWeight: "700" as const,
    fontSize: typography.sizes.body,
  },
};
