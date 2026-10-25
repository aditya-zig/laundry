import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, minTouchTarget, radius, spacing, typography } from "../theme";

export type CardTone = "neutral" | "warning" | "danger" | "success";
export type BadgeTone = CardTone | "action";
export type ButtonTone = "action" | "quiet";

const cardTones = StyleSheet.create({
  neutral: { backgroundColor: colors.surface },
  warning: { backgroundColor: colors.warningSoft, borderColor: "#F0D9A6" },
  danger: { backgroundColor: colors.dangerSoft, borderColor: "#F3C1BC" },
  success: { backgroundColor: colors.successSoft, borderColor: "#C4E0CE" },
});

const badgeTones = StyleSheet.create({
  neutral: { backgroundColor: "#E8EEF9" },
  action: { backgroundColor: colors.actionSoft },
  warning: { backgroundColor: colors.warningSoft },
  danger: { backgroundColor: colors.dangerSoft },
  success: { backgroundColor: colors.successSoft },
});

const badgeTextTones = StyleSheet.create({
  neutral: { color: colors.inkMuted },
  action: { color: colors.action },
  warning: { color: colors.warning },
  danger: { color: colors.danger },
  success: { color: colors.success },
});

const buttonTones = StyleSheet.create({
  action: { backgroundColor: colors.action },
  quiet: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
});

const noticeTones = StyleSheet.create({
  warning: { backgroundColor: colors.warningSoft },
  danger: { backgroundColor: colors.dangerSoft },
  success: { backgroundColor: colors.successSoft },
});

const noticeTitleTones = StyleSheet.create({
  warning: { color: colors.warning },
  danger: { color: colors.danger },
  success: { color: colors.success },
});

const base = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    width: "100%",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
    width: "100%",
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: typography.sizes.body,
    fontWeight: "700",
    flexShrink: 1,
  },
  button: {
    minHeight: minTouchTarget,
    borderRadius: radius.sm,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    color: colors.ink,
    fontSize: typography.sizes.body,
    fontWeight: "600",
  },
  buttonTextOnAction: { color: colors.surface, fontWeight: "700" },
  field: { marginTop: spacing.sm },
  fieldLabel: {
    color: colors.ink,
    fontSize: typography.sizes.caption,
    fontWeight: "600",
    marginBottom: 4,
  },
  fieldHint: {
    color: colors.inkMuted,
    fontSize: typography.sizes.caption,
    marginTop: 4,
  },
  input: {
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
  inputMultiline: { minHeight: 80, textAlignVertical: "top" },
  badge: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  badgeText: { fontSize: typography.sizes.caption, fontWeight: "700" },
  notice: {
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.sm,
    width: "100%",
  },
  noticeTitle: {
    fontSize: typography.sizes.caption,
    fontWeight: "700",
    marginBottom: 2,
  },
  noticeBody: {
    color: colors.ink,
    fontSize: typography.sizes.caption,
    lineHeight: 18,
  },
  emptyTitle: {
    color: colors.ink,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  bodyMuted: {
    color: colors.inkMuted,
    fontSize: typography.sizes.body,
    lineHeight: 22,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
});

export function Card(props: { children: React.ReactNode; tone?: CardTone }) {
  return <View style={[base.card, cardTones[props.tone ?? "neutral"]]}>{props.children}</View>;
}

export function SectionTitle(props: { children: string; right?: React.ReactNode }) {
  return (
    <View style={base.sectionHeader}>
      <Text style={base.sectionTitle}>{props.children}</Text>
      {props.right}
    </View>
  );
}

export function PrimaryButton(props: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  tone?: ButtonTone;
}) {
  const disabled = props.disabled || props.busy;
  const tone = props.tone ?? "action";
  return (
    <Pressable
      onPress={props.onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={disabled ? { disabled: true, busy: Boolean(props.busy) } : undefined}
      style={({ pressed }) => [base.button, buttonTones[tone], disabled && base.buttonDisabled, pressed && !disabled && tone === "action" ? { backgroundColor: colors.actionPressed } : null]}
    >
      {props.busy ? (
        <ActivityIndicator color={tone === "action" ? colors.surface : colors.ink} />
      ) : (
        <Text style={[base.buttonText, tone === "action" ? base.buttonTextOnAction : null]}>{props.label}</Text>
      )}
    </Pressable>
  );
}

export function Field(props: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <View style={base.field}>
      <Text style={base.fieldLabel}>{props.label}</Text>
      {props.children}
      {props.hint ? <Text style={base.fieldHint}>{props.hint}</Text> : null}
    </View>
  );
}

export function Input(props: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  accessibilityLabel: string;
  multiline?: boolean;
  numeric?: boolean;
  maxLength?: number;
  secure?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <TextInput
      value={props.value}
      onChangeText={props.onChangeText}
      placeholder={props.placeholder}
      placeholderTextColor={colors.inkMuted}
      accessibilityLabel={props.accessibilityLabel}
      multiline={props.multiline}
      keyboardType={props.numeric ? "number-pad" : "default"}
      maxLength={props.maxLength}
      secureTextEntry={props.secure}
      autoFocus={props.autoFocus}
      style={[base.input, props.multiline ? base.inputMultiline : null]}
    />
  );
}

export function Badge(props: { label: string; tone?: BadgeTone }) {
  const tone = props.tone ?? "neutral";
  return (
    <View style={[base.badge, badgeTones[tone]]}>
      <Text style={[base.badgeText, badgeTextTones[tone]]}>{props.label}</Text>
    </View>
  );
}

export function NoticeBox(props: { title: string; body: string; tone?: Exclude<CardTone, "neutral"> }) {
  const tone = props.tone ?? "warning";
  return (
    <View style={[base.notice, noticeTones[tone]]}>
      <Text style={[base.noticeTitle, noticeTitleTones[tone]]}>{props.title}</Text>
      <Text style={base.noticeBody}>{props.body}</Text>
    </View>
  );
}

export function EmptyState(props: { title: string; body: string }) {
  return (
    <Card>
      <Text style={base.emptyTitle}>{props.title}</Text>
      <Text style={base.bodyMuted}>{props.body}</Text>
    </Card>
  );
}

export function LoadingState(props: { label: string }) {
  return (
    <Card>
      <View style={base.loadingRow}>
        <ActivityIndicator color={colors.action} />
        <Text style={base.bodyMuted}>{props.label}</Text>
      </View>
    </Card>
  );
}

export function windowLabel(start: string, end: string): string {
  const fmt = (value: string) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "?";
    return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}
