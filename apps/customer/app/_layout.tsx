import { useEffect, useState } from "react";
import { Button, Text, View } from "react-native";
import { Stack } from "expo-router";
import { getFoundation, onCustomerIdentityChange, prepareSessionStorage, requiresProtectedStorage } from "../src/foundation/session";
import { bagStore } from "../src/features/booking/basket-store";
import { colors } from "../src/theme";

// Root is a plain stack so the four product-spec tabs render inside a custom
// bottom bar, while detail screens (service, basket, checkout, order) push
// full width with the standard header on top of it.
export default function Layout() {
  const [ready, setReady] = useState(!requiresProtectedStorage);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let previousActor: string | null = null;
    const unsubscribe = onCustomerIdentityChange(actor => {
      if (previousActor && previousActor !== actor?.id) bagStore().clear();
      previousActor = actor?.id ?? null;
    });
    void (async () => {
      try {
        if (requiresProtectedStorage) await prepareSessionStorage();
        const restored = await getFoundation().initialize();
        if (requiresProtectedStorage && restored.state === 'restoreFailed') throw restored.cause;
        if (active) setReady(true);
      } catch (error) {
        if (active && requiresProtectedStorage) setFailure(error instanceof Error ? error.message : 'Protected session restore failed');
        // Web configuration failures remain visible in the individual screens.
      }
    })();
    return () => { active = false; unsubscribe(); };
  }, [attempt]);
  if (!ready) return <View style={{ flex: 1, padding: 24, justifyContent: 'center', backgroundColor: colors.surface }}>
    <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 20, fontWeight: '700' }}>{failure ? 'Session storage unavailable' : 'Preparing protected session'}</Text>
    <Text style={{ marginVertical: 16, color: colors.ink }}>{failure ?? 'Opening the device-protected journal before signing in or sending commands.'}</Text>
    {failure && <Button title="Retry session restore" onPress={() => { setFailure(null); setAttempt(value => value + 1); }} />}
  </View>;
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
