import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { colors, minTouchTarget } from "../../src/theme";

// Custom DESIGN.md tab bar: white fill, 1px hairline, 44px targets, teal is
// the only accent. TAB_BAR_HEIGHT is shared so the floating cart bar and the
// content padding can sit above it.
export const TAB_BAR_HEIGHT = 56;

type IoniconName = keyof typeof Ionicons.glyphMap;

const TAB_META: Record<string, { label: string; icons: [IoniconName, IoniconName] }> = {
  index: { label: "Home", icons: ["home-outline", "home"] },
  orders: { label: "Orders", icons: ["receipt-outline", "receipt"] },
  help: { label: "Help", icons: ["help-buoy-outline", "help-buoy"] },
  account: { label: "Account", icons: ["person-outline", "person"] },
};

interface TabBarProps {
  state: {
    routes: { name: string }[];
    index: number;
  };
  navigation: {
    navigate: (name: string) => void;
  };
}

function TabBar({ state, navigation }: TabBarProps) {
  const { bottom } = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: bottom }]}>
      <View style={styles.row}>
        {state.routes.map((route, i) => {
          const meta = TAB_META[route.name] ?? { label: route.name, icons: ["grid-outline", "grid"] as [IoniconName, IoniconName] };
          const focused = state.index === i;
          return (
            <Pressable
              key={route.name}
              onPress={() => navigation.navigate(route.name)}
              style={styles.tab}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={meta.label}
            >
              <Ionicons
                name={focused ? meta.icons[1] : meta.icons[0]}
                size={22}
                color={focused ? colors.action : colors.inkMuted}
              />
              <Text
                style={{
                  color: focused ? colors.action : colors.inkMuted,
                  fontSize: 14,
                  fontWeight: focused ? "700" : "500",
                  marginTop: 2,
                }}
              >
                {meta.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.ink }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="index" options={{ headerShown: false }} />
      <Tabs.Screen name="orders" options={{ title: "Orders" }} />
      <Tabs.Screen name="help" options={{ title: "Help" }} />
      <Tabs.Screen name="account" options={{ title: "Account" }} />
    </Tabs>
  );
}

const styles = {
  bar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  row: {
    flexDirection: "row" as const,
    height: TAB_BAR_HEIGHT,
    paddingHorizontal: 8,
  },
  tab: {
    flex: 1,
    minHeight: minTouchTarget,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
};
