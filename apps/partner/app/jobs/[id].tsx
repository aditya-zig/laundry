import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type { v2 } from "@laundry/contracts";
import { UnknownOutcomeError } from "@laundry/api-client";
import { getFoundation } from "../../src/foundation/session";
import {
  assignmentState,
  canViewCustomerDetails,
  nextActionLabel,
} from "../../src/features/jobs/access";
import {
  buildHandoverBody,
  classifyHandoverFailure,
  custodyReceiptCopy,
  describePendingHandover,
  emptyHandoverDraft,
  handoverEligible,
  pendingHandoverForJob,
  validateHandoverDraft,
  type HandoverCondition,
  type HandoverDraft,
  type HandoverPending,
  type HandoverUiState,
} from "../../src/features/jobs/handover";
import { createPartnerApi, pendingHandoverReceipts } from "../../src/features/session/partner-api";
import { usePartnerSession } from "../../src/features/session/use-partner-session";
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
} from "../../src/features/ui";
import {
  colors,
  maxContentWidth,
  spacing,
} from "../../src/theme";

const CONDITIONS: HandoverCondition[] = ["GOOD", "DAMAGED", "STAINTED", "MISSING"];

function useRiderApi() {
  return createPartnerApi({ foundation: getFoundation() });
}

function ConditionPicker(props: { value: HandoverCondition; onSelect: (value: HandoverCondition) => void }) {
  return (
    <View style={styles.row}>
      {CONDITIONS.map(option => (
        <Pressable
          key={option}
          onPress={() => props.onSelect(option)}
          accessibilityRole="button"
          accessibilityState={{ selected: props.value === option }}
          style={[styles.chip, props.value === option && styles.chipSelected]}
        >
          <Text style={[styles.chipText, props.value === option && styles.chipTextSelected]}>{option}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function JobDetailScreen() {
  const session = usePartnerSession();
  return <JobDetailContent key={session.identityEpoch} />;
}

function JobDetailContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = usePartnerSession();
  const api = useRiderApi();
  const actorId = session.state === "AUTHENTICATED" ? session.actor.id : null;

  const [job, setJob] = useState<v2.RiderJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (session.state !== "AUTHENTICATED") {
      setJob(null);
      setLoadError(null);
      if (session.state === "SIGNED_OUT") router.replace("/");
    }
  }, [session.state, router]);

  async function load(jobId: string) {
    const atLoad = api.actor()?.id ?? null;
    if (!atLoad) return;
    setLoading(true);
    setLoadError(null);
    try {
      const fetched = await api.getAssignedJob(jobId);
      if (api.actor()?.id !== atLoad) return;
      setJob(fetched);
    } catch (err) {
      if (api.actor()?.id !== atLoad) return;
      setLoadError(err instanceof Error ? err.message : "This task could not be loaded.");
    } finally {
      if (api.actor()?.id === atLoad) setLoading(false);
    }
  }

  useEffect(() => {
    if (id) void load(id);
  }, [id, actorId]);

  useFocusEffect(
    React.useCallback(() => {
      if (id && actorId) void load(id);
    }, [id, actorId]),
  );

  if (!id) return <MissingTask />;

  if (session.state === "CONFIG_ERROR") {
    return <NoticeBox title="App configuration required" body={session.message} tone="danger" />;
  }

  if (session.state === "SIGNED_OUT" || session.state === "LOADING") {
    return <NoticeBox title="Sign in required" body="Sign in on the task list to view this task." tone="warning" />;
  }

  if (loading && !job) return <LoadingState label="Loading task…" />;

  if (loadError) {
    return (
      <EmptyState
        title="Task unavailable"
        body={loadError + " The task may not be assigned to you, may be revoked, or the network call failed. Refresh the task list and retry."}
      />
    );
  }

  if (!job) return <MissingTask />;

  const mine = canViewCustomerDetails(job, actorId);
  const eligible = mine && handoverEligible(job, actorId);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.centerWrapper}>
        <SectionTitle right={<Badge label={`v${job.version}`} tone="neutral" />}>
          {job.leg === "PICKUP" ? "Pickup task" : "Return task"}
        </SectionTitle>
        <Card>
          <View style={styles.row}>
            <Badge label={job.leg} tone={job.leg === "PICKUP" ? "action" : "neutral"} />
            <Badge label={job.status} />
          </View>
          <View style={{ marginTop: spacing.sm }}>
            <Text style={styles.bodyMuted}>
              Window {windowLabel(job.window.start, job.window.end)} ({job.window.timezone})
            </Text>
            <Text style={styles.bodyMuted}>Containers: {job.containerCount}</Text>
            <Text style={styles.bodyMuted}>Next: {nextActionLabel(job)}</Text>
          </View>
        </Card>

        {!mine ? (
          <Card tone="warning">
            <Text style={styles.bodyStrong}>{describeVisibility(assignmentState(job, actorId))}</Text>
            <Text style={styles.bodyMuted}>
              Customer details, contact information and pickup notes are hidden. Only the assigned rider
              can perform custody handover for this task.
            </Text>
            <PrimaryButton label="Back to task list" tone="quiet" onPress={() => router.replace("/")} />
          </Card>
        ) : (
          <>
            <Card>
              <Text style={styles.heading}>{job.customerName}</Text>
              <Text style={styles.bodyMuted}>
                {job.addressLine1}, {job.addressCity} {job.addressPostalCode}
              </Text>
              {job.contactPhone ? <Text style={styles.bodyMuted}>Contact: {job.contactPhone}</Text> : null}
              {job.pickupNotes ? <Text style={styles.bodyMuted}>Notes: {job.pickupNotes}</Text> : null}
            </Card>
            <HandoverPanel job={job} eligible={eligible} onJobRefreshed={setJob} />
          </>
        )}
      </View>
    </ScrollView>
  );
}

function describeVisibility(state: ReturnType<typeof assignmentState>): string {
  switch (state) {
    case "UNASSIGNED":
      return "This task is not assigned to a rider yet.";
    case "REVOKED":
      return "Your assignment to this task was revoked — you cannot act on it.";
    case "OTHER_RIDER":
      return "This task is assigned to a different rider.";
    default:
      return "";
  }
}

function MissingTask() {
  return (
    <EmptyState title="Task not found" body="Open this screen from an assigned task on the task list." />
  );
}

function HandoverPanel(props: {
  job: v2.RiderJob;
  eligible: boolean;
  onJobRefreshed: (job: v2.RiderJob) => void;
}) {
  const router = useRouter();
  const api = useRiderApi();
  const [draft, setDraft] = useState<HandoverDraft>(() => emptyHandoverDraft());
  const [uiState, setUiState] = useState<HandoverUiState>({ kind: "IDLE" });
  const [pending, setPending] = useState<HandoverPending | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function refreshPending() {
    const atLoad = api.actor()?.id ?? null;
    if (!atLoad) return;
    try {
      const records = await api.queuedMutations();
      if (api.actor()?.id !== atLoad) return;
      const entry = pendingHandoverForJob(records, props.job.id);
      setPending(entry);
      if (entry) {
        setUiState(current =>
          current.kind === "CONFIRMED_ONLINE" ? current : { kind: "PENDING_SYNC", pending: entry },
        );
      }
    } catch {
      setPending(null);
    }
  }

  useEffect(() => {
    setUiState(current => (current.kind === "CONFIRMED_ONLINE" ? current : { kind: "IDLE" }));
    void refreshPending();
  }, [props.job.id]);

  async function submit() {
    const issue = validateHandoverDraft({
      code: draft.code,
      garmentCount: draft.garmentCount,
      containerIds: props.job.containerIds,
    });
    if (issue) {
      setFormError(issue.message);
      return;
    }
    setFormError(null);
    const actorId = api.actor()?.id;
    if (!actorId || !handoverEligible(props.job, actorId)) return;
    setSubmitting(true);
    try {
      const body = buildHandoverBody(props.job, {
        actionId: draft.actionId,
        code: draft.code,
        garmentCount: Number(draft.garmentCount),
        condition: draft.condition,
        note: draft.note.trim() === "" ? undefined : draft.note.trim(),
      });
      const result = await api.submitHandover(props.job.id, body);
      setUiState({ kind: "CONFIRMED_ONLINE", receipt: result });
      setDraft(d => ({ ...d, code: "", note: "" }));
      try {
        const refreshed = await api.getAssignedJob(props.job.id);
        if (api.actor()?.id === actorId) props.onJobRefreshed(refreshed);
      } catch {
        // The receipt still reflects the authoritative server outcome.
      }
    } catch (err) {
      if (err instanceof UnknownOutcomeError) {
        setUiState({ kind: "OUTCOME_UNKNOWN", actionId: draft.actionId });
        void refreshPending();
      } else {
        const failure = classifyHandoverFailure(err, draft.actionId);
        setUiState({
          kind: "REJECTED",
          actionId: draft.actionId,
          message: failure.kind === "REJECTED" ? failure.message : String(err),
          canRetryWithSameDetails: failure.canRetryWithSameDetails,
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!props.eligible) {
    return (
      <Card tone="warning">
        <Text style={styles.heading}>Custody handover</Text>
        <Text style={styles.bodyMuted}>
          Handover is available to the assigned, active rider while the task is in flight.
        </Text>
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle>Custody handover</SectionTitle>
      <Text style={styles.bodyMuted}>
        Ask the customer (pickup) or facility staff (return) for the six-digit custody code. The code is
        never displayed in this app. Container and garment facts come from the bag labels you actually
        carry — this build cannot scan barcodes.
      </Text>

      {uiState.kind === "CONFIRMED_ONLINE" ? <Receipt receipt={uiState.receipt} /> : null}

      {uiState.kind === "OUTCOME_UNKNOWN" ? (
        <NoticeBox
          title="Outcome unknown — pending sync"
          body={`The custody request could not be confirmed (network or unknown server outcome). The exact intent is retained with action ${uiState.actionId.slice(0, 8)}… and syncs unchanged. Do not treat the bags as handed over until sync confirms it.`}
          tone="warning"
        />
      ) : null}

      {uiState.kind === "PENDING_SYNC" ? (
        <NoticeBox
          title="Pending sync — not confirmed"
          body={describePendingHandover(uiState.pending)}
          tone="warning"
        />
      ) : null}

      {uiState.kind === "REJECTED" ? (
        <NoticeBox
          title="Custody not recorded"
          body={`${uiState.message} ${uiState.canRetryWithSameDetails
            ? "You may retry with the same code details."
            : "Fix the displayed problem before retrying; a stale code or version may need dispatch help."}`}
          tone="danger"
        />
      ) : null}

      {uiState.kind !== "CONFIRMED_ONLINE" ? (
        <>
          <Field label="Custody code (six digits)">
            <Input
              value={draft.code}
              onChangeText={value => setDraft(d => ({ ...d, code: value.replace(/\s/g, "") }))}
              accessibilityLabel="Custody code"
              numeric
              maxLength={6}
              placeholder="000000"
            />
          </Field>
          <Field
            label="Garment count recorded at handover"
            hint="Whole number of garments on the bags being handed over, from the bag label."
          >
            <Input
              value={draft.garmentCount}
              onChangeText={value => setDraft(d => ({ ...d, garmentCount: value.replace(/[^0-9]/g, "") }))}
              accessibilityLabel="Garment count"
              numeric
              maxLength={6}
              placeholder="0"
            />
          </Field>
          <Field label="Condition observed">
            <ConditionPicker value={draft.condition} onSelect={condition => setDraft(d => ({ ...d, condition }))} />
          </Field>
          <Field label="Note (optional, max 360 chars)">
            <Input
              value={draft.note}
              onChangeText={value => setDraft(d => ({ ...d, note: value }))}
              accessibilityLabel="Handover note"
              multiline
              maxLength={360}
              placeholder="e.g. gate access note"
            />
          </Field>
          <PrimaryButton
            label="Record handover online"
            accessibilityLabel="Record custody handover"
            onPress={() => void submit()}
            busy={submitting}
            disabled={
              draft.code.length !== 6 ||
              draft.garmentCount === "" ||
              Number.isNaN(Number(draft.garmentCount))
            }
          />
          {formError ? <NoticeBox title="Check the handover details" body={formError} tone="warning" /> : null}
          {uiState.kind === "OUTCOME_UNKNOWN" || pending ? (
            <PrimaryButton label="Check sync status" tone="quiet" onPress={() => void refreshPending()} />
          ) : null}
        </>
      ) : (
        <PrimaryButton label="Back to task list" tone="quiet" onPress={() => router.replace("/")} />
      )}
    </Card>
  );
}

function Receipt(props: { receipt: v2.HandoverResult }) {
  const copy = custodyReceiptCopy(props.receipt);
  return (
    <NoticeBox
      title={copy.headline}
      body={copy.details.join("\n")}
      tone={copy.accepted ? "success" : "warning"}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceTint },
  container: { padding: spacing.md, alignItems: "center" },
  centerWrapper: { width: "100%", maxWidth: maxContentWidth },
  heading: { color: colors.ink, fontWeight: "700" },
  bodyStrong: { color: colors.ink, fontWeight: "700", marginBottom: spacing.xs },
  bodyMuted: { color: colors.inkMuted, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", alignItems: "center" },
  chip: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  chipSelected: { borderColor: colors.action, backgroundColor: colors.actionSoft },
  chipText: { color: colors.ink, fontWeight: "600" },
  chipTextSelected: { color: colors.action },
});
