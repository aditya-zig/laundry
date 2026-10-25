import { useEffect } from "react";
import { Stack } from "expo-router";
import { getFoundation, onCustomerIdentityChange } from "../src/foundation/session";
import { bagStore } from "../src/features/booking/basket-store";
import { colors } from "../src/theme";

// Root is a plain stack so the four product-spec tabs render inside a custom
// bottom bar, while detail screens (service, basket, checkout, order) push
// full width with the standard header on top of it.
export default function Layout() {
  useEffect(() => {
    let previousActor: string | null = null;
    const unsubscribe = onCustomerIdentityChange(actor => {
      if (previousActor && previousActor !== actor?.id) bagStore().clear();
      previousActor = actor?.id ?? null;
    });
    try {
      // Configuration/restore failures are rendered by the individual screens.
      void getFoundation().initialize().catch(() => undefined);
    } catch { /* No legacy client or demo fallback on missing v2 configuration. */ }
    return unsubscribe;
  }, []);
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.ink,
        headerTitleStyle: { color: colors.ink, fontWeight: "700" },
        contentStyle: { backgroundColor: colors.surfaceTint },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="basket" options={{ title: "Basket" }} />
      <Stack.Screen name="checkout" options={{ title: "Checkout" }} />
      <Stack.Screen name="orders/[id]" options={{ title: "Order Details" }} />
      <Stack.Screen name="services/[id]" options={{ title: "Service Details" }} />
    </Stack>
  );
}
