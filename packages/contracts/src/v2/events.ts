import { z } from "zod";
import {
  idSchema,
  instantSchema,
} from "./common.js";
import {
  orderSchema,
  quoteSchema,
  adjustmentSchema,
  adjustmentDecisionSchema,
  custodyReceiptSchema,
} from "./orders.js";
import {
  obligationSchema,
  refundSchema,
  receiptSchema,
} from "./billing.js";
import { legAttemptSchema } from "./logistics.js";
import { mediaReferenceSchema } from "./media.js";
import { draftConfirmationSchema } from "./conversations.js";

export const eventEnvelopeSchema = z.object({
  eventId: idSchema,
  eventType: z.string().trim().min(1),
  schemaVersion: z.literal(2),
  aggregateId: idSchema,
  aggregateVersion: z.number().int().positive(),
  occurredAt: instantSchema,
  traceId: idSchema,
  payload: z.record(z.unknown()),
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export const eventTypeSchema = z.enum([
  "order.confirmed.v2",
  "order.intake-recorded.v2",
  "order.adjustment-decided.v2",
  "order.ready-for-return.v2",
  "order.delivered.v2",
  "payment.settled.v2",
  "refund.updated.v2",
  "delivery.updated.v2",
  "media.uploaded.v2",
  "conversation.draft-confirmed.v2",
]);
export type EventType = z.infer<typeof eventTypeSchema>;

export const orderConfirmedPayloadSchema = z.object({
  order: orderSchema,
  quote: quoteSchema,
});
export type OrderConfirmedPayload = z.infer<typeof orderConfirmedPayloadSchema>;

export const orderIntakeRecordedPayloadSchema = z.object({
  orderId: idSchema,
  custodyReceipt: custodyReceiptSchema,
  measuredAt: instantSchema,
});
export type OrderIntakeRecordedPayload = z.infer<
  typeof orderIntakeRecordedPayloadSchema
>;

export const orderAdjustmentDecidedPayloadSchema = z.object({
  orderId: idSchema,
  adjustment: adjustmentSchema,
  decision: adjustmentDecisionSchema,
});
export type OrderAdjustmentDecidedPayload = z.infer<
  typeof orderAdjustmentDecidedPayloadSchema
>;

export const orderReadyForReturnPayloadSchema = z.object({
  orderId: idSchema,
  readyAt: instantSchema,
  obligation: obligationSchema,
});
export type OrderReadyForReturnPayload = z.infer<
  typeof orderReadyForReturnPayloadSchema
>;

export const orderDeliveredPayloadSchema = z.object({
  orderId: idSchema,
  deliveredAt: instantSchema,
  legAttempt: legAttemptSchema,
});
export type OrderDeliveredPayload = z.infer<typeof orderDeliveredPayloadSchema>;

export const paymentSettledPayloadSchema = z.object({
  obligation: obligationSchema,
  receipt: receiptSchema,
});
export type PaymentSettledPayload = z.infer<typeof paymentSettledPayloadSchema>;

export const refundUpdatedPayloadSchema = z.object({
  refund: refundSchema,
});
export type RefundUpdatedPayload = z.infer<typeof refundUpdatedPayloadSchema>;

export const deliveryUpdatedPayloadSchema = z.object({
  legAttempt: legAttemptSchema,
});
export type DeliveryUpdatedPayload = z.infer<typeof deliveryUpdatedPayloadSchema>;

export const mediaUploadedPayloadSchema = z.object({
  media: mediaReferenceSchema,
});
export type MediaUploadedPayload = z.infer<typeof mediaUploadedPayloadSchema>;

export const conversationDraftConfirmedPayloadSchema = z.object({
  confirmation: draftConfirmationSchema,
  confirmedAt: instantSchema,
});
export type ConversationDraftConfirmedPayload = z.infer<
  typeof conversationDraftConfirmedPayloadSchema
>;

export const eventConsumersSchema = z.record(
  eventTypeSchema,
  z.array(z.string().trim().min(1)),
);
export type EventConsumers = z.infer<typeof eventConsumersSchema>;

export const EVENT_CONSUMERS: EventConsumers = {
  "order.confirmed.v2": ["billing", "logistics", "notifications", "jobs"],
  "order.intake-recorded.v2": ["pricing", "billing", "notifications"],
  "order.adjustment-decided.v2": ["billing", "orders", "notifications"],
  "order.ready-for-return.v2": ["logistics", "billing", "notifications"],
  "order.delivered.v2": ["billing", "reviews", "notifications"],
  "payment.settled.v2": ["orders", "notifications", "jobs"],
  "refund.updated.v2": ["billing", "support", "notifications"],
  "delivery.updated.v2": ["orders", "tracking", "notifications"],
  "media.uploaded.v2": ["support", "orders", "media"],
  "conversation.draft-confirmed.v2": ["orders", "conversations", "notifications"],
};
