import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Link, useRouter } from "expo-router";
import type { DeliveryJob } from "@laundry/contracts";
import {
  demoSignIn,
  getClient,
  getCurrentUser,
  getToken,
  setCachedJobs,
  signOut,
} from "../src/api";
import { nextAction } from "../src/jobs";
import {
  colors,
  maxContentWidth,
  minTouchTarget,
  radius,
  spacing,
  typography,
} from "../src/theme";

export default function PartnerHome() {
  const router = useRouter();
  const [token, setTokenState] = useState<string | undefined>(getToken());
  const [user, setUserState] = useState(getCurrentUser());
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [jobs, setJobs] = useState<DeliveryJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);

  useEffect(() => {
    if (token) {
      loadJobs();
    }
  }, [token]);

  async function handleDemoSignIn() {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const session = await demoSignIn("rider");
      setTokenState(session.token);
      setUserState(session.user);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to sign in";
      setAuthError(message);
    } finally {
      setAuthLoading(false);
    }
  }

  function handleSignOut() {
    signOut();
    setTokenState(undefined);
    setUserState(undefined);
    setJobs([]);
    setJobsError(null);
  }

  async function loadJobs() {
    setJobsLoading(true);
    setJobsError(null);
    try {
      const client = getClient();
      const list = await client.listPartnerJobs();
      setJobs(list);
      setCachedJobs(list);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Could not fetch jobs";
      setJobsError(message);
    } finally {
      setJobsLoading(false);
    }
  }

  // Active uncompleted jobs
  const activeJobs = jobs.filter(
    (j) => j.status !== "COMPLETED" && j.status !== "CANCELLED"
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.centerWrapper}>
        {/* DEMO Tag */}
        <View style={styles.demoTag}>
          <Text style={styles.demoTagText}>DEMO MODE — PARTNER APP</Text>
        </View>

        {!token ? (
          <View style={styles.card}>
            <Text style={styles.title}>Delivery Partner Access</Text>
            <Text style={styles.bodyMuted}>
              Assigned pickup and return tasks for verified logistics partners. Sign in with demo rider credentials to proceed.
            </Text>

            {authError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{authError}</Text>
              </View>
            ) : null}

            <Pressable
              onPress={handleDemoSignIn}
              disabled={authLoading}
              style={({ pressed }: { pressed: boolean }) => [
                styles.primaryButton,
                pressed && styles.primaryButtonPressed,
                authLoading && styles.buttonDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="[DEMO] Sign in as Rider"
            >
              {authLoading ? (
                <ActivityIndicator color={colors.surface} />
              ) : (
                <Text style={styles.primaryButtonText}>[DEMO] Sign in as Rider</Text>
              )}
            </Pressable>
          </View>
        ) : (
          <View>
            {/* Signed-in user header bar */}
            <View style={styles.riderBar}>
              <View style={{ flex: 1 }}>
                <Text style={styles.riderName}>{user?.name ?? "Demo Rider"}</Text>
                <Text style={styles.riderRole}>Role: {user?.role ?? "rider"} • ID: {user?.id ?? "active"}</Text>
              </View>
              <Pressable
                onPress={handleSignOut}
                style={styles.signOutButton}
                accessibilityRole="button"
                accessibilityLabel="Sign out"
              >
                <Text style={styles.signOutText}>Sign Out</Text>
              </Pressable>
            </View>

            {/* Quick links to History and Account */}
            <View style={styles.navRow}>
              <Link href="/history" asChild>
                <Pressable style={styles.navPill} accessibilityRole="button">
                  <Text style={styles.navPillText}>Completed History</Text>
                </Pressable>
              </Link>
              <Link href="/account" asChild>
                <Pressable style={styles.navPill} accessibilityRole="button">
                  <Text style={styles.navPillText}>Account Settings</Text>
                </Pressable>
              </Link>
            </View>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Assigned Tasks ({activeJobs.length})</Text>
              <Pressable
                onPress={loadJobs}
                disabled={jobsLoading}
                style={styles.refreshButton}
                accessibilityRole="button"
                accessibilityLabel="Refresh tasks"
              >
                <Text style={styles.refreshText}>{jobsLoading ? "Refreshing..." : "Refresh"}</Text>
              </Pressable>
            </View>

            {/* Real Loading State */}
            {jobsLoading && jobs.length === 0 ? (
              <View style={styles.cardCenter}>
                <ActivityIndicator size="large" color={colors.action} />
                <Text style={[styles.bodyMuted, { marginTop: spacing.sm }]}>
                  Loading assigned jobs...
                </Text>
              </View>
            ) : null}

            {/* Real Error State */}
            {jobsError ? (
              <View style={styles.card}>
                <Text style={styles.errorTitle}>Unable to load tasks</Text>
                <Text style={styles.bodyMuted}>{jobsError}</Text>
                <Pressable
                  onPress={loadJobs}
                  style={styles.retryButton}
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading tasks"
                >
                  <Text style={styles.retryButtonText}>Retry</Text>
                </Pressable>
              </View>
            ) : null}

            {/* Real Empty State */}
            {!jobsLoading && !jobsError && activeJobs.length === 0 ? (
              <View style={styles.cardCenter}>
                <Text style={styles.emptyTitle}>No tasks assigned</Text>
                <Text style={[styles.bodyMuted, { textAlign: "center", marginTop: 4 }]}>
                  You have no pending delivery jobs assigned right now. Check back when dispatch assigns a new route.
                </Text>
              </View>
            ) : null}

            {/* Assigned Job Cards */}
            {activeJobs.map((job) => {
              const legBadge = job.leg === "PICKUP" ? "PICKUP" : "RETURN";
              const isProvider = job.dispatchMode === "PROVIDER";

              return (
                <View key={job.id} style={{ marginBottom: spacing.md }}>
                  <Pressable
                    onPress={() => router.push(`/jobs/${job.id}`)}
                    style={({ pressed }: { pressed: boolean }) => [
                      styles.jobCard,
                      pressed && styles.jobCardPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`View job for ${job.customerName}`}
                  >
                    <View style={styles.jobCardTop}>
                      <View style={[styles.badge, job.leg === "PICKUP" ? styles.badgeTeal : styles.badgeNavy]}>
                        <Text style={styles.badgeText}>{legBadge}</Text>
                      </View>
                      <View style={[styles.statusBadge, isProvider && styles.statusBadgeProvider]}>
                        <Text style={styles.statusBadgeText}>
                          {isProvider ? "PROVIDER" : job.status}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.customerName}>{job.customerName}</Text>
                    <Text style={styles.jobAddress} numberOfLines={2}>
                      {job.address}
                    </Text>

                    <View style={styles.metaRow}>
                      <Text style={styles.metaItem}>Bags: {job.bagIds.length}</Text>
                      <Text style={styles.metaItem}>
                        Window: {new Date(job.window.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </Text>
                    </View>

                    <View style={styles.nextActionBox}>
                      <Text style={styles.nextActionLabel}>NEXT ACTION</Text>
                      <Text style={styles.nextActionText}>{nextAction(job)}</Text>
                    </View>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
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
  title: {
    color: colors.ink,
    fontSize: typography.sizes.title,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  bodyMuted: {
    color: colors.inkMuted,
    fontSize: typography.sizes.body,
    lineHeight: 22,
  },
  riderBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  riderName: {
    color: colors.ink,
    fontSize: typography.sizes.body,
    fontWeight: "700",
  },
  riderRole: {
    color: colors.inkMuted,
    fontSize: typography.sizes.caption,
    marginTop: 2,
  },
  signOutButton: {
    minHeight: minTouchTarget,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  signOutText: {
    color: colors.danger,
    fontSize: typography.sizes.caption,
    fontWeight: "700",
  },
  navRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  navPill: {
    flex: 1,
    minHeight: minTouchTarget,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
  },
  navPillText: {
    color: colors.ink,
    fontWeight: "600",
    fontSize: typography.sizes.caption,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: typography.sizes.body,
    fontWeight: "700",
  },
  refreshButton: {
    minHeight: minTouchTarget,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  refreshText: {
    color: colors.action,
    fontWeight: "600",
    fontSize: typography.sizes.caption,
  },
  emptyTitle: {
    color: colors.ink,
    fontSize: typography.sizes.body,
    fontWeight: "700",
  },
  jobCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  jobCardPressed: {
    backgroundColor: "#F1F5F9",
  },
  jobCardTop: {
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
  statusBadge: {
    paddingVertical: 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: "#F3F4F6",
  },
  statusBadgeProvider: {
    backgroundColor: "#FEF3C7",
  },
  statusBadgeText: {
    fontSize: typography.sizes.caption,
    color: colors.inkMuted,
    fontWeight: "600",
  },
  customerName: {
    color: colors.ink,
    fontSize: typography.sizes.body,
    fontWeight: "700",
    marginTop: 2,
  },
  jobAddress: {
    color: colors.inkMuted,
    fontSize: typography.sizes.caption,
    marginTop: 2,
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  metaItem: {
    color: colors.inkMuted,
    fontSize: typography.sizes.caption,
    fontWeight: "500",
  },
  nextActionBox: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.surfaceTint,
    borderRadius: radius.sm,
  },
  nextActionLabel: {
    color: colors.action,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  nextActionText: {
    color: colors.ink,
    fontSize: typography.sizes.caption,
    fontWeight: "600",
    marginTop: 2,
  },
  primaryButton: {
    minHeight: minTouchTarget,
    backgroundColor: colors.action,
    borderRadius: radius.md,
    justifyContent: "center",
    alignItems: "center",
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  primaryButtonPressed: {
    backgroundColor: colors.actionPressed,
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: typography.sizes.body,
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  errorBox: {
    backgroundColor: "#FEE2E2",
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.sizes.caption,
  },
  errorTitle: {
    color: colors.danger,
    fontSize: typography.sizes.body,
    fontWeight: "700",
    marginBottom: spacing.xs,
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
