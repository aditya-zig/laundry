// Customer progress is not an audit log. A normal authoritative state proves
// earlier journey milestones even when no separate history row was emitted.
const milestones = ['CONFIRMED', 'PICKUP_PENDING', 'AT_FACILITY', 'IN_CARE', 'QUALITY_CHECK', 'READY_FOR_RETURN', 'RETURNING', 'DELIVERED'] as const;

type ProgressLabel = 'Done' | 'Current' | 'Pending' | 'Recorded' | 'Not reached';

export function trackingProgress(status: string, timeline: readonly { status: string }[]) {
  const current = milestones.findIndex(step => step === status);
  const recorded = new Set(timeline.map(event => event.status));
  return milestones.map((step, index): { status: string; label: ProgressLabel } => ({
    status: step,
    label: current < 0 ? recorded.has(step) ? 'Recorded' : 'Not reached'
      : status === 'DELIVERED' || index < current ? 'Done'
      : index === current ? 'Current' : 'Pending',
  }));
}

// Conservative affordance only; the server still owns authorization, version
// checks and cancellation/refund decisions. Unknown and paused states stay closed.
export function canOfferCancellation(status: string): boolean {
  return ['AWAITING_PAYMENT', 'CONFIRMED', 'PICKUP_PENDING', 'AT_FACILITY', 'AWAITING_ADJUSTMENT'].includes(status);
}
