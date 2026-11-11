import type { v2 } from '@laundry/contracts';

type StatusView = { title: string; detail: string; attention: boolean };
const statuses: Record<v2.OrderStatus, StatusView> = {
  CONFIRMED: { title: 'Booking confirmed', detail: 'Your booking is recorded. Pickup handover has not yet been confirmed.', attention: false },
  PICKUP_PENDING: { title: 'Pickup in progress', detail: 'Pickup is being arranged or carried out. See the pickup leg and custody record for confirmed handovers.', attention: false },
  AT_FACILITY: { title: 'At the laundry facility', detail: 'Your laundry has reached the facility for intake. Care has not yet been recorded as started.', attention: false },
  AWAITING_ADJUSTMENT: { title: 'Your approval is needed', detail: 'Review the revised total below. A change in price is not accepted until you explicitly decide.', attention: true },
  IN_CARE: { title: 'Laundry in care', detail: 'Care is underway. Quality check and return handover are separate recorded steps.', attention: false },
  QUALITY_CHECK: { title: 'Quality check underway', detail: 'The facility is checking your laundry. It is not yet recorded as ready for return.', attention: false },
  READY_FOR_RETURN: { title: 'Ready for return', detail: 'Your laundry is ready. This does not mean a return rider has collected it yet.', attention: false },
  RETURNING: { title: 'Returning to you', detail: 'The return journey is underway. Your order is not yet recorded as delivered.', attention: false },
  DELIVERED: { title: 'Delivered', detail: 'Delivery has been recorded. Payment confirmations and any refund remain separate records below.', attention: false },
  ON_HOLD: { title: 'Order on hold', detail: 'Progress is paused. Check recorded updates or contact support for the next step; the return window is not a new promise.', attention: true },
  CANCEL_REQUESTED: { title: 'Cancellation requested', detail: 'Your request is recorded, but cancellation is not confirmed. Do not assume pickup or care has stopped.', attention: true },
  CANCELLED: { title: 'Order cancelled', detail: 'Cancellation is recorded. Any remaining custody, payment or refund needs its own confirmation.', attention: false },
  RESOLUTION_REQUIRED: { title: 'Your order needs attention', detail: 'An exception needs resolution. Check recorded updates and contact support; no successful return is implied.', attention: true },
};
export function orderStatusView(status: v2.OrderStatus): StatusView { return statuses[status]; }

/** Two reads can straddle a mutation. Never present conflicting status/history as one fresh record. */
export function checkedTrackingSnapshot(order: v2.Order, events: v2.OrderTimelineEvent[]) {
  const latest = events.at(-1);
  if (latest && latest.status !== order.status) throw new Error('Your order changed while updates were loading. Refresh to check again.');
  return { order, events };
}

const dispatch: Record<string, string | undefined> = {
  REQUESTED: 'Rider request recorded; assignment not confirmed.',
  BOOKING_UNKNOWN: 'Rider booking outcome not confirmed. The team must check the original request.',
  BOOKED: 'Rider booking recorded; handover not confirmed.',
  ASSIGNED: 'Rider assigned; this is not a handover confirmation.',
  AT_PICKUP: 'Rider arrival recorded; handover not confirmed.',
  IN_TRANSIT: 'Journey in progress; destination handover not confirmed.',
  COMPLETED: 'Journey completion recorded. See custody for handover details.',
  FAILED: 'Journey failed. Contact support for the next confirmed arrangement.',
  CANCEL_REQUESTED: 'Dispatch cancellation requested; outcome not confirmed.',
  CANCELLED: 'Dispatch cancelled. This does not cancel the order.',
} satisfies Record<v2.LegAttemptStatus, string>;
export function deliveryLegView(leg: v2.DeliveryLegSummary) {
  return { title: leg.leg === 'PICKUP' ? 'Pickup' : 'Return',
    detail: Object.hasOwn(dispatch, leg.status) ? dispatch[leg.status]! : 'Dispatch update unavailable. Refresh or contact support.',
    completedAt: leg.status === 'COMPLETED' ? leg.completedAt : undefined };
}

export function formatTrackingTime(at: string, timezone: string): string {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  try { return new Intl.DateTimeFormat('en-IN', { ...options, timeZone: timezone }).format(date); }
  catch { return `${new Intl.DateTimeFormat('en-IN', { ...options, timeZone: 'UTC' }).format(date)} UTC`; }
}
export function formatTrackingWindow(window: v2.ScheduleWindow): string {
  return `${formatTrackingTime(window.start, window.timezone)} — ${formatTrackingTime(window.end, window.timezone)} (${window.timezone})`;
}
/** Keep server sequence (including rework), not timestamp sort or a fixed list of imagined stages. */
export function recordedHistory(events: readonly v2.OrderTimelineEvent[], timezone: string) {
  return events.map(event => ({ ...event, time: formatTrackingTime(event.at, timezone) }));
}
const handoffs: Record<v2.CustodyReceipt['currentHandoff'], string> = {
  NONE: 'No current handover confirmed', PICKUP_PENDING: 'Pickup handover pending', AT_PICKUP: 'At pickup; handover pending',
  PICKED_UP: 'Pickup handover recorded', AT_FACILITY: 'Facility receipt recorded', IN_CARE: 'In facility care',
  READY_FOR_RETURN: 'Ready for return handover', RETURN_PENDING: 'Return handover pending', RETURNED: 'Return handover recorded', DELIVERED: 'Delivery recorded',
};
export function custodyView(receipt: v2.CustodyReceipt) {
  return { handoff: handoffs[receipt.currentHandoff], declared: receipt.declaredGarmentCount?.toString() ?? 'Not recorded',
    counted: receipt.countedQuantity?.toString() ?? 'Not recorded',
    weight: receipt.measuredWeightGrams === undefined ? 'Not recorded' : `${receipt.measuredWeightGrams / 1000} kg`,
    sealed: receipt.sealedContainerCount.toString() };
}
