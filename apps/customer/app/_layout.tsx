import { Stack } from "expo-router";
import { colors } from "../src/theme";

export default function Layout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.ink,
        contentStyle: { backgroundColor: colors.surface },
      }}
    />
  );
}
