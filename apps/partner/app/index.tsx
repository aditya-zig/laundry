import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Link, useRouter, useFocusEffect } from "expo-router";
import { v2 } from "@laundry/contracts";
import { UnknownOutcomeError, V2ApiError } from "@laundry/api-client";
import { getFoundation } from "../src/foundation/session";
import {
  activeJobs,
  listRenderRow,
  nextActionLabel,
  type PrivateJobsState,
  purgePrivateJobsState,
} from "../src/features/jobs/access";

import { createPartnerApi, pendingHandoverReceipts } from "../src/features/session/partner-api";
import { usePartnerSession } from "../src/features/session/use-partner-session";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Input,
  LoadingState,
  NoticeBox,
  PrimaryButton,
  SectionTitle,
  windowLabel,
} from "../src/features/ui";
import {
  colors,
  maxContentWidth,
  minTouchTarget,
  radius,
  spacing,
  typography,
} from "../src/theme";

type Challenge = { challengeId: string; expiresAt: string };
type SignInMode = "IDLE" | "AWAITING_CODE";

function useRiderApi() {
  return createPartnerApi({ foundation: getFoundation() });
}

function HomeSignedOut({ onSignedIn }: { onSignedIn: () => void }) {
  const [phone, setPhone] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const api = useRiderApi();

  async function requestChallenge() {
    setBusy(true);
    setError(null);
    try {
      const parsed = v2.otpRequestSchema.safeParse({ phone: phone.trim() });
      if (!parsed.success) {
        setError("Enter your phone in international format, e.g. +919876543210.");
        return;
      }
      const result = await api.requestChallenge(parsed.data.phone);
      setChallenge({ challengeId: result.challengeId, expiresAt: result.expiresAt });
    } catch (err) {
      setError(describeAuthError(err, "Could not request a sign-in code."));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const snapshot = await api.verifyAndAdoptSession({
        challengeId: challenge.challengeId,
        code: code.trim(),
        mfaCode: mfaCode.trim() === "" ? undefined : mfaCode.trim(),
      });
      if (snapshot.state === "authenticated") onSignedIn();
    } catch (err) {
      setError(describeAuthError(err, "Sign-in failed. The code may be wrong or expired."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Text style={styles.title}>Delivery partner sign-in</Text>
      <Text style={styles.bodyMuted}>
        Sign in with your registered phone number and the one-time code sent to it. This app has no demo
        accounts.
      </Text>
      <Field label="Phone number">
        <Input
          value={phone}
          onChangeText={setPhone}
          placeholder="+919876543210"
          accessibilityLabel="Phone number"
          maxLength={18}
        />
      </Field>
      {challenge ? (
        <>
          <Field label="One-time code">
            <Input
              value={code}
              onChangeText={setCode}
              placeholder="Six-digit code"
              accessibilityLabel="One-time code"
              numeric
              maxLength={6}
              autoFocus
            />
          </Field>
          <Field label="Staff MFA code (optional)">
            <Input
              value={mfaCode}
              onChangeText={setMfaCode}
              placeholder="Only for provisioned staff"
              accessibilityLabel="Staff MFA code"
              numeric
              maxLength={6}
            />
          </Field>
          <Text style={styles.hint}>
            Code sent. Challenge expires {new Date(challenge.expiresAt).toLocaleTimeString()}
            . Re-request a code if it expired — the phone number is never prefilled.
          </Text>
          <PrimaryButton
            label="Verify and sign in"
            onPress={verify}
            busy={busy}
            disabled={code.trim().length !== 6}
          />
          <PrimaryButton label="Request a new code" onPress={requestChallenge} busy={busy} tone="quiet" />
        </>
      ) : (
        <PrimaryButton label="Request sign-in code" onPress={requestChallenge} busy={busy} />
      )}
      {error ? <NoticeBox title="Sign-in problem" body={error} tone="danger" /> : null}
    </Card>
  );
}

function describeAuthError(err: unknown, fallback: string): string {
  if (err instanceof V2ApiError) {
    if (err.code === "RATE_LIMITED") return "Too many sign-in attempts. Wait before requesting another code.";
    if (err.code === "INVALID_INPUT") return err.message;
    if (err.code === "UNAUTHENTICATED") return "Sign-in code was rejected or expired.";
    return err.message;
  }
  if (err instanceof UnknownOutcomeError) {
    return "The sign-in outcome is unknown. Retry with the same details before changing anything else.";
  }
  return err instanceof Error ? err.message : fallback;
}

function JobRow(props: { subject: v2.RiderJob | { id: string; leg: string; status: string; customerVisible: false }; customerVisible: boolean; isMine: boolean; pending: boolean }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/jobs/${props.subject.id}`)}
      style={({ pressed }) => [styles.jobRow, pressed && styles.jobRowPressed]}
      accessibilityRole="button"
      accessibilityLabel={
        props.customerVisible
          ? `Open task ${(props.subject as v2.RiderJob).customerName}`
          : `Open assigned task`
      }
      testID={`rider-job-${props.subject.id}`}
    >
      <View style={styles.jobRowTop}>
        <Badge label={(props.subject as v2.RiderJob).leg} tone={(props.subject as v2.RiderJob).leg === "PICKUP" ? "action" : "neutral"} />
        <Badge
          label={(props.subject as v2.RiderJob).status}
          tone={(props.subject as v2.RiderJob).status === "FAILED" ? "danger" : "neutral"}
        />
        {props.pending ? <Badge label="Pending sync — not confirmed" tone="warning" /> : null}
      </View>
      {props.customerVisible ? (
        <>
          <Text style={styles.jobTitle}>{(props.subject as v2.RiderJob).customerName}</Text>
          <Text style={styles.jobMeta}>
            {(props.subject as v2.RiderJob).addressLine1}, {(props.subject as v2.RiderJob).addressCity}
          </Text>
        </>
      ) : (
        <View style={styles.jobTitle}>
          <Text style={styles.bodyMuted}>
            {props.isMine ? "Assigned to you — full details unavailable from cache" : "Not assigned to you. Customer details are not shown."}
          </Text>
        </View>
      )}
      <View style={styles.jobRowBottom}>
        <Text style={styles.jobWindow}>
          {windowLabel((props.subject as v2.RiderJob | v2.RiderJob).window?.start ?? "", (props.subject as v2.RiderJob).window?.end ?? "")}
        </Text>
        <Text style={styles.nextAction}>{props.customerVisible ? nextActionLabel(props.subject as v2.RiderJob) : nextActionOfSubject(props.subject as v2.RiderJob)}</Text>
      </View>
    </Pressable>
  );
}

function nextActionOfSubject(_job: v2.RiderJob): string {
  return "Open the task to confirm what you can act on";
}

function TaskList() {
  const session = usePartnerSession();
  const api = useRiderApi();
  const actorId = session.state === "AUTHENTICATED" ? session.actor.id : null;
  const [stateObj, setStateObj] = useState<PrivateJobsState>(() => purgePrivateJobsState());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<string[]>([]);

  useEffect(() => {
    if (session.state !== "AUTHENTICATED") {
      setStateObj(purgePrivateJobsState());
      setPending([]);
      setLoadError(null);
    }
  }, [session.state]);

  async function load() {
    if (!actorId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const jobs = await api.listAssignedJobs();
      if (api.actor()?.id !== actorId) return;
      setStateObj(s => ({ ...s, jobs }));
      const receipts = pendingHandoverReceipts(await api.queuedMutations());
      if (api.actor()?.id !== actorId) return;
      setPending(receipts.map(r => r.jobId));
    } catch (err) {
      if (api.actor()?.id !== actorId) return;
      setLoadError(err instanceof Error ? err.message : "Could not load assigned tasks.");
    } finally {
      if (api.actor()?.id === actorId) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [actorId]);

  useFocusEffect(
    React.useCallback(() => {
      if (actorId) void load();
    }, [actorId]),
  );

  const mine = activeJobs(stateObj.jobs, actorId);
  const signedOut = session.state !== "AUTHENTICATED";

  return (
    <View>
      <View style={styles.navRow}>
        <Link href="/history" asChild>
          <Pressable style={styles.navPill} accessibilityRole="button">
            <Text style={styles.navPillText}>Completed history</Text>
          </Pressable>
        </Link>
        <Link href="/account" asChild>
          <Pressable style={styles.navPill} accessibilityRole="button">
            <Text style={styles.navPillText}>Account</Text>
          </Pressable>
        </Link>
      </View>
      <SectionTitle
        right={
          <Pressable onPress={load} disabled={loading || signedOut} accessibilityRole="button" accessibilityLabel="Refresh tasks">
            <Text style={[styles.navPillText, styles.refresh, (loading || signedOut) && styles.refreshDisabled]}>
              {loading ? "Refreshing…" : "Refresh"}
            </Text>
          </Pressable>
        }
      >
        {`Assigned tasks (${mine.length})`}
      </SectionTitle>
      {session.state === "RESTORE_FAILED" ? (
        <NoticeBox
          title="Previous sign-in could not be restored"
          body={`${session.message} Sign in again to continue; no task data is shown.`}
          tone="warning"
        />
      ) : null}
      {signedOut ? null : loading && mine.length === 0 ? <LoadingState label="Loading assigned tasks…" /> : null}
      {loadError ? (
        <Card tone="danger">
          <Text style={styles.errorTitle}>Assigned tasks could not be loaded</Text>
          <Text style={styles.bodyMuted}>{loadError}</Text>
        </Card>
      ) : null}
      {!signedOut && !loading && !loadError && mine.length === 0 ? (
        <EmptyState
          title="No tasks assigned"
          body="Dispatch has not assigned you a delivery task yet. Refresh after dispatch assigns a route."
        />
      ) : null}
      {mine.map(job => (
        <JobRow
          key={job.id}
          subject={job}
          customerVisible={true}
          isMine={true}
          pending={pending.includes(job.id)}
        />
      ))}
      {renderRestrictedRows(stateObj.jobs, actorId, pending)}
    </View>
  );
}

function renderRestrictedRows(jobs: v2.RiderJob[], actorId: string | null, pending: string[]) {
  const rows = jobs
    .map(job => listRenderRow(job, actorId))
    .filter(row => row.visibility !== "MINE");
  if (rows.length === 0) return null;
  return (
    <View>
      <Text style={styles.restrictedHeading}>Restricted tasks (no customer data shown)</Text>
      {rows.map(row => (
        <JobRow
          key={row.subject.id}
          subject={{ id: row.subject.id, leg: row.subject.leg, status: row.subject.status, customerVisible: false }}
          customerVisible={false}
          isMine={false}
          pending={pending.includes(row.subject.id)}
        />
      ))}
    </View>
  );
}

export default function PartnerHome() {
  const session = usePartnerSession();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.centerWrapper}>
        <View style={styles.tagRow}>
          <Badge label="SDK v2 wire" tone="neutral" />
          <Badge
            label={
              session.state === "AUTHENTICATED"
                ? `Signed in as ${session.actor.role}`
                : "Not signed in"
            }
            tone={session.state === "AUTHENTICATED" ? "success" : "neutral"}
          />
        </View>
        {session.state === "CONFIG_ERROR" ? (
          <NoticeBox
            title="App configuration required"
            body={session.message}
            tone="danger"
          />
        ) : null}
        {session.state === "LOADING" ? <LoadingState label="Checking existing sign-in…" /> : null}
        {session.state === "AUTHENTICATED" ? <TaskList key={session.identityEpoch} /> : null}
        {session.state === "SIGNED_OUT" || session.state === "RESTORE_FAILED" ? (
          <HomeSignedOut onSignedIn={session.refresh ?? (() => undefined)} />
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceTint },
  container: { padding: spacing.md, alignItems: "center" },
  centerWrapper: { width: "100%", maxWidth: maxContentWidth },
  tagRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md, flexWrap: "wrap" },
  title: { color: colors.ink, fontSize: typography.sizes.title, fontWeight: "700", marginBottom: spacing.xs },
  bodyMuted: { color: colors.inkMuted, fontSize: typography.sizes.body, lineHeight: 22 },
  hint: { color: colors.inkMuted, fontSize: typography.sizes.caption, marginTop: spacing.sm },
  navRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
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
  navPillText: { color: colors.action, fontWeight: "600", fontSize: typography.sizes.caption },
  refresh: { color: colors.action, fontWeight: "600" },
  refreshDisabled: { color: colors.inkMuted },
  errorTitle: { color: colors.danger, fontWeight: "700", marginBottom: spacing.xs },
  jobRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    minHeight: minTouchTarget,
  },
  jobRowPressed: { backgroundColor: "#F1F5F9" },
  jobRowTop: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.xs, flexWrap: "wrap" },
  jobTitle: { color: colors.ink, fontWeight: "700", marginTop: spacing.xs },
  jobMeta: { color: colors.inkMuted, marginTop: 2 },
  jobRowBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.sm },
  jobWindow: { color: colors.inkMuted, fontSize: typography.sizes.caption },
  nextAction: { color: colors.action, fontWeight: "600", fontSize: typography.sizes.caption, flexShrink: 1, textAlign: "right" },
  restrictedHeading: {
    color: colors.inkMuted,
    fontSize: typography.sizes.caption,
    fontWeight: "700",
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
});
