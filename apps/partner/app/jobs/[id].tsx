import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { DeliveryJob } from "@wandary/contracts";
import {
  getCachedJob,
  getClient,
  getCurrentUser,
  setCachedJobs,
  updateCachedJob,
} from "../../src/api";
import {
  checkJobAccess,
  getProviderManagedNotice,
  nextAction,
} from "../../src/jobs";
import { getBagVerificationMode, newActionId } from "../../src/handover";
import {
  createOfflineQueueItem,
  enqueueOfflineItem,
  type OfflineQueueItem,
} from "../../src/offline";
import {
  colors,
  maxContentWidth,
  minTouchTarget,
  radius,
  spacing,
  typography,
} from "../../src/theme";

export default function JobDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [job, setJob] = useState<DeliveryJob | undefined>(
    id ? getCachedJob(id) : undefined
  );
  const [loading, setLoading] = useState(!job);
  const [error, setError] = useState<string | null>(null);

  // Verification & Camera mode
  const [cameraPermissionGranted, setCameraPermissionGranted] = useState(false);
  const [manualCountConfirmed, setManualCountConfirmed] = useState(false);

  // OTP Form
  const [otpInput, setOtpInput] = useState("");
  const [proofRefInput, setProofRefInput] = useState("");
  const [handoverLoading, setHandoverLoading] = useState(false);
  const [handoverSuccess, setHandoverSuccess] = useState<string | null>(null);
  const [handoverError, setHandoverError] = useState<string | null>(null);

  // Exception Form
  const [exceptionReason, setExceptionReason] = useState("");
  const [exceptionLoading, setExceptionLoading] = useState(false);
  const [exceptionSuccess, setExceptionSuccess] = useState<string | null>(null);
  const [exceptionError, setExceptionError] = useState<string | null>(null);

  // Offline queue state
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueueItem[]>([]);

  const currentUser = getCurrentUser();

  useEffect(() => {
    if (id) {
      loadJob(id);
    }
  }, [id]);

  async function loadJob(jobId: string) {
    setLoading(true);
    setError(null);
    try {
      const client = getClient();
      const list = await client.listPartnerJobs();
      setCachedJobs(list);
      const found = list.find((j) => j.id === jobId);
      if (found) {
        setJob(found);
      } else {
        setError("Job not found in assigned tasks list.");
      }
    } catch (err: unknown) {
      const cached = getCachedJob(jobId);
      if (cached) {
        setJob(cached);
      } else {
        const msg = err instanceof Error ? err.message : "Failed to load job details";
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenNavigation(address: string) {
    const geoUrl = `geo:0,0?q=${encodeURIComponent(address)}`;
    const webUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    try {
      const supported = await Linking.canOpenURL(geoUrl).catch(() => false);
      if (supported) {
        await Linking.openURL(geoUrl);
      } else {
        await Linking.openURL(webUrl);
      }
    } catch {
      await Linking.openURL(webUrl).catch(() => {});
    }
  }

  async function handleHandoverSubmit() {
    if (!job) return;
    if (!otpInput.trim()) {
      setHandoverError("Please enter the customer OTP code.");
      return;
    }

    setHandoverLoading(true);
    setHandoverError(null);
    setHandoverSuccess(null);

    // Stable actionId
    const actionId = newActionId();
    const capturedAt = new Date().toISOString();

    try {
      const client = getClient();
      const updated = await client.handoverJob(job.id, {
        actionId,
        bagIds: job.bagIds,
        method: "OTP",
        otp: otpInput.trim(),
        proofReference: proofRefInput.trim() || undefined,
        expectedVersion: job.version,
        capturedAt,
      });

      setJob(updated);
      updateCachedJob(updated);
      setHandoverSuccess(`Handover confirmed! Status updated to ${updated.status}.`);
      setOtpInput("");
    } catch (err: unknown) {
      // If network failure or offline, queue with "Pending sync"
      const queuedItem = createOfflineQueueItem({
        jobId: job.id,
        expectedVersion: job.version,
        riderId: currentUser?.id ?? "rider-unknown",
        bagIds: job.bagIds,
        actionId,
        otp: otpInput.trim(),
        proofReference: proofRefInput.trim() || undefined,
        method: "OTP",
        capturedAt,
      });

      setOfflineQueue((prev) => enqueueOfflineItem(prev, queuedItem));
      const message = err instanceof Error ? err.message : "Network error";
      setHandoverError(
        `SDK request failed (${message}). Queued offline: Status is "${queuedItem.status}". Action ID: ${actionId.slice(0, 8)}...`
      );
    } finally {
      setHandoverLoading(false);
    }
  }

  async function handleReportException() {
    if (!job) return;
    if (!exceptionReason.trim()) {
      setExceptionError("Please enter a reason for the exception.");
      return;
    }

    setExceptionLoading(true);
    setExceptionError(null);
    setExceptionSuccess(null);

    try {
      const client = getClient();
      const updated = await client.reportJobException(job.id, exceptionReason.trim());
      setJob(updated);
      updateCachedJob(updated);
      setExceptionSuccess(`Exception recorded. Job status is now ${updated.status}.`);
      setExceptionReason("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to report exception";
      setExceptionError(message);
    } finally {
      setExceptionLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.action} />
        <Text style={[styles.bodyMuted, { marginTop: spacing.md }]}>
          Loading task details...
        </Text>
      </View>
    );
  }

  if (error || !job) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorTitle}>Error</Text>
        <Text style={styles.bodyMuted}>{error ?? "Job could not be found."}</Text>
        <Pressable
          onPress={() => router.replace("/")}
          style={styles.primaryButton}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>Return to Task List</Text>
        </Pressable>
      </View>
    );
  }

  // 1. Accessibility Check: unassigned jobs show 'Not assigned to you'
  const access = checkJobAccess(job, currentUser?.id);
  if (!access.accessible) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
        <View style={styles.centerWrapper}>
          <View style={styles.warningCard}>
            <Text style={styles.warningTitle}>{access.reason ?? "Not assigned to you"}</Text>
            <Text style={styles.bodyMuted}>
              This delivery task is not assigned to your account. Partner access is restricted to verified assignees.
            </Text>
            <Pressable
              onPress={() => router.replace("/")}
              style={[styles.primaryButton, { marginTop: spacing.md }]}
              accessibilityRole="button"
            >
              <Text style={styles.primaryButtonText}>Back to Assigned Tasks</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    );
  }

  // 2. Provider-managed check without OTP_HANDOVER capability
  const providerNotice = getProviderManagedNotice(job);
  const isReadOnlyProvider = Boolean(providerNotice);

  // Verification mode
  const verificationMode = getBagVerificationMode(cameraPermissionGranted);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.centerWrapper}>
        {/* Top Badges */}
        <View style={styles.headerRow}>
          <View
            style={[
              styles.badge,
              job.leg === "PICKUP" ? styles.badgeTeal : styles.badgeNavy,
            ]}
          >
            <Text style={styles.badgeText}>{job.leg} TASK</Text>
          </View>
          <View style={styles.statusBadge}>
            <Text style={styles.statusBadgeText}>Status: {job.status}</Text>
          </View>
        </View>

        {/* Read-Only Notice for Provider-Managed Tasks */}
        {isReadOnlyProvider ? (
          <View style={styles.providerCard}>
            <Text style={styles.providerTitle}>Provider-Managed Delivery</Text>
            <Text style={styles.providerText}>{providerNotice}</Text>
          </View>
        ) : null}

        {/* Next Action Banner */}
        <View style={styles.nextActionCard}>
          <Text style={styles.nextActionHeading}>NEXT ACTION</Text>
          <Text style={styles.nextActionValue}>{nextAction(job)}</Text>
        </View>

        {/* Location & Navigation */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Customer & Destination</Text>
          <Text style={styles.customerName}>{job.customerName}</Text>
          <Text style={styles.addressText}>{job.address}</Text>

          <Text style={[styles.metaText, { marginTop: spacing.sm }]}>
            Window: {new Date(job.window.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} –{" "}
            {new Date(job.window.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </Text>

          <Pressable
            onPress={() => handleOpenNavigation(job.address)}
            style={({ pressed }: { pressed: boolean }) => [
              styles.navButton,
              pressed && styles.navButtonPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Open navigation in Google Maps"
          >
            <Text style={styles.navButtonText}>📍 Open Navigation (Maps)</Text>
          </Pressable>
        </View>

        {/* Bag Count & Custody Verification */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Bag Custody & Verification</Text>
          <Text style={styles.bodyMuted}>
            Total bags: <Text style={styles.boldText}>{job.bagIds.length}</Text>
          </Text>
          <Text style={[styles.metaText, { marginTop: 4 }]}>
            Bag IDs: {job.bagIds.join(", ")}
          </Text>

          {/* Camera Permission / Manual Count Alternative */}
          <View style={styles.verificationModeBox}>
            <Text style={styles.verificationModeLabel}>
              {verificationMode.label}
            </Text>

            {verificationMode.isAlternative ? (
              <Pressable
                onPress={() => setManualCountConfirmed(!manualCountConfirmed)}
                style={[
                  styles.toggleButton,
                  manualCountConfirmed && styles.toggleButtonActive,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Confirm manual count"
              >
                <Text
                  style={[
                    styles.toggleButtonText,
                    manualCountConfirmed && styles.toggleButtonTextActive,
                  ]}
                >
                  {manualCountConfirmed
                    ? `✓ Manual count verified (${job.bagIds.length} bags)`
                    : `Confirm manual count (${job.bagIds.length} bags)`}
                </Text>
              </Pressable>
            ) : null}

            {/* Toggle to simulate camera permission denial/allow */}
            <Pressable
              onPress={() => setCameraPermissionGranted(!cameraPermissionGranted)}
              style={styles.simCamButton}
              accessibilityRole="button"
            >
              <Text style={styles.simCamText}>
                [DEMO] Toggle Camera Permission ({cameraPermissionGranted ? "Allowed" : "Denied"})
              </Text>
            </Pressable>
          </View>
        </View>

        {/* OTP Handover Form (Only when not read-only provider) */}
        {!isReadOnlyProvider && job.status !== "COMPLETED" && job.status !== "CANCELLED" ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>OTP Handover</Text>
            <Text style={styles.bodyMuted}>
              Ask the customer for their secret OTP code to verify bag handover.
            </Text>
            <Text style={styles.securityNote}>
              Note: Customer handover codes are never displayed to delivery partners.
            </Text>

            {handoverSuccess ? (
              <View style={styles.successBox}>
                <Text style={styles.successText}>{handoverSuccess}</Text>
              </View>
            ) : null}

            {handoverError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{handoverError}</Text>
              </View>
            ) : null}

            <Text style={styles.inputLabel}>Customer Handover OTP</Text>
            <TextInput
              value={otpInput}
              onChangeText={setOtpInput}
              placeholder="Enter customer OTP (e.g. 1234)"
              placeholderTextColor={colors.inkMuted}
              keyboardType="number-pad"
              style={styles.textInput}
            />

            <Text style={styles.inputLabel}>
              [DEMO] Simulated Proof Reference (Optional)
            </Text>
            <TextInput
              value={proofRefInput}
              onChangeText={setProofRefInput}
              placeholder="e.g. proof-sim-abc"
              placeholderTextColor={colors.inkMuted}
              style={styles.textInput}
            />

            <Pressable
              onPress={handleHandoverSubmit}
              disabled={handoverLoading}
              style={({ pressed }: { pressed: boolean }) => [
                styles.primaryButton,
                pressed && styles.primaryButtonPressed,
                handoverLoading && styles.buttonDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Verify and Complete Handover"
            >
              {handoverLoading ? (
                <ActivityIndicator color={colors.surface} />
              ) : (
                <Text style={styles.primaryButtonText}>
                  Verify & Complete Handover
                </Text>
              )}
            </Pressable>
          </View>
        ) : null}

        {/* Exception Reporting Form */}
        {!isReadOnlyProvider && job.status !== "COMPLETED" && job.status !== "CANCELLED" ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Report Exception</Text>
            <Text style={styles.bodyMuted}>
              Report delivery roadblocks (e.g., customer unreachable, damaged bag, gate access denied).
            </Text>

            {exceptionSuccess ? (
              <View style={styles.successBox}>
                <Text style={styles.successText}>{exceptionSuccess}</Text>
              </View>
            ) : null}

            {exceptionError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{exceptionError}</Text>
              </View>
            ) : null}

            <Text style={styles.inputLabel}>Exception Reason</Text>
            <TextInput
              value={exceptionReason}
              onChangeText={setExceptionReason}
              placeholder="Describe the issue..."
              placeholderTextColor={colors.inkMuted}
              style={[styles.textInput, { height: 80 }]}
              multiline
            />

            <Pressable
              onPress={handleReportException}
              disabled={exceptionLoading}
              style={({ pressed }: { pressed: boolean }) => [
                styles.secondaryButton,
                pressed && styles.secondaryButtonPressed,
                exceptionLoading && styles.buttonDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Submit Exception"
            >
              {exceptionLoading ? (
                <ActivityIndicator color={colors.ink} />
              ) : (
                <Text style={styles.secondaryButtonText}>Submit Exception</Text>
              )}
            </Pressable>
          </View>
        ) : null}

        {/* Support Note */}
        <View style={styles.supportCard}>
          <Text style={styles.supportTitle}>Dispatch Support Note</Text>
          <Text style={styles.supportText}>
            For route escalations or gate entry verification, contact Partner Operations at +91-800-WANDARY.
          </Text>
          <Text style={styles.supportMeta}>
            Order ID: {job.orderId} • Task ID: {job.id}
          </Text>
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
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
    backgroundColor: colors.surfaceTint,
  },
  centerWrapper: {
    width: "100%",
    maxWidth: maxContentWidth,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  badge: {
    paddingVertical: spacing.xs,
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
    color: colors.ink,
    fontSize: typography.sizes.caption,
    fontWeight: "700",
  },
  statusBadge: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusBadgeText: {
    color: colors.inkMuted,
    fontSize: typography.sizes.caption,
    fontWeight: "600",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  cardTitle: {
    color: colors.ink,
    fontSize: typography.sizes.body,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  warningCard: {
    backgroundColor: "#FEF2F2",
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: "#FCA5A5",
    alignItems: "center",
  },
  warningTitle: {
    color: colors.danger,
    fontSize: typography.sizes.title,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  providerCard: {
    backgroundColor: "#FEF3C7",
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "#FDE68A",
    marginBottom: spacing.md,
  },
  providerTitle: {
    color: colors.warning,
    fontSize: typography.sizes.body,
    fontWeight: "700",
    marginBottom: 2,
  },
  providerText: {
    color: colors.ink,
    fontSize: typography.sizes.caption,
    lineHeight: 18,
  },
  nextActionCard: {
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  nextActionHeading: {
    color: "#93C5FD",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  nextActionValue: {
    color: colors.surface,
    fontSize: typography.sizes.body,
    fontWeight: "700",
    marginTop: 2,
  },
  customerName: {
    color: colors.ink,
    fontSize: typography.sizes.title,
    fontWeight: "700",
  },
  addressText: {
    color: colors.inkMuted,
    fontSize: typography.sizes.body,
    marginTop: 2,
    lineHeight: 22,
  },
  metaText: {
    color: colors.inkMuted,
    fontSize: typography.sizes.caption,
  },
  boldText: {
    fontWeight: "700",
    color: colors.ink,
  },
  navButton: {
    minHeight: minTouchTarget,
    backgroundColor: colors.surfaceTint,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.action,
    justifyContent: "center",
    alignItems: "center",
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  navButtonPressed: {
    backgroundColor: "#E0E7FF",
  },
  navButtonText: {
    color: colors.action,
    fontSize: typography.sizes.body,
    fontWeight: "700",
  },
  verificationModeBox: {
    marginTop: spacing.md,
    padding: spacing.sm,
    backgroundColor: colors.surfaceTint,
    borderRadius: radius.sm,
  },
  verificationModeLabel: {
    color: colors.ink,
    fontSize: typography.sizes.caption,
    fontWeight: "600",
  },
  toggleButton: {
    minHeight: minTouchTarget,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    justifyContent: "center",
    alignItems: "center",
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  toggleButtonActive: {
    backgroundColor: "#DCFCE7",
    borderColor: colors.success,
  },
  toggleButtonText: {
    color: colors.ink,
    fontSize: typography.sizes.caption,
    fontWeight: "600",
  },
  toggleButtonTextActive: {
    color: colors.success,
    fontWeight: "700",
  },
  simCamButton: {
    minHeight: minTouchTarget,
    justifyContent: "center",
    alignItems: "center",
    marginTop: spacing.xs,
  },
  simCamText: {
    color: colors.inkMuted,
    fontSize: typography.sizes.caption,
    textDecorationLine: "underline",
  },
  securityNote: {
    color: colors.warning,
    fontSize: typography.sizes.caption,
    marginTop: 2,
    marginBottom: spacing.xs,
  },
  inputLabel: {
    color: colors.ink,
    fontSize: typography.sizes.caption,
    fontWeight: "600",
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  textInput: {
    minHeight: minTouchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    color: colors.ink,
    fontSize: typography.sizes.body,
  },
  primaryButton: {
    minHeight: minTouchTarget,
    backgroundColor: colors.action,
    borderRadius: radius.sm,
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
  secondaryButton: {
    minHeight: minTouchTarget,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    justifyContent: "center",
    alignItems: "center",
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  secondaryButtonPressed: {
    backgroundColor: "#F1F5F9",
  },
  secondaryButtonText: {
    color: colors.ink,
    fontSize: typography.sizes.body,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  successBox: {
    backgroundColor: "#DCFCE7",
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  successText: {
    color: colors.success,
    fontSize: typography.sizes.caption,
    fontWeight: "600",
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
    fontSize: typography.sizes.title,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  bodyMuted: {
    color: colors.inkMuted,
    fontSize: typography.sizes.body,
    lineHeight: 22,
  },
  supportCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xl,
  },
  supportTitle: {
    color: colors.ink,
    fontSize: typography.sizes.body,
    fontWeight: "700",
    marginBottom: 2,
  },
  supportText: {
    color: colors.inkMuted,
    fontSize: typography.sizes.caption,
    lineHeight: 18,
  },
  supportMeta: {
    color: colors.inkMuted,
    fontSize: 10,
    marginTop: spacing.xs,
  },
});
