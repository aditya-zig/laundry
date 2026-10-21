import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import type { Quote } from "@laundry/contracts";
import { getClient } from "../../src/api";
import { formatINR } from "../../src/guards";
import { colors, spacing, minTouchTarget } from "../../src/theme";

export default function Help() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [draft, setDraft] = useState<{ draftId: string; revision: number; quoteId?: string } | null>(null);
  const [draftQuote, setDraftQuote] = useState<Quote | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function send() {
    if (!message.trim()) return;
    setSending(true);
    setNotice(null);
    try {
      const res = await getClient().postConversationMessage(message.trim());
      setReply(res.reply);
      setMissing(res.missingFields);
      setDraft({
        draftId: res.draft.draftId,
        revision: res.draft.revision,
        quoteId: res.draft.quoteId ?? res.quote?.id,
      });
      setDraftQuote(res.quote ?? null);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not reach the booking assistant");
    } finally {
      setSending(false);
    }
  }

  async function confirmBooking() {
    if (!draft || !draft.quoteId) return;
    setSending(true);
    setNotice(null);
    try {
      const c = await getClient().confirmDraft(draft.draftId, draft.revision, draft.quoteId);
      router.push({ pathname: "/orders/[id]", params: { id: c.orderId, paymentId: c.paymentId } });
    } catch (e) {
      setNotice(
        e instanceof Error
          ? e.message
          : "Confirmation failed. If anything changed, send a new message for fresh terms.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <ScrollView style={{ padding: spacing.md }}>
      <Text style={{ color: colors.ink, fontSize: 24, fontWeight: "700" }}>Help</Text>
      <Text style={{ color: colors.ink, marginTop: 12 }}>
        Pickup windows are confirmed in the app. If a slot is unavailable, the app
        suggests an alternative instead of silently replacing your request.
      </Text>
      <Text style={{ color: colors.ink, marginTop: 8 }}>
        Support for missing or damaged items opens an incident trail. Orders are never
        silently marked successful after a complaint.
      </Text>
      <Text style={{ color: colors.inkMuted, marginTop: 8 }}>
        DEMO build: support replies and refunds shown here come from labeled simulators.
      </Text>

      <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "700", marginTop: spacing.lg }}>
        Conversational booking (DEMO)
      </Text>
      <Text style={{ color: colors.inkMuted, marginTop: 4 }}>
        Describe your pickup in words, for example "Pick up five shirts tomorrow between
        nine and ten, wash and press". The assistant asks only what is missing, then
        shows exact dated terms to confirm. Confirmation is bound to that draft revision.
      </Text>
      <TextInput
        value={message}
        onChangeText={setMessage}
        placeholder="What do you need picked up?"
        multiline
        style={{ borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 8, marginTop: 8, minHeight: 72 }}
        accessibilityLabel="Booking request message"
      />
      <Pressable
        onPress={send}
        disabled={sending}
        style={{ backgroundColor: colors.action, borderRadius: 12, padding: 12, marginTop: 8, minHeight: minTouchTarget, justifyContent: "center", opacity: sending ? 0.6 : 1 }}
      >
        <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>
          {sending ? "Sending…" : "Send"}
        </Text>
      </Pressable>
      {sending && <ActivityIndicator style={{ marginTop: 12 }} />}
      {reply && (
        <View style={{ marginTop: 12, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: spacing.md }}>
          <Text style={{ color: colors.ink }}>{reply}</Text>
          {missing.length > 0 && (
            <Text style={{ color: colors.warning, marginTop: 8 }}>
              Still needed: {missing.join(", ")}
            </Text>
          )}
          {draftQuote && (
            <Text style={{ color: colors.ink, marginTop: 8, fontWeight: "600" }}>
              Quoted total {formatINR(draftQuote.totalMinor)} {draftQuote.provisional ? "(provisional)" : "(fixed)"}
            </Text>
          )}
          {draft?.quoteId && missing.length === 0 && (
            <Pressable
              onPress={confirmBooking}
              disabled={sending}
              style={{ backgroundColor: colors.action, borderRadius: 12, padding: 12, marginTop: 12, minHeight: minTouchTarget, justifyContent: "center", opacity: sending ? 0.6 : 1 }}
            >
              <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>
                Confirm this booking (DEMO)
              </Text>
            </Pressable>
          )}
        </View>
      )}
      {notice && <Text style={{ marginTop: 12, color: colors.danger }}>{notice}</Text>}
    </ScrollView>
  );
}
