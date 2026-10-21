import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Address, Quote } from "@laundry/contracts";
import { getClient } from "../src/api";
import { getBasket } from "./services/[id]";
import { getDraftAddressId, setDraftAddressId } from "../src/cart";
import { checkoutBlockReason, formatINR, isQuoteExpired } from "../src/guards";
import { colors, spacing, minTouchTarget, radius, typography, maxContentWidth } from "../src/theme";

export default function Checkout() {
  const { pickupStart, pickupEnd, returnBy } = useLocalSearchParams<{
    pickupStart: string;
    pickupEnd: string;
    returnBy: string;
  }>();
  const router = useRouter();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkout, setCheckout] = useState<{ orderId: string; paymentId: string; paymentUrl: string; status: "AWAITING_PAYMENT" | "RESOLUTION_REQUIRED" } | null>(null);
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [label, setLabel] = useState("Home");
  const [line1, setLine1] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [areaEligible, setAreaEligible] = useState(true);

  const lines = getBasket();
  const addressId = getDraftAddressId() ?? addresses?.[0]?.id ?? null;
  const gate = checkoutBlockReason({
    areaEligible,
    addressId,
    lineCount: lines.length,
    quoteExpired: quote ? isQuoteExpired(quote.expiresAt) : false,
  });

  function loadAddresses() {
    setAddressError(null);
    getClient()
      .checkServiceArea()
      .then((area) => setAreaEligible(area.serviceable))
      // Fail open here: if the area endpoint itself is down, listAddresses
      // below surfaces the API error instead of a wrong coverage verdict.
      .catch(() => setAreaEligible(true));
    getClient()
      .listAddresses()
      .then((all) => {
        setAddresses(all);
        if (!getDraftAddressId() && all.length > 0) setDraftAddressId(all[0].id);
      })
      .catch((e) => {
        setAddresses([]);
        setAddressError(e instanceof Error ? e.message : "Could not load addresses");
      });
  }
  useEffect(loadAddresses, []);

  async function saveAddress() {
    if (!line1.trim() || !city.trim() || !postalCode.trim()) {
      setAddressError("Fill street, city, and postal code to save an address.");
      return;
    }
    setLoading(true);
    setAddressError(null);
    try {
      const created = await getClient().createAddress({
        label: label.trim() || "Home",
        line1: line1.trim(),
        city: city.trim(),
        postalCode: postalCode.trim(),
      });
      setAddresses((prev) => [...(prev ?? []), created]);
      setDraftAddressId(created.id);
      setLine1("");
      setCity("");
      setPostalCode("");
    } catch (e) {
      setAddressError(e instanceof Error ? e.message : "Saving the address failed");
    } finally {
      setLoading(false);
    }
  }

  async function requestQuote() {
    if (!addressId) {
      setError("Add a delivery address before requesting a quote.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const q = await getClient().createQuote({
        addressId,
        lines,
        pickupWindow: { start: pickupStart, end: pickupEnd, timezone: "Asia/Kolkata" },
        requestedReturnBy: returnBy,
        timezone: "Asia/Kolkata",
      });
      setQuote(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Quote failed");
    } finally {
      setLoading(false);
    }
  }

  async function pay() {
    if (!quote) return;
    if (isQuoteExpired(quote.expiresAt)) {
      setError("This quote expired. Request fresh terms to continue.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const c = await getClient().createCheckout(quote.id);
      setCheckout({ orderId: c.orderId, paymentId: c.paymentId, paymentUrl: c.paymentUrl, status: c.status });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.surfaceTint }} contentContainerStyle={{ alignItems: "center" }}>
      <View style={{ width: "100%", maxWidth: maxContentWidth, padding: spacing.md, paddingBottom: 48 }}>
      <View style={{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md }}>
      <Text style={{ color: colors.action, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 }}>STEP 2 OF 2</Text>
      <Text style={{ color: colors.ink, fontSize: typography.sizes.display, fontWeight: "800", marginTop: 4 }}>Checkout</Text>
      <Text style={{ color: colors.inkMuted, marginTop: 4, lineHeight: 22 }}>
        DEMO: payment runs through a labeled simulator, never a live charge.
      </Text>
      </View>

      <View style={{ marginTop: spacing.md, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md }}>
      <Text style={{ fontWeight: "800", color: colors.ink, fontSize: typography.sizes.body }}>1. Delivery address</Text>
      {addresses === null && <ActivityIndicator style={{ marginTop: 8 }} color={colors.action} />}
      {addressError && <Text style={{ color: colors.danger, marginTop: 8 }}>{addressError}</Text>}
      {(addresses ?? []).map((a) => (
        <Pressable
          key={a.id}
          onPress={() => setDraftAddressId(a.id)}
          style={{
            marginTop: 8,
            borderColor: addressId === a.id ? colors.action : colors.border,
            borderWidth: addressId === a.id ? 2 : 1,
            borderRadius: radius.md,
            padding: spacing.md,
            minHeight: minTouchTarget,
            justifyContent: "center",
            backgroundColor: addressId === a.id ? colors.surfaceTint : colors.surface,
          }}
          accessibilityRole="button"
          accessibilityLabel={`Use address ${a.label}`}
        >
          <Text style={{ color: colors.ink, fontWeight: addressId === a.id ? "700" : "400" }}>
            {a.label}: {a.line1}, {a.city} {a.postalCode}
          </Text>
        </Pressable>
      ))}
      <View style={{ marginTop: 12, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surfaceCard }}>
        <Text style={{ color: colors.ink, fontWeight: "700" }}>New address</Text>
        <TextInput value={label} onChangeText={setLabel} placeholder="Label (Home)" placeholderTextColor={colors.inkMuted} style={{ borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: 10, marginTop: 8, minHeight: minTouchTarget, color: colors.ink, backgroundColor: colors.surface }} accessibilityLabel="Address label" />
        <TextInput value={line1} onChangeText={setLine1} placeholder="Street address" placeholderTextColor={colors.inkMuted} style={{ borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: 10, marginTop: 8, minHeight: minTouchTarget, color: colors.ink, backgroundColor: colors.surface }} accessibilityLabel="Street address" />
        <TextInput value={city} onChangeText={setCity} placeholder="City" placeholderTextColor={colors.inkMuted} style={{ borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: 10, marginTop: 8, minHeight: minTouchTarget, color: colors.ink, backgroundColor: colors.surface }} accessibilityLabel="City" />
        <TextInput value={postalCode} onChangeText={setPostalCode} placeholder="Postal code" placeholderTextColor={colors.inkMuted} style={{ borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: 10, marginTop: 8, minHeight: minTouchTarget, color: colors.ink, backgroundColor: colors.surface }} accessibilityLabel="Postal code" />
        <Pressable
          onPress={saveAddress}
          style={{ borderColor: colors.action, borderWidth: 1, borderRadius: radius.md, padding: 12, marginTop: 8, minHeight: minTouchTarget, justifyContent: "center" }}
          accessibilityRole="button"
          accessibilityLabel="Save address"
        >
          <Text style={{ color: colors.action, textAlign: "center", fontWeight: "700" }}>Save address</Text>
        </Pressable>
      </View>
      </View>
      <View style={{ marginTop: spacing.md, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md }}>
      <Text style={{ fontWeight: "800", color: colors.ink, fontSize: typography.sizes.body }}>2. Quote and payment</Text>

      {gate && !quote && <Text style={{ color: colors.warning, marginTop: 12 }}>{gate}</Text>}
      <Pressable
        onPress={requestQuote}
        style={{ backgroundColor: colors.action, borderRadius: radius.md, padding: 12, marginTop: 12, minHeight: minTouchTarget, justifyContent: "center" }}
        accessibilityRole="button"
        accessibilityLabel="Request quote"
      >
        <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>Request quote</Text>
      </Pressable>
      {loading && <ActivityIndicator style={{ marginTop: 16 }} color={colors.action} />}
      {error && <Text style={{ color: colors.danger, marginTop: 12 }}>{error}</Text>}
      {quote && (
        <View style={{ marginTop: spacing.md, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surfaceCard }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: colors.ink, fontWeight: "800", fontSize: typography.sizes.title }}>
            {formatINR(quote.totalMinor)}
          </Text>
          <View style={{ backgroundColor: quote.provisional ? colors.warningSoft : colors.successSoft, borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10 }}>
            <Text style={{ fontSize: 11, fontWeight: "800", color: colors.ink }}>{quote.provisional ? "PROVISIONAL" : "FIXED"}</Text>
          </View>
          </View>
          {quote.breakdown.map((b) => (
            <View key={b.label} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
            <Text style={{ color: colors.inkMuted }}>
              {b.label}
            </Text>
            <Text style={{ color: colors.ink, fontWeight: "600" }}>{formatINR(b.amountMinor)}</Text>
            </View>
          ))}
          <Text style={{ color: colors.inkMuted, marginTop: 8 }}>
            Return window: {quote.promisedReturnWindow.start} to {quote.promisedReturnWindow.end}
          </Text>
          {isQuoteExpired(quote.expiresAt) ? (
            <View style={{ marginTop: 8, backgroundColor: colors.warningSoft, borderRadius: radius.sm, padding: 10 }}>
            <Text style={{ color: colors.warning, fontWeight: "700" }}>
              This quote expired. Request fresh terms to continue.
            </Text>
            </View>
          ) : (
            <Pressable
              onPress={pay}
              style={{ backgroundColor: colors.action, borderRadius: radius.md, padding: 12, marginTop: 12, minHeight: minTouchTarget, justifyContent: "center" }}
              accessibilityRole="button"
              accessibilityLabel="Pay with demo simulator"
            >
              <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>Pay (DEMO simulator)</Text>
            </Pressable>
          )}
        </View>
      )}
      </View>
      {checkout && (
        <View style={{ marginTop: spacing.md, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md }}>
          {checkout.status === "RESOLUTION_REQUIRED" ? (
            <Text style={{ color: colors.success, fontWeight: "700" }}>Payment received; booking being resolved.</Text>
          ) : (
            <Text style={{ color: colors.ink, fontWeight: "700" }}>
              Checkout created. Complete payment in the hosted DEMO checkout below; the order confirms after capture.
            </Text>
          )}
          <Text style={{ color: colors.inkMuted, marginTop: 4 }}>Order {checkout.orderId}</Text>
          <Text style={{ color: colors.inkMuted, marginTop: 4 }}>Hosted DEMO checkout: {checkout.paymentUrl}</Text>
          <Pressable
            onPress={() => router.push({ pathname: "/orders/[id]", params: { id: checkout.orderId, paymentId: checkout.paymentId } })}
            style={{ marginTop: 12, minHeight: minTouchTarget, justifyContent: "center", backgroundColor: colors.surfaceTint, borderRadius: radius.pill, alignItems: "center" }}
            accessibilityRole="button"
            accessibilityLabel="Track order"
          >
            <Text style={{ color: colors.action, fontWeight: "700" }}>Track order</Text>
          </Pressable>
        </View>
      )}
      </View>
    </ScrollView>
  );
}
