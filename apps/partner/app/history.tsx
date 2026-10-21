import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import type { DeliveryJob } from "@laundry/contracts";
import { getClient, setCachedJobs } from "../src/api";
import {
  colors,
  maxContentWidth,
  minTouchTarget,
  radius,
  spacing,
  typography,
} from "../src/theme";

export default function HistoryScreen() {
  const router = useRouter();
  const [completedJobs, setCompletedJobs] = useState<DeliveryJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCompletedJobs();
  }, []);

  async function loadCompletedJobs() {
    setLoading(true);
    setError(null);
    try {
      const client = getClient();
      const list = await client.listPartnerJobs();
      setCachedJobs(list);
      setCompletedJobs(list.filter((j) => j.status === "COMPLETED"));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load history";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.centerWrapper}>
        <View style={styles.header}>
          <Text style={styles.title}>Completed Tasks History</Text>
          <Text style={styles.bodyMuted}>
            Archive of successfully fulfilled laundry pickup and return deliveries.
          </Text>
        </View>

        {loading ? (
          <View style={styles.cardCenter}>
            <ActivityIndicator size="large" color={colors.action} />
            <Text style={[styles.bodyMuted, { marginTop: spacing.sm }]}>
              Loading history...
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.card}>
            <Text style={styles.errorTitle}>Unable to load task history</Text>
            <Text style={styles.bodyMuted}>{error}</Text>
            <Pressable
              onPress={loadCompletedJobs}
              style={styles.retryButton}
              accessibilityRole="button"
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !error && completedJobs.length === 0 ? (
          <View style={styles.cardCenter}>
            <Text style={styles.emptyTitle}>No completed tasks yet</Text>
            <Text style={[styles.bodyMuted, { textAlign: "center", marginTop: 4 }]}>
              Tasks completed with customer OTP verification will appear here.
            </Text>
            <Pressable
              onPress={() => router.replace("/")}
              style={[styles.primaryButton, { marginTop: spacing.md }]}
              accessibilityRole="button"
            >
              <Text style={styles.primaryButtonText}>View Active Tasks</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !error && completedJobs.map((job) => (
          <View key={job.id} style={{ marginBottom: spacing.sm }}>
            <Pressable
              onPress={() => router.push(`/jobs/${job.id}`)}
              style={({ pressed }: { pressed: boolean }) => [
                styles.jobCard,
                pressed && styles.jobCardPressed,
              ]}
              accessibilityRole="button"
            >
              <View style={styles.cardTop}>
                <View
                  style={[
                    styles.badge,
                    job.leg === "PICKUP" ? styles.badgeTeal : styles.badgeNavy,
                  ]}
                >
                  <Text style={styles.badgeText}>{job.leg}</Text>
                </View>
                <View style={styles.completedPill}>
                  <Text style={styles.completedPillText}>✓ COMPLETED</Text>
                </View>
              </View>

              <Text style={styles.customerName}>{job.customerName}</Text>
              <Text style={styles.addressText} numberOfLines={2}>
                {job.address}
              </Text>

              <View style={styles.metaRow}>
                <Text style={styles.metaText}>Bags delivered: {job.bagIds.length}</Text>
                <Text style={styles.metaText}>Order: {job.orderId.slice(0, 8)}...</Text>
              </View>
            </Pressable>
          </View>
        ))}
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
  header: {
    marginBottom: spacing.md,
  },
  title: {
    color: colors.ink,
    fontSize: typography.sizes.title,
    fontWeight: "700",
    marginBottom: 2,
  },
  bodyMuted: {
    color: colors.inkMuted,
    fontSize: typography.sizes.body,
    lineHeight: 22,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  cardCenter: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  emptyTitle: {
    color: colors.ink,
    fontSize: typography.sizes.body,
    fontWeight: "700",
  },
  errorTitle: {
    color: colors.danger,
    fontSize: typography.sizes.body,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  jobCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  jobCardPressed: {
    backgroundColor: "#F1F5F9",
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  badge: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  badgeTeal: {
    backgroundColor: "#CCFBF1",
  },
  badgeNavy: {
    backgroundColor: "#DBEAFE",
  },
  badgeText: {
    fontSize: typography.sizes.caption,
    fontWeight: "700",
    color: colors.ink,
  },
  completedPill: {
    backgroundColor: "#DCFCE7",
    paddingVertical: 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
  },
  completedPillText: {
    fontSize: typography.sizes.caption,
    color: colors.success,
    fontWeight: "700",
  },
  customerName: {
    color: colors.ink,
    fontSize: typography.sizes.body,
    fontWeight: "700",
    marginTop: 2,
  },
  addressText: {
    color: colors.inkMuted,
    fontSize: typography.sizes.caption,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  metaText: {
    color: colors.inkMuted,
    fontSize: typography.sizes.caption,
  },
  primaryButton: {
    minHeight: minTouchTarget,
    backgroundColor: colors.action,
    borderRadius: radius.sm,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.md,
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: typography.sizes.body,
    fontWeight: "700",
  },
  retryButton: {
    minHeight: minTouchTarget,
    backgroundColor: colors.action,
    borderRadius: radius.sm,
    justifyContent: "center",
    alignItems: "center",
    marginTop: spacing.sm,
  },
  retryButtonText: {
    color: colors.surface,
    fontSize: typography.sizes.body,
    fontWeight: "600",
  },
});
