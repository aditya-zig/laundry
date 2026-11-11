import { useEffect, useState } from "react";
import { Button, Text, View } from "react-native";
import { Stack } from "expo-router";
import { colors } from "../src/theme";
import { getFoundation, prepareSessionStorage, requiresProtectedStorage } from "../src/foundation/session";

export default function Layout() {
  const [ready, setReady] = useState(!requiresProtectedStorage);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!requiresProtectedStorage) return;
    let active = true;
    void (async () => {
      try {
        await prepareSessionStorage();
        const restored = await getFoundation().initialize();
        if (restored.state === 'restoreFailed') throw restored.cause;
        if (active) setReady(true);
      } catch (error) {
        if (active) setFailure(error instanceof Error ? error.message : 'Protected session restore failed');
      }
    })();
    return () => { active = false; };
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
      <Stack.Screen
        name="index"
        options={{
          title: "Laundry Partner",
        }}
      />
      <Stack.Screen
        name="jobs/[id]"
        options={{
          title: "Task Details",
        }}
      />
      <Stack.Screen
        name="history"
        options={{
          title: "Completed Tasks",
        }}
      />
      <Stack.Screen
        name="account"
        options={{
          title: "Partner Account",
        }}
      />
    </Stack>
  );
}
