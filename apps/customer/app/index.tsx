import { useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Link } from "expo-router";
import type { Service } from "@wandary/contracts";
import { getClient, demoSignIn, getToken } from "../src/api";
import { colors, spacing, minTouchTarget } from "../src/theme";
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
    <ScrollView style={{ backgroundColor: colors.surface, padding: spacing.md }}>
      <Text style={{ color: colors.ink, fontSize: 28, fontWeight: "700" }}>Wandary</Text>
      <Text style={{ color: colors.inkMuted, marginTop: 4 }}>Laundry pickup, minus the phone tag. DEMO build.</Text>
      <Text style={{ color: colors.ink, marginTop: spacing.md, fontWeight: "600" }}>
        Delivering to: {address}
      </Text>
      {area && (
        <Text style={{ color: colors.inkMuted, marginTop: 4 }}>
          {area}
        </Text>
      )}
      <TextInput
        value={address}
        onChangeText={setAddress}
        placeholder="Enter serviceable address"
        style={{ borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 8 }}
      />
      <Pressable
        onPress={load}
        style={{ backgroundColor: colors.action, borderRadius: 12, padding: 12, marginTop: 12, minHeight: minTouchTarget, justifyContent: "center" }}
      >
        <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>
          {authed ? "Browse services" : "Continue with demo sign-in"}
        </Text>
      </Pressable>
      {loading && <ActivityIndicator style={{ marginTop: spacing.lg }} />}
      {error && (
        <View style={{ marginTop: spacing.lg }}>
          <Text style={{ color: colors.danger }}>{error}</Text>
          <Pressable onPress={load} style={{ marginTop: 8, minHeight: minTouchTarget, justifyContent: "center" }}>
            <Text style={{ color: colors.action, fontWeight: "700" }}>Retry</Text>
          </Pressable>
        </View>
      )}
      {services && services.length === 0 && (
        <Text style={{ marginTop: spacing.lg, color: colors.inkMuted }}>No services available here yet.</Text>
      )}
      {(services ?? []).map((s) => (
        <ServiceCard key={s.id} service={s} />
      ))}
      <View style={{ flexDirection: "row", gap: 16, marginTop: spacing.lg, paddingBottom: 48 }}>
        <Link href="/orders" style={{ color: colors.action, fontWeight: "700" }}>Orders</Link>
        <Link href="/basket" style={{ color: colors.action, fontWeight: "700" }}>Basket</Link>
        <Link href="/help" style={{ color: colors.action, fontWeight: "700" }}>Help</Link>
        <Link href="/account" style={{ color: colors.action, fontWeight: "700" }}>Account</Link>
      </View>
    </ScrollView>
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
      style={{ marginTop: spacing.md, borderColor: colors.border, borderWidth: 1, borderRadius: 16, overflow: "hidden" }}
    >
      <View>
        {imgOk ? (
          <Image
            source={{ uri: imageUri }}
            onError={() => setImgOk(false)}
            style={{ width: "100%", height: 160, backgroundColor: colors.surfaceTint }}
            accessibilityLabel={`${service.name} photo`}
          />
        ) : (
          <View style={{ height: 160, backgroundColor: colors.surfaceTint, justifyContent: "center", alignItems: "center", padding: spacing.md }}>
            <Text style={{ color: colors.action, fontSize: 40, fontWeight: "800" }}>
              {service.name.slice(0, 1)}
            </Text>
            <Text style={{ color: colors.inkMuted, marginTop: 4, textAlign: "center" }}>
              Service photography loading. {service.name} is still selectable below.
            </Text>
          </View>
        )}
        <View style={{ padding: spacing.md }}>
          <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "700" }}>{service.name}</Text>
          <Text style={{ color: colors.inkMuted, marginTop: 4 }}>{service.description}</Text>
          <Text style={{ color: colors.ink, marginTop: 8, fontWeight: "600" }}>{service.priceUnit}</Text>
          <Text style={{ color: colors.inkMuted, marginTop: 4 }}>{reviewEmptyLabel(0)}</Text>
        </View>
      </View>
    </Link>
  );
}
