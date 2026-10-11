import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Address, Quote } from "@wandary/contracts";
import { getClient } from "../src/api";
import { getBasket, draftAddressId, setDraftAddressId } from "./basket";
import { checkoutBlockReason, formatINR, isQuoteExpired } from "../src/guards";
import { colors, spacing, minTouchTarget } from "../src/theme";

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
  const addressId = draftAddressId ?? addresses?.[0]?.id ?? null;
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
        if (!draftAddressId && all.length > 0) setDraftAddressId(all[0].id);
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
    <ScrollView style={{ padding: spacing.md }}>
      <Text style={{ color: colors.ink, fontSize: 24, fontWeight: "700" }}>Checkout</Text>
      <Text style={{ color: colors.inkMuted, marginTop: 4 }}>
        DEMO: payment runs through a labeled simulator, never a live charge.
      </Text>

      <Text style={{ marginTop: spacing.md, fontWeight: "700", color: colors.ink }}>Delivery address</Text>
      {addresses === null && <ActivityIndicator style={{ marginTop: 8 }} />}
      {addressError && <Text style={{ color: colors.danger, marginTop: 8 }}>{addressError}</Text>}
      {(addresses ?? []).map((a) => (
        <Pressable
          key={a.id}
          onPress={() => setDraftAddressId(a.id)}
          style={{
            marginTop: 8,
            borderColor: addressId === a.id ? colors.action : colors.border,
            borderWidth: 2,
            borderRadius: 12,
            padding: spacing.md,
            minHeight: minTouchTarget,
            justifyContent: "center",
          }}
        >
          <Text style={{ color: colors.ink, fontWeight: addressId === a.id ? "700" : "400" }}>
            {a.label}: {a.line1}, {a.city} {a.postalCode}
          </Text>
        </Pressable>
      ))}
      <View style={{ marginTop: 12, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: spacing.md }}>
        <Text style={{ color: colors.ink, fontWeight: "600" }}>New address</Text>
        <TextInput value={label} onChangeText={setLabel} placeholder="Label (Home)" style={{ borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 8, marginTop: 8 }} />
        <TextInput value={line1} onChangeText={setLine1} placeholder="Street address" style={{ borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 8, marginTop: 8 }} />
        <TextInput value={city} onChangeText={setCity} placeholder="City" style={{ borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 8, marginTop: 8 }} />
        <TextInput value={postalCode} onChangeText={setPostalCode} placeholder="Postal code" style={{ borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 8, marginTop: 8 }} />
        <Pressable
          onPress={saveAddress}
          style={{ borderColor: colors.action, borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 8, minHeight: minTouchTarget, justifyContent: "center" }}
        >
          <Text style={{ color: colors.action, textAlign: "center", fontWeight: "700" }}>Save address</Text>
        </Pressable>
      </View>

      {gate && !quote && <Text style={{ color: colors.warning, marginTop: 12 }}>{gate}</Text>}
      <Pressable
        onPress={requestQuote}
        style={{ backgroundColor: colors.action, borderRadius: 12, padding: 12, marginTop: 12, minHeight: minTouchTarget, justifyContent: "center" }}
      >
        <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>Request quote</Text>
      </Pressable>
      {loading && <ActivityIndicator style={{ marginTop: 16 }} />}
      {error && <Text style={{ color: colors.danger, marginTop: 12 }}>{error}</Text>}
      {quote && (
        <View style={{ marginTop: spacing.md, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: spacing.md }}>
          <Text style={{ color: colors.ink, fontWeight: "700" }}>
            Total {formatINR(quote.totalMinor)} {quote.provisional ? "(provisional)" : "(fixed)"}
          </Text>
          {quote.breakdown.map((b) => (
            <Text key={b.label} style={{ color: colors.inkMuted, marginTop: 4 }}>
              {b.label}: {formatINR(b.amountMinor)}
            </Text>
          ))}
          <Text style={{ color: colors.inkMuted, marginTop: 8 }}>
            Return window: {quote.promisedReturnWindow.start} to {quote.promisedReturnWindow.end}
          </Text>
          {isQuoteExpired(quote.expiresAt) ? (
            <Text style={{ color: colors.warning, marginTop: 8 }}>
              This quote expired. Request fresh terms to continue.
            </Text>
          ) : (
            <Pressable
              onPress={pay}
              style={{ backgroundColor: colors.action, borderRadius: 12, padding: 12, marginTop: 12, minHeight: minTouchTarget, justifyContent: "center" }}
            >
              <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>Pay (DEMO simulator)</Text>
            </Pressable>
          )}
        </View>
      )}
      {checkout && (
        <View style={{ marginTop: spacing.md }}>
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
            style={{ marginTop: 12, minHeight: minTouchTarget, justifyContent: "center" }}
          >
            <Text style={{ color: colors.action, fontWeight: "700" }}>Track order</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}
