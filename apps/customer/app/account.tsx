import { Pressable, ScrollView, Text } from "react-native";
import { setSession } from "../src/api";
import { colors, spacing, minTouchTarget } from "../src/theme";

export default function Account() {
  return (
    <ScrollView style={{ padding: spacing.md }}>
      <Text style={{ color: colors.ink, fontSize: 24, fontWeight: "700" }}>Account</Text>
      <Text style={{ color: colors.inkMuted, marginTop: 8 }}>
        Signed in with a demo session. Phone verification is required before real checkout.
      </Text>
      <Pressable onPress={() => setSession(undefined)} style={{ marginTop: spacing.md, minHeight: minTouchTarget, justifyContent: "center" }}>
        <Text style={{ color: colors.danger, fontWeight: "700" }}>Sign out (clears local session)</Text>
      </Pressable>
    </ScrollView>
  );
}
