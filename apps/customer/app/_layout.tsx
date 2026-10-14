import { Stack } from "expo-router";
import { colors } from "../src/theme";

export default function Layout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.ink,
        headerTitleStyle: { color: colors.ink, fontWeight: "700" },
        contentStyle: { backgroundColor: colors.surface },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Laundry", headerShown: false }} />
      <Stack.Screen name="basket" options={{ title: "Basket" }} />
      <Stack.Screen name="checkout" options={{ title: "Checkout" }} />
      <Stack.Screen name="orders" options={{ title: "Orders" }} />
      <Stack.Screen name="orders/[id]" options={{ title: "Order Details" }} />
      <Stack.Screen name="services/[id]" options={{ title: "Service Details" }} />
      <Stack.Screen name="help" options={{ title: "Help" }} />
      <Stack.Screen name="account" options={{ title: "Account" }} />
    </Stack>
  );
}
