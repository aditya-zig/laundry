import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { v2 } from '@laundry/contracts';
import { isMutationOutcomePending } from '@laundry/app-foundation';
import { getFoundation } from '../../foundation/session';
import { formatINR } from '../../guards';
import { colors, minTouchTarget } from '../../theme';
import { adjustmentDecisionFor, pendingAdjustmentDecision } from './adjustment-decision';
import { describeError } from './presenters';
import { Card, Loading, NoteCard } from './ui';

/** Consent is always a customer click over exact server versions, never automatic queue flushing. */
export function AdjustmentDecisionCard({ order, onUpdated }: { order: v2.Order; onUpdated: () => void }) {
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<v2.AdjustmentDecision | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true), sending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    void getFoundation().listQueuedMutations().then(records => {
      if (!mounted.current) return;
      setPending(pendingAdjustmentDecision(records, order.id)); setReady(true);
    }).catch(() => { if (mounted.current) setNotice('The saved decision could not be recovered. Do not submit a replacement; reconcile the order first.'); });
    return () => { mounted.current = false; };
  }, [order.id]);
  async function submit(decision: v2.AdjustmentDecision['decision']) {
    if (sending.current || !ready) return;
    let input: v2.AdjustmentDecision;
    try { input = pending ?? adjustmentDecisionFor(order, decision); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Refresh the order before deciding.'); return; }
    sending.current = true; setPending(input); setBusy(true); setNotice(null);
    let confirmed = false;
    try {
      await getFoundation().enqueueMutation({ routeId: 'orders.adjustment.decide', params: { orderId: order.id }, body: input });
      confirmed = true;
      if (mounted.current) setPending(null);
    } catch (error) {
      if (!mounted.current) return;
      if (isMutationOutcomePending(error)) setNotice('The outcome is unconfirmed. Check the original decision below; do not choose a different decision or reload this session.');
      else { setPending(null); setNotice(`${describeError(error).body} Refresh the order before deciding again.`); }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
    if (confirmed && mounted.current) onUpdated();
  }
  const proposal = order.adjustment;
  if (!ready) return notice ? <NoteCard kind="warning" title="Decision recovery blocked" body={notice} /> : <Loading label="Checking saved decisions" />;
  if (!proposal && !pending) return null;
  const permitted = proposal?.state === 'PROPOSED' && order.status === 'AWAITING_ADJUSTMENT';
  return <Card title="Measured intake adjustment">
    {proposal ? <>
      <Text style={{ color: colors.ink, marginTop: 8 }}>{proposal.reason}</Text>
      <Text style={{ color: colors.ink, marginTop: 8 }}>Previous total {formatINR(proposal.previousTotalMinor)} → proposed total {formatINR(proposal.newTotalMinor)}</Text>
      <Text style={{ color: colors.inkMuted, marginTop: 8 }}>State: {proposal.state}. Proposal expires {proposal.expiresAt}. The server decides whether these terms are still current.</Text>
    </> : null}
    <Text style={{ color: colors.inkMuted, marginTop: 8 }}>Accept only if you agree to the revised total. Declining places care on hold; it does not approve the extra charge or automatically cancel the order.</Text>
    {notice ? <NoteCard kind="warning" title="Decision status" body={notice} /> : null}
    {pending ? <Action label={busy ? 'Checking…' : `Check original ${pending.decision.toLowerCase()} decision`} busy={busy} onPress={() => void submit(pending.decision)} /> : permitted ? <View>
      {order.permittedActions.includes('ACCEPT_ADJUSTMENT') ? <Action label={`Accept revised total ${formatINR(proposal.newTotalMinor)}`} busy={busy} onPress={() => void submit('ACCEPT')} /> : null}
      {order.permittedActions.includes('DECLINE_ADJUSTMENT') ? <Action label="Decline adjustment · place on hold" busy={busy} onPress={() => void submit('DECLINE')} /> : null}
    </View> : null}
  </Card>;
}
function Action({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" disabled={busy} onPress={onPress} style={{ minHeight: minTouchTarget, marginTop: 12, padding: 12, borderRadius: 8, backgroundColor: colors.action, justifyContent: 'center', opacity: busy ? 0.5 : 1 }}><Text style={{ color: colors.surface, fontWeight: '700', textAlign: 'center' }}>{label}</Text></Pressable>;
}
