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
  payload: z.record(z.string(), z.unknown()),
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
}).refine(value => value.legAttempt.leg === "RETURN" && value.legAttempt.status === "COMPLETED" && value.legAttempt.orderId === value.orderId, {
  path: ["legAttempt"], message: "Order delivery requires a completed return attempt for the same order.",
});
export type OrderDeliveredPayload = z.infer<typeof orderDeliveredPayloadSchema>;

export const paymentSettledPayloadSchema = z.object({
  obligation: obligationSchema,
  receipt: receiptSchema,
}).refine(value => value.obligation.status === "SETTLED" && value.receipt.obligationId === value.obligation.id, {
  message: "Settlement requires a settled obligation and its own receipt. A void resolution is not a payment.",
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

export const EVENT_PAYLOAD_SCHEMAS = {
  "order.confirmed.v2": orderConfirmedPayloadSchema,
  "order.intake-recorded.v2": orderIntakeRecordedPayloadSchema,
  "order.adjustment-decided.v2": orderAdjustmentDecidedPayloadSchema,
  "order.ready-for-return.v2": orderReadyForReturnPayloadSchema,
  "order.delivered.v2": orderDeliveredPayloadSchema,
  "payment.settled.v2": paymentSettledPayloadSchema,
  "refund.updated.v2": refundUpdatedPayloadSchema,
  "delivery.updated.v2": deliveryUpdatedPayloadSchema,
  "media.uploaded.v2": mediaUploadedPayloadSchema,
  "conversation.draft-confirmed.v2": conversationDraftConfirmedPayloadSchema,
} satisfies Record<EventType, z.ZodTypeAny>;

export const domainEventSchema = z.discriminatedUnion("eventType", [
  eventEnvelopeSchema.extend({ eventType: z.literal("order.confirmed.v2"), payload: orderConfirmedPayloadSchema }),
  eventEnvelopeSchema.extend({ eventType: z.literal("order.intake-recorded.v2"), payload: orderIntakeRecordedPayloadSchema }),
  eventEnvelopeSchema.extend({ eventType: z.literal("order.adjustment-decided.v2"), payload: orderAdjustmentDecidedPayloadSchema }),
  eventEnvelopeSchema.extend({ eventType: z.literal("order.ready-for-return.v2"), payload: orderReadyForReturnPayloadSchema }),
  eventEnvelopeSchema.extend({ eventType: z.literal("order.delivered.v2"), payload: orderDeliveredPayloadSchema }),
  eventEnvelopeSchema.extend({ eventType: z.literal("payment.settled.v2"), payload: paymentSettledPayloadSchema }),
  eventEnvelopeSchema.extend({ eventType: z.literal("refund.updated.v2"), payload: refundUpdatedPayloadSchema }),
  eventEnvelopeSchema.extend({ eventType: z.literal("delivery.updated.v2"), payload: deliveryUpdatedPayloadSchema }),
  eventEnvelopeSchema.extend({ eventType: z.literal("media.uploaded.v2"), payload: mediaUploadedPayloadSchema }),
  eventEnvelopeSchema.extend({ eventType: z.literal("conversation.draft-confirmed.v2"), payload: conversationDraftConfirmedPayloadSchema }),
]).superRefine((event, ctx) => {
  let payloadAggregateId: string;
  switch (event.eventType) {
    case "order.confirmed.v2": payloadAggregateId = event.payload.order.id; break;
    case "order.intake-recorded.v2":
    case "order.adjustment-decided.v2":
    case "order.ready-for-return.v2":
    case "order.delivered.v2": payloadAggregateId = event.payload.orderId; break;
    case "payment.settled.v2": payloadAggregateId = event.payload.obligation.id; break;
    case "refund.updated.v2": payloadAggregateId = event.payload.refund.id; break;
    case "delivery.updated.v2": payloadAggregateId = event.payload.legAttempt.id; break;
    case "media.uploaded.v2": payloadAggregateId = event.payload.media.id; break;
    case "conversation.draft-confirmed.v2": payloadAggregateId = event.payload.confirmation.draftId; break;
  }
  if (event.aggregateId !== payloadAggregateId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["aggregateId"], message: "Envelope and payload aggregate IDs must agree." });
});
export type DomainEvent = z.infer<typeof domainEventSchema>;

export const eventConsumersSchema = z.partialRecord(
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
