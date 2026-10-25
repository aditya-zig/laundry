// Product adapter. All requests use the first-party SDK; browser session and
// pending-intent defaults are memory-only, not durable/device storage claims.
import type { v2 } from '@laundry/contracts';
import { getFoundation, getV2Client } from './foundation/session.js';
export const apiV2 = {
  async verifyAndAdoptSession(args: { challengeId: string; code: string; mfaCode?: string; idempotencyKey?: string }) {
    // OTP verification is public: requiring an existing session here prevents login.
    const session = await getV2Client().verifyOtp(args.challengeId, args.code, { mfaCode: args.mfaCode, idempotencyKey: args.idempotencyKey });
    await getFoundation().adoptAuthenticatedSession(session);
    return getFoundation().snapshot();
  },
  async quote(input: v2.QuoteInput): Promise<v2.Quote> {
    return getFoundation().enqueueMutation({ routeId: 'orders.quote', body: input });
  },
  /** Persistence across process loss depends on injected, verified stores. */
  async bookOrderDurable(input: v2.BookingInput): Promise<v2.Order> {
    return getFoundation().enqueueMutation({ routeId: 'orders.book', body: input });
  },
  listOrders: () => getFoundation().authorized(client => client.listOrders()),
  getOrder: (id: string) => getFoundation().authorized(client => client.getOrder(id)),
  getOrderTimeline: (id: string) => getFoundation().authorized(client => client.getOrderTimeline(id)),
  logout: () => getFoundation().logout(),
};
export { getFoundation, getV2Client };
