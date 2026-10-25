import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { logoutNotice } from "@laundry/app-foundation";
import { getFoundation } from "../src/foundation/session";
import { createPartnerApi, pendingHandoverReceipts, type PendingHandoverReceipt } from "../src/features/session/partner-api";
import { usePartnerSession } from "../src/features/session/use-partner-session";
import {
  Badge,
  Card,
  EmptyState,
  LoadingState,
  NoticeBox,
  PrimaryButton,
} from "../src/features/ui";
import {
  colors,
  maxContentWidth,
  spacing,
} from "../src/theme";

function AccountPanel({ onSignOut }: { onSignOut: (notice: string) => void }) {
  const session = usePartnerSession();
  const api = createPartnerApi({ foundation: getFoundation() });
  const actor = session.state === "AUTHENTICATED" ? session.actor : null;
  const [pending, setPending] = useState<PendingHandoverReceipt[]>([]);
  const [flushResult, setFlushResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadQueue() {
    try {
      const receipts = pendingHandoverReceipts(await api.queuedMutations());
      if (api.actor()?.id !== (actor?.id ?? null)) return;
      setPending(receipts);
    } catch {
      setPending([]);
      setFlushResult("The pending queue could not be read right now.");
    }
  }

  useEffect(() => {
    if (actor) void loadQueue();
  }, [actor?.id]);

  async function flush() {
    setBusy(true);
    try {
      const report = await api.flushQueue();
      const parts = [
        `confirmed: ${report.confirmed.length}`,
        `discarded stale: ${report.discardedStale.length}`,
        `still pending: ${report.pending.length}`,
      ];
      const pendingReasons = report.pending
        .slice(0, 3)
        .map(entry => {
          const cause = entry.cause instanceof Error ? entry.cause.message : String(entry.cause);
          return `${entry.record.routeId}: ${cause}`;
        });
      setFlushResult([
        `Queue flush finished (${parts.join(", ")}).`,
        ...pendingReasons,
      ].join("\n"));
      await loadQueue();
    } catch (err) {
      setFlushResult(
        err instanceof Error
          ? `Flush did not finish: ${err.message}`
          : "Flush did not finish.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      const report = await api.signOut();
      onSignOut(logoutNotice(report));
    } catch {
      onSignOut("Sign-out failed. Server revocation and local credential erasure were not confirmed.");
    } finally {
      setBusy(false);
    }
  }

  if (!actor) {
    return (
      <EmptyState
        title="Sign in required"
        body="Account details and the pending custody queue are private. Sign in from the task list."
      />
    );
  }

  return (
    <View>
      <Card>
        <Text style={styles.heading}>Account</Text>
        <View style={styles.row}>
          <Badge label={actor.role} tone="action" />
          <Badge label={`facilities: ${actor.facilityIds.length}`} />
        </View>
        <Text style={styles.bodyMuted}>Actor ID: {actor.id}</Text>
        <Text style={styles.bodyMuted}>
          Task visibility comes from the server-derived actor scope; request bodies never grant scope.
        </Text>
      </Card>

      <Card tone={pending.length > 0 ? "warning" : "success"}>
        <Text style={styles.heading}>Pending custody intents</Text>
        <Text style={styles.bodyMuted}>
          {pending.length === 0
            ? "No pending custody handover intents. Confirmed online handovers never sit in this list."
            : `${pending.length} handover intent(s) without a confirmed outcome. Each retains its original action ID, code and version and will be sent unchanged.`}
        </Text>
        {pending.map(entry => (
          <View key={entry.idempotencyKey} style={styles.pendingRow}>
            <Text style={styles.meta}>
              job {entry.jobId.slice(0, 8)}… • action {entry.actionId.slice(0, 8)}… • queued{" "}
              {new Date(entry.createdAt).toLocaleString()}
            </Text>
          </View>
        ))}
        <NoticeBox
          title="Queue storage honesty"
          body="This app currently uses the shared session foundation's injected stores. On the web build those stores are memory-only: closing the tab drops unconfirmed intents. A memory queue is NOT durable offline storage; durable persistence needs the native store integration (pending F00/native acceptance)."
          tone="warning"
        />
        {pending.length > 0 ? (
          <>
            <PrimaryButton label="Flush pending queue now" onPress={flush} busy={busy} />
            <Text style={styles.hint}>Flush replays each intent unchanged with its original idempotency key.</Text>
          </>
        ) : null}
      </Card>

      {flushResult ? <NoticeBox title="Flush result" body={flushResult} tone="warning" /> : null}

      <Card>
        <PrimaryButton label="Sign out" tone="quiet" onPress={signOut} busy={busy} />
      </Card>
    </View>
  );
}

export default function AccountScreen() {
  const session = usePartnerSession();
  const [signOutNote, setSignOutNote] = useState<string | null>(null);
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
    >
      <View style={styles.centerWrapper}>
        {session.state === "AUTHENTICATED" ? (
          <AccountPanel onSignOut={setSignOutNote} />
        ) : session.state === "LOADING" ? (
          <LoadingState label="Checking sign-in…" />
        ) : session.state === "CONFIG_ERROR" ? (
          <NoticeBox title="App configuration required" body={session.message} tone="danger" />
        ) : (
          <EmptyState
            title="Sign in required"
            body="Account details are private. Sign in from the task list first."
          />
        )}
        {signOutNote ? <NoticeBox title="Sign-out status" body={signOutNote} tone="warning" /> : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceTint },
  container: { padding: spacing.md, alignItems: "center" },
  centerWrapper: { width: "100%", maxWidth: maxContentWidth },
  heading: { color: colors.ink, fontWeight: "700", fontSize: 18, marginBottom: spacing.xs },
  bodyMuted: { color: colors.inkMuted, fontSize: 14, lineHeight: 20, marginTop: spacing.xs },
  row: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", marginVertical: spacing.xs },
  pendingRow: { marginTop: spacing.sm },
  meta: { color: colors.inkMuted, fontSize: 12 },
  hint: { color: colors.inkMuted, fontSize: 12, marginTop: spacing.sm },
});
