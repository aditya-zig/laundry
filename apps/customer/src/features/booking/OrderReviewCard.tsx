import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { v2 } from '@laundry/contracts';
import { isMutationOutcomePending } from '@laundry/app-foundation';
import { apiV2, getFoundation } from '../../api-v2';
import { colors, minTouchTarget } from '../../theme';
import { pendingReview, reviewFor, type ReviewIntent } from './order-review';
import { describeError } from './presenters';
import { Card, Loading, NoteCard } from './ui';

export function OrderReviewCard({ order }: { order: v2.Order }) {
  const [eligibility, setEligibility] = useState<v2.ReviewEligibility | null>(null);
  const [pending, setPending] = useState<ReviewIntent | null>(null);
  const [confirmed, setConfirmed] = useState<v2.Review | null>(null);
  const [rating, setRating] = useState(0), [comment, setComment] = useState(''), [consent, setConsent] = useState(false);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false);
  const [notice, setNotice] = useState<string | null>(null), [revision, setRevision] = useState(0);
  const alive = useRef(true), sending = useRef(false);
  useEffect(() => {
    let active = true;
    alive.current = true;
    setReady(false); setNotice(null);
    Promise.all([apiV2.getReviewEligibility(order.id), getFoundation().listQueuedMutations()]).then(([value, records]) => {
      if (!active) return;
      setPending(pendingReview(records, order.id)); setEligibility(value); setBlocked(false); setReady(true);
    }).catch(error => {
      if (active) setNotice(error instanceof Error ? error.message : 'Review eligibility could not be checked.');
    });
    return () => { active = false; alive.current = false; };
  }, [order.id, order.version, revision]);

  async function submit() {
    if (sending.current || !ready || blocked || !eligibility) return;
    let body: v2.ReviewInput;
    try { body = pending?.body ?? reviewFor(order, eligibility, { overall: rating, comment, publishConsent: consent }); }
    catch { setNotice('Select a rating from 1 to 5 and keep feedback within 5,000 characters. If eligibility changed, refresh the order first.'); return; }
    sending.current = true; setBusy(true); setNotice(null);
    try {
      const value = await getFoundation().enqueueMutation({ routeId: 'reviews.create', body, ...(pending ? { retainedKey: pending.retainedKey } : {}) });
      if (alive.current) { setConfirmed(value); setPending(null); }
    } catch (error) {
      if (!alive.current) return;
      if (isMutationOutcomePending(error)) {
        try {
          const original = pendingReview(await getFoundation().listQueuedMutations(), order.id);
          if (!original) throw new Error('Original command is unavailable');
          if (alive.current) { setPending(original); setNotice('The result is unconfirmed. Check the original review below; do not submit replacement feedback or reload this memory-only session.'); }
        } catch {
          if (alive.current) { setBlocked(true); setNotice('The original review could not be safely recovered. Reconcile the server record before submitting another; no replacement command was created.'); }
        }
      } else {
        setPending(null); setReady(false); setNotice(`${describeError(error).body} Refresh the review status before trying again.`);
      }
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }

  if (!ready) return notice
    ? <NoteCard kind="warning" title="Review status unavailable" body={notice} actionLabel="Refresh review status" onAction={() => setRevision(value => value + 1)} />
    : <Loading label="Checking review eligibility" />;
  if (confirmed) return <NoteCard kind="note" title="Review recorded" body={`Review ${confirmed.id}. ${!confirmed.publishConsent ? 'You did not consent to publication; this review is not public.' : confirmed.publication === 'PUBLISHED' ? 'Published with your consent.' : 'Not public: publication requires moderation approval.'}`} />;
  return <Card title="Review this order">
    <Text style={{ color: colors.inkMuted, marginTop: 8 }}>Only the owner of a delivered order can leave one review. No rating or publication consent is selected for you.</Text>
    {notice ? <NoteCard kind="warning" title="Review submission status" body={notice} /> : null}
    {pending ? <>
      <Text style={{ color: colors.ink, marginTop: 12 }}>Original rating: {pending.body.overall}/5</Text>
      <Text style={{ color: colors.ink, marginTop: 8 }}>{pending.body.comment || 'No written feedback.'}</Text>
      <Text style={{ color: colors.inkMuted, marginTop: 8 }}>Publication consent: {pending.body.publishConsent ? 'Yes; still subject to moderation' : 'No'}</Text>
      <Action label={busy ? 'Checking original review…' : 'Check original review'} disabled={busy || blocked} onPress={() => void submit()} />
    </> : eligibility?.eligible && order.status === 'DELIVERED' && !eligibility.existingReviewId && !blocked ? <>
      <Text style={{ color: colors.ink, marginTop: 12 }}>Overall rating (required)</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {[1, 2, 3, 4, 5].map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={`Rate ${value} out of 5`} accessibilityState={{ checked: rating === value, disabled: busy }} disabled={busy} onPress={() => setRating(value)} style={{ minWidth: minTouchTarget, minHeight: minTouchTarget, padding: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: rating === value ? colors.action : colors.surface, borderWidth: 1, borderColor: colors.border }}><Text style={{ color: rating === value ? colors.surface : colors.ink, fontWeight: '700' }}>{value}</Text></Pressable>)}
      </View>
      <Text style={{ color: colors.ink, marginTop: 12 }}>Written feedback (optional, up to 5,000 characters)</Text>
      <TextInput accessibilityLabel="Review feedback" value={comment} onChangeText={setComment} maxLength={5000} editable={!busy} multiline style={{ minHeight: 100, marginTop: 8, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, color: colors.ink, textAlignVertical: 'top' }} />
      <Pressable accessibilityRole="checkbox" accessibilityLabel="Allow publication after moderation" accessibilityState={{ checked: consent, disabled: busy }} disabled={busy} onPress={() => setConsent(value => !value)} style={{ minHeight: minTouchTarget, marginTop: 12, justifyContent: 'center' }}><Text style={{ color: colors.ink }}>{consent ? '☑' : '☐'} Allow this review to be published after moderation (optional).</Text></Pressable>
      <Text style={{ color: colors.inkMuted, marginTop: 8 }}>Photos are not attached on this screen. Leave publication consent off to keep feedback private.</Text>
      <Action label={busy ? 'Submitting review…' : 'Submit review'} disabled={busy || rating === 0} onPress={() => void submit()} />
    </> : <Text style={{ color: colors.inkMuted, marginTop: 12 }}>{blocked ? 'Submission is blocked until the original command is reconciled.' : eligibility?.existingReviewId ? `A review is already recorded for this order (${eligibility.existingReviewId}). A second review is not allowed.` : eligibility?.reason ?? 'This order is not currently eligible for a review.'}</Text>}
  </Card>;
}
function Action({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={{ minHeight: minTouchTarget, marginTop: 12, padding: 12, borderRadius: 8, backgroundColor: colors.action, justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}><Text style={{ color: colors.surface, fontWeight: '700', textAlign: 'center' }}>{label}</Text></Pressable>;
}
