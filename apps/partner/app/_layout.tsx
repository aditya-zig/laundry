import { Stack } from "expo-router";
import { colors } from "../src/theme";

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
