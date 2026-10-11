import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { getCurrentUser, getToken, signOut } from "../src/api";
import {
  colors,
  maxContentWidth,
  minTouchTarget,
  radius,
  spacing,
  typography,
} from "../src/theme";

export default function AccountScreen() {
  const router = useRouter();
  const user = getCurrentUser();
  const token = getToken();

  function handleSignOut() {
    signOut();
    router.replace("/");
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.centerWrapper}>
        <View style={styles.demoTag}>
          <Text style={styles.demoTagText}>[DEMO] RIDER SESSION</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Partner Profile</Text>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Name</Text>
            <Text style={styles.infoValue}>{user?.name ?? "Demo Rider"}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Phone</Text>
            <Text style={styles.infoValue}>{user?.phone ?? "+91 98765 43210"}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Role</Text>
            <Text style={styles.infoValue}>{user?.role ?? "rider"}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Partner ID</Text>
            <Text style={styles.infoValue}>{user?.id ?? "demo-rider-session"}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Auth Status</Text>
            <Text style={styles.infoValue}>
              {token ? "Authenticated (Demo)" : "Not signed in"}
            </Text>
          </View>
        </View>

        {/* Explicit No-Earnings Notice per spec */}
        <View style={styles.payrollCard}>
          <Text style={styles.payrollTitle}>Partner Employment & Payroll</Text>
          <Text style={styles.payrollText}>
            Wandary does not provide payroll, settlement, or earnings calculation. Payouts and work shifts are governed by your licensed logistics service provider contract.
          </Text>
        </View>

        {/* Cache & Security Notice */}
        <View style={styles.card}>
          <Text style={styles.cardHeading}>Security & Cache</Text>
          <Text style={styles.bodyMuted}>
            Active task data is cached locally during shifts. Signing out purges all cached job details and customer addresses from memory.
          </Text>

          <Pressable
            onPress={handleSignOut}
            style={({ pressed }: { pressed: boolean }) => [
              styles.signOutButton,
              pressed && styles.signOutButtonPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Sign out and purge cached jobs"
          >
            <Text style={styles.signOutButtonText}>
              Sign Out & Purge Job Cache
            </Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surfaceTint,
  },
  container: {
    padding: spacing.md,
    alignItems: "center",
  },
  centerWrapper: {
    width: "100%",
    maxWidth: maxContentWidth,
  },
  demoTag: {
    backgroundColor: "#FEE2E2",
    borderColor: "#FCA5A5",
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.md,
    alignSelf: "flex-start",
  },
  demoTagText: {
    color: colors.danger,
    fontSize: typography.sizes.caption,
    fontWeight: "700",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  title: {
    color: colors.ink,
    fontSize: typography.sizes.title,
    fontWeight: "700",
    marginBottom: spacing.md,
  },
  cardHeading: {
    color: colors.ink,
    fontSize: typography.sizes.body,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceTint,
  },
  infoLabel: {
    color: colors.inkMuted,
    fontSize: typography.sizes.caption,
    fontWeight: "600",
  },
  infoValue: {
    color: colors.ink,
    fontSize: typography.sizes.caption,
    fontWeight: "700",
  },
  payrollCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  payrollTitle: {
    color: colors.ink,
    fontSize: typography.sizes.body,
    fontWeight: "700",
    marginBottom: 4,
  },
  payrollText: {
    color: colors.inkMuted,
    fontSize: typography.sizes.caption,
    lineHeight: 18,
  },
  bodyMuted: {
    color: colors.inkMuted,
    fontSize: typography.sizes.caption,
    lineHeight: 20,
  },
  signOutButton: {
    minHeight: minTouchTarget,
    backgroundColor: "#FEE2E2",
    borderColor: "#FCA5A5",
    borderWidth: 1,
    borderRadius: radius.sm,
    justifyContent: "center",
    alignItems: "center",
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  signOutButtonPressed: {
    backgroundColor: "#FCD34D",
  },
  signOutButtonText: {
    color: colors.danger,
    fontSize: typography.sizes.body,
    fontWeight: "700",
  },
});
