import { z } from "zod";
import {
  addressSchema,
  cancelOrderSchema,
  checkoutSchema,
  conversationMessageSchema,
  demoAuthSchema,
  deliveryJobSchema,
  draftConfirmSchema,
  errorEnvelopeSchema,
  handoverInputSchema,
  otpRequestSchema,
  otpVerifySchema,
  orderSchema,
  quoteInputSchema,
  quoteSchema,
  reviewInputSchema,
  serviceSchema,
  sessionSchema,
  type Address,
  type Checkout,
  type ConversationMessageResult,
  type DeliveryJob,
  type ErrorEnvelope,
  type Order,
  type Quote,
  type QuoteInput,
  type Service,
  type Session,
} from "@wandary/contracts";

export class ApiError extends Error {
  readonly code: ErrorEnvelope["code"];
  readonly traceId: string;
  readonly retryable: boolean;
  readonly status: number;
  constructor(status: number, envelope: ErrorEnvelope) {
    super(`${envelope.code}: ${envelope.message}`);
    this.name = "ApiError";
    this.code = envelope.code;
    this.traceId = envelope.traceId;
    this.retryable = envelope.retryable;
    this.status = status;
  }
}

export interface ClientOptions {
  baseUrl?: string;
  getToken?: () => string | undefined;
  fetchImpl?: typeof fetch;
  generateKey?: () => string;
}

const DEFAULT_BASE = "http://localhost:4100/v1";

export function createClient(options: ClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const generateKey = options.generateKey ?? (() => crypto.randomUUID());

  async function request<T>(method: string, path: string, opts: {
    body?: unknown;
    schema: z.ZodType<T>;
    idempotent?: boolean;
  }): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = options.getToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opts.idempotent ?? ["POST", "PATCH", "PUT", "DELETE"].includes(method)) {
      headers["Idempotency-Key"] = generateKey();
    }
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const parsed = errorEnvelopeSchema.safeParse(json);
      if (parsed.success) throw new ApiError(res.status, parsed.data);
      throw new ApiError(res.status, {
        code: "PROVIDER_OUTCOME_UNKNOWN",
        message: `Request failed with status ${res.status}`,
        traceId: "trace-unknown",
        retryable: res.status >= 500,
      });
    }
    return opts.schema.parse(json);
  }

  const get = <T>(path: string, schema: z.ZodType<T>) => request("GET", path, { schema, idempotent: false });
  const post = <T>(path: string, body: unknown, schema: z.ZodType<T>) => request("POST", path, { body, schema });

  return {
    listServices: () => get("/services", z.array(serviceSchema)) as Promise<Service[]>,
    requestOtp: (phone: string) =>
      post("/auth/otp/request", otpRequestSchema.parse({ phone }), z.object({ challengeId: z.string(), demoCode: z.string().optional() })),
    verifyOtp: (challengeId: string, code: string) =>
      post("/auth/otp/verify", otpVerifySchema.parse({ challengeId, code }), sessionSchema) as Promise<Session>,
    demoAuth: (role: "customer" | "rider" | "operator") =>
      post("/auth/demo", demoAuthSchema.parse({ role }), sessionSchema) as Promise<Session>,
    getMe: () =>
      get(
        "/me",
        z.object({ id: z.string(), role: z.string(), name: z.string(), phone: z.string() })
      ) as Promise<Session["user"]>,
    listAddresses: () => get("/addresses", z.array(addressSchema)) as Promise<Address[]>,
    createAddress: (input: Omit<Address, "id" | "version" | "ownerId">) =>
      post("/addresses", input, addressSchema) as Promise<Address>,
    createQuote: (input: QuoteInput) =>
      post("/quotes", quoteInputSchema.parse(input), quoteSchema) as Promise<Quote>,
    createCheckout: (quoteId: string) =>
      post("/checkouts", { quoteId }, checkoutSchema) as Promise<Checkout>,
    listOrders: () => get("/orders", z.array(orderSchema)) as Promise<Order[]>,
    getOrder: (id: string) => get(`/orders/${id}`, orderSchema) as Promise<Order>,
    cancelOrder: (id: string, reason: string, expectedVersion: number) =>
      post(`/orders/${id}/cancel`, cancelOrderSchema.parse({ reason, expectedVersion }), orderSchema) as Promise<Order>,
    captureDemoPayment: (paymentId: string) =>
      post(`/demo/payments/${paymentId}/capture`, {}, orderSchema) as Promise<Order>,
    createReview: (input: Parameters<typeof reviewInputSchema.parse>[0]) =>
      post("/reviews", reviewInputSchema.parse(input), reviewInputSchema.extend({ id: z.string(), version: z.number(), createdAt: z.string() })),
    listServiceReviews: (serviceId: string) =>
      get(`/services/${serviceId}/reviews`, z.array(z.record(z.unknown()))) as Promise<unknown[]>,
    listPartnerJobs: () => get("/partner/jobs", z.array(deliveryJobSchema)) as Promise<DeliveryJob[]>,
    acceptJob: (id: string) => post(`/partner/jobs/${id}/accept`, {}, deliveryJobSchema) as Promise<DeliveryJob>,
    handoverJob: (id: string, input: Omit<Parameters<typeof handoverInputSchema.parse>[0], "jobId"> & { expectedVersion: number }) =>
      post(`/partner/jobs/${id}/handover`, handoverInputSchema.parse({ ...input, jobId: id }), deliveryJobSchema) as Promise<DeliveryJob>,
    reportJobException: (id: string, reason: string) =>
      post(`/partner/jobs/${id}/exception`, { reason }, deliveryJobSchema) as Promise<DeliveryJob>,
    listOpsOrders: () => get("/ops/orders", z.array(orderSchema)) as Promise<Order[]>,
    recordIntake: (id: string, expectedVersion: number, measuredLines: unknown[]) =>
      post(`/ops/orders/${id}/intake`, { expectedVersion, measuredLines }, orderSchema) as Promise<Order>,
    advanceCare: (id: string, expectedVersion: number, to: string) =>
      post(`/ops/orders/${id}/care`, { expectedVersion, to }, orderSchema) as Promise<Order>,
    listOpsDeliveries: () => get("/ops/deliveries", z.array(deliveryJobSchema)) as Promise<DeliveryJob[]>,
    dispatchDelivery: (id: string) => post(`/ops/deliveries/${id}/dispatch`, {}, deliveryJobSchema) as Promise<DeliveryJob>,
    createRefund: (orderId: string, paymentId: string, amountMinor: number, reason: string) =>
      post("/ops/refunds", { orderId, paymentId, amountMinor, reason }, z.record(z.unknown())) as Promise<unknown>,
    postConversationMessage: (text: string, opts: { receivedAt?: string; draftId?: string } = {}) =>
      post(
        "/demo/conversations/messages",
        conversationMessageSchema.parse({ text, ...opts }),
        z.object({ draft: z.record(z.unknown()), reply: z.string(), missingFields: z.array(z.string()) })
      ) as unknown as Promise<ConversationMessageResult>,
    confirmDraft: (draftId: string, revision: number, quoteId: string) =>
      post(`/conversation-drafts/${draftId}/confirm`, draftConfirmSchema.parse({ draftId, revision, quoteId }), checkoutSchema) as Promise<Checkout>,
  };
}

export type WandaryClient = ReturnType<typeof createClient>;
