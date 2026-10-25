import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { v2 } from "@laundry/contracts";
import { getFoundation } from "../src/foundation/session";
import {
  historyJobs,
  nextActionLabel,
  purgePrivateJobsState,
  type PrivateJobsState,
} from "../src/features/jobs/access";
import { createPartnerApi } from "../src/features/session/partner-api";
import { usePartnerSession } from "../src/features/session/use-partner-session";
import {
  Badge,
  Card,
  EmptyState,
  LoadingState,
  NoticeBox,
  windowLabel,
} from "../src/features/ui";
import {
  colors,
  maxContentWidth,
  spacing,
} from "../src/theme";

function HistoryList() {
  const session = usePartnerSession();
  const api = createPartnerApi({ foundation: getFoundation() });
  const actorId = session.state === "AUTHENTICATED" ? session.actor.id : null;
  const [stateObj, setStateObj] = useState<PrivateJobsState>(() => purgePrivateJobsState());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.state !== "AUTHENTICATED") {
      setStateObj(purgePrivateJobsState());
      setError(null);
    }
  }, [session.state]);

  async function load() {
    const atLoad = api.actor()?.id ?? null;
    if (!atLoad) return;
    setLoading(true);
    setError(null);
    try {
      const jobs = await api.listAssignedJobs();
      if (api.actor()?.id !== atLoad) return;
      setStateObj(s => ({ ...s, jobs }));
    } catch (err) {
      if (api.actor()?.id !== atLoad) return;
      setError(err instanceof Error ? err.message : "Could not load completed tasks.");
    } finally {
      if (api.actor()?.id === atLoad) setLoading(false);
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

  const closed = historyJobs(stateObj.jobs, actorId);

  return (
    <View>
      {session.state === "RESTORE_FAILED" ? (
        <NoticeBox title="History locked" body={`${session.message} Sign in again to view your completed tasks.`} tone="warning" />
      ) : null}
      {loading && closed.length === 0 ? <LoadingState label="Loading completed tasks…" /> : null}
      {error ? (
        <Card tone="danger">
          <Text style={styles.bodyMuted}>{error}</Text>
        </Card>
      ) : null}
      {!loading && !error && closed.length === 0 ? (
        <EmptyState
          title="No completed tasks yet"
          body="Tasks move here after they complete, fail or are cancelled. Only tasks assigned to you appear."
        />
      ) : null}
      {closed.map(job => (
        <Card key={job.id}>
          <View style={styles.row}>
            <Badge label={job.leg} tone={job.leg === "PICKUP" ? "action" : "neutral"} />
            <Badge
              label={job.status}
              tone={job.status === "COMPLETED" ? "success" : job.status === "FAILED" ? "danger" : "warning"}
            />
            <Badge label={`v${job.version}`} />
          </View>
          <Text style={styles.jobTitle}>{job.customerName}</Text>
          <Text style={styles.bodyMuted}>
            {job.addressLine1}, {job.addressCity}
          </Text>
          <Text style={styles.window}>
            {windowLabel(job.window.start, job.window.end)} ({job.window.timezone})
          </Text>
          <Text style={styles.window}>
            Order {job.orderId.slice(0, 8)} • next: {nextActionLabel(job)}
          </Text>
        </Card>
      ))}
    </View>
  );
}

export default function HistoryScreen() {
  const session = usePartnerSession();
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
    >
      <View style={styles.centerWrapper}>
        <Text style={styles.heading}>Completed tasks</Text>
        {session.state === "AUTHENTICATED" ? (
          <HistoryList key={session.identityEpoch} />
        ) : session.state === "LOADING" ? (
          <LoadingState label="Checking sign-in…" />
        ) : session.state === "CONFIG_ERROR" ? (
          <NoticeBox title="App configuration required" body={session.message} tone="danger" />
        ) : (
          <EmptyState
            title="Sign in required"
            body="Completed tasks are private to each rider. Sign in from the task list to view yours."
          />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceTint },
  container: { padding: spacing.md, alignItems: "center" },
  centerWrapper: { width: "100%", maxWidth: maxContentWidth },
  heading: { color: colors.ink, fontWeight: "700", fontSize: 18, marginBottom: spacing.sm },
  bodyMuted: { color: colors.inkMuted, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", marginBottom: spacing.xs },
  jobTitle: { color: colors.ink, fontWeight: "700" },
  window: { color: colors.inkMuted, fontSize: 12, marginTop: 2 },
});
