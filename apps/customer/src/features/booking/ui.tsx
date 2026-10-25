import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, minTouchTarget, radius, spacing } from "../../theme";

// Shared product-screen scaffolding: honest state cards on the Framed-sheet
// direction (white sheet, pale-blue ground, hairline edges, teal action,
// navy ink). No demo labeling lives in product screens.

export type NoteKind = "note" | "blocked" | "error" | "success" | "warning";

const KIND_STYLE: Record<NoteKind, { card: object; title: object; body: object }> = {
  note: { card: { borderColor: colors.border }, title: { color: colors.ink }, body: { color: colors.inkMuted } },
  blocked: { card: { borderColor: colors.warning, backgroundColor: colors.warningSoft }, title: { color: colors.warning }, body: { color: colors.warning } },
  error: { card: { borderColor: colors.danger, backgroundColor: colors.dangerSoft }, title: { color: colors.danger }, body: { color: colors.danger } },
  success: { card: { borderColor: colors.success, backgroundColor: colors.successSoft }, title: { color: colors.success }, body: { color: colors.ink } },
  warning: { card: { borderColor: colors.warning, backgroundColor: colors.warningSoft }, title: { color: colors.warning }, body: { color: colors.warning } },
};

export function NoteCard(props: {
  kind: NoteKind;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
}) {
  const style = KIND_STYLE[props.kind];
  return (
    <View style={[styles.card, style.card]} accessibilityLiveRegion="polite">
      <Text style={[styles.noteTitle, style.title]} accessibilityRole="alert">
        {props.title}
      </Text>
      {props.body ? <Text style={[styles.noteBody, style.body]}>{props.body}</Text> : null}
      {props.actionLabel && props.onAction ? (
        <Pressable
          onPress={props.onAction}
          disabled={props.actionDisabled}
          style={({ pressed }) => [styles.action, props.actionDisabled === true && styles.disabled, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={props.actionLabel}
        >
          <Text style={styles.actionText}>{props.actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Loading(props: { label: string }) {
  return <ActivityIndicator accessibilityLabel={props.label} color={colors.action} style={styles.loading} />;
}

export function Card(props: { title: string; children: ReactNode }) {
  return (
    <View style={styles.sheetCard}>
      <Text style={styles.cardTitle} accessibilityRole="header">
        {props.title}
      </Text>
      {props.children}
    </View>
  );
}

export function Page({ title, children }: { title: string; children: ReactNode }) {
  return <ScrollView style={{ flex: 1, backgroundColor: colors.surfaceTint }} contentContainerStyle={{ padding: spacing.md, paddingBottom: 40, width: "100%", maxWidth: 560, alignSelf: "center" }}>
    <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 26, fontWeight: "700" }}>{title}</Text>
    {children}
  </ScrollView>;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  noteTitle: { fontSize: 16, fontWeight: "700" },
  noteBody: { fontSize: 15, lineHeight: 22, marginTop: 6 },
  action: {
    minHeight: minTouchTarget,
    borderRadius: radius.sm,
    backgroundColor: colors.action,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  pressed: { backgroundColor: colors.actionPressed },
  disabled: { opacity: 0.5 },
  actionText: { color: colors.surface, fontSize: 15, fontWeight: "700" },
  loading: { marginTop: spacing.lg },
  sheetCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  cardTitle: { color: colors.ink, fontSize: 18, fontWeight: "700" },
});
