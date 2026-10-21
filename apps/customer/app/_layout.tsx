import { Stack } from "expo-router";
import { colors } from "../src/theme";

// Root is a plain stack so the four product-spec tabs render inside a custom
// bottom bar, while detail screens (service, basket, checkout, order) push
// full width with the standard header on top of it.
export default function Layout() {
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
