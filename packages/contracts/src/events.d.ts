export declare const SCHEMA_VERSION = 1;
export interface DomainEvent<TPayload = unknown> {
    eventId: string;
    eventType: DomainEventType;
    schemaVersion: 1;
    aggregateId: string;
    aggregateVersion: number;
    occurredAt: string;
    traceId: string;
    payload: TPayload;
}
export type DomainEventType = "payment.captured.v1" | "refund.updated.v1" | "order.confirmed.v1" | "order.ready-for-return.v1" | "delivery.updated.v1" | "order.updated.v1" | "order.delivered.v1";
export interface PaymentCapturedPayload {
    paymentId: string;
    orderId: string;
    quoteId: string;
    purpose: "INITIAL" | "TOP_UP";
    amount: {
        amountMinor: number;
        currency: "INR";
    };
}
export interface RefundUpdatedPayload {
    refundId: string;
    obligationId: string;
    orderId: string;
    status: string;
    amount: {
        amountMinor: number;
        currency: "INR";
    };
}
export interface OrderConfirmedPayload {
    orderId: string;
    orderVersion: number;
}
export interface OrderReadyForReturnPayload {
    orderId: string;
    orderVersion: number;
    bagIds: string[];
}
export interface DeliveryUpdatedPayload {
    jobId: string;
    orderId: string;
    leg: "PICKUP" | "RETURN";
    attemptId: string;
    status: string;
    proofReference?: string;
    providerOccurredAt?: string;
}
export interface OrderUpdatedPayload {
    orderId: string;
    orderVersion: number;
    customerVisibleStatus: string;
    reasonCode?: string;
}
export interface OrderDeliveredPayload {
    orderId: string;
    customerId: string;
    deliveredAt: string;
}
export declare function makeEnvelope<T>(eventType: DomainEventType, aggregateId: string, aggregateVersion: number, payload: T, traceId: string): DomainEvent<T>;
//# sourceMappingURL=events.d.ts.map