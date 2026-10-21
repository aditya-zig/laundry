import { z } from "zod";
import {
  addressSchema,
  cancelOrderSchema,
  checkoutSchema,
  conversationMessageResultSchema,
  conversationMessageSchema,
  demoAuthSchema,
  demoHandoverCodesSchema,
  deliveryJobSchema,
  draftConfirmSchema,
  errorEnvelopeSchema,
  handoverInputSchema,
  otpRequestSchema,
  otpVerifySchema,
  orderSchema,
  pilotActionSchema,
  pilotBookingSchema,
  pilotConfigSchema,
  pilotLocationReportSchema,
  pilotLocationSchema,
  pilotOrderSchema,
  pilotRiderSchema,
  pilotSlotSchema,
  quoteInputSchema,
  quoteSchema,
  reviewInputSchema,
  reviewSchema,
  serviceSchema,
  sessionSchema,
  type Address,
  type Checkout,
  type ConversationMessageResult,
  type DeliveryJob,
  type ErrorEnvelope,
  type HandoverInput,
  type Order,
  type PilotAction,
  type PilotBooking,
  type PilotConfig,
  type PilotLocation,
  type PilotLocationReport,
  type PilotOrder,
  type PilotRider,
  type PilotSlot,
  type Quote,
  type QuoteInput,
  type Review,
  type ReviewInput,
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

/** Per-call overrides for mutating requests. Pass the same
 * `idempotencyKey` when retrying a timed-out request so the server
 * replays the original result instead of creating a second resource.
 * All fields are optional; omitting them keeps the previous behavior. */
export interface MutatingOpts {
  idempotencyKey?: string;
}

export interface CheckoutOpts extends MutatingOpts {
  expectedVersion?: number;
}

export interface DispatchOpts extends MutatingOpts {
  assignedTo?: string;
  expectedVersion?: number;
}

export interface RefundOpts extends MutatingOpts {
  obligationId?: string;
}

export interface IntakeOpts extends MutatingOpts {
  bagIds?: string[];
}

export type CareTarget = "IN_CARE" | "QUALITY_CHECK" | "READY_FOR_RETURN";

const DEFAULT_BASE = "http://localhost:4100/v1";

export function createClient(options: ClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const generateKey = options.generateKey ?? (() => crypto.randomUUID());

  async function request<T>(method: string, path: string, opts: {
    body?: unknown;
    schema: z.ZodType<T>;
    idempotent?: boolean;
    idempotencyKey?: string;
  }): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = options.getToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opts.idempotent ?? ["POST", "PATCH", "PUT", "DELETE"].includes(method)) {
      headers["Idempotency-Key"] = opts.idempotencyKey ?? generateKey();
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
  const post = <T>(path: string, body: unknown, schema: z.ZodType<T>, opts?: MutatingOpts) =>
    request("POST", path, { body, schema, idempotencyKey: opts?.idempotencyKey });
  const put = <T>(path: string, body: unknown, schema: z.ZodType<T>, opts?: MutatingOpts) =>
    request("PUT", path, { body, schema, idempotencyKey: opts?.idempotencyKey });

  return {
    listServices: () => get("/services", z.array(serviceSchema)) as Promise<Service[]>,
    requestOtp: (phone: string, opts?: MutatingOpts) =>
      post("/auth/otp/request", otpRequestSchema.parse({ phone }), z.object({ challengeId: z.string(), demoCode: z.string().optional() }), opts),
    verifyOtp: (challengeId: string, code: string, opts?: MutatingOpts) =>
      post("/auth/otp/verify", otpVerifySchema.parse({ challengeId, code }), sessionSchema, opts) as Promise<Session>,
    demoAuth: (role: "customer" | "rider" | "operator", opts?: MutatingOpts) =>
      post("/auth/demo", demoAuthSchema.parse({ role }), sessionSchema, opts) as Promise<Session>,
    getMe: () =>
      get(
        "/me",
        z.object({ id: z.string(), role: z.string(), name: z.string(), phone: z.string() })
      ) as Promise<Session["user"]>,
    listAddresses: () => get("/addresses", z.array(addressSchema)) as Promise<Address[]>,
    createAddress: (input: Omit<Address, "id" | "version" | "ownerId">, opts?: MutatingOpts) =>
      post("/addresses", input, addressSchema, opts) as Promise<Address>,
    createQuote: (input: QuoteInput, opts?: MutatingOpts) =>
      post("/quotes", quoteInputSchema.parse(input), quoteSchema, opts) as Promise<Quote>,
    createCheckout: (quoteId: string, opts?: CheckoutOpts) =>
      post(
        "/checkouts",
        opts?.expectedVersion === undefined ? { quoteId } : { quoteId, expectedVersion: opts.expectedVersion },
        checkoutSchema,
        opts,
      ) as Promise<Checkout>,
    listOrders: () => get("/orders", z.array(orderSchema)) as Promise<Order[]>,
    getOrder: (id: string) => get(`/orders/${id}`, orderSchema) as Promise<Order>,
    getDemoHandoverCodes: (id: string) => get(`/orders/${id}/handover-code`, demoHandoverCodesSchema),
    cancelOrder: (id: string, reason: string, expectedVersion: number, opts?: MutatingOpts) =>
      post(`/orders/${id}/cancel`, cancelOrderSchema.parse({ reason, expectedVersion }), orderSchema, opts) as Promise<Order>,
    captureDemoPayment: (paymentId: string, opts?: MutatingOpts) =>
      post(`/demo/payments/${paymentId}/capture`, {}, orderSchema, opts) as Promise<Order>,
    createReview: (input: ReviewInput, opts?: MutatingOpts) =>
      post("/reviews", reviewInputSchema.parse(input), reviewSchema, opts) as Promise<Review>,
    listServiceReviews: (serviceId: string) =>
      get(`/services/${serviceId}/reviews`, z.array(reviewSchema)) as Promise<Review[]>,
    checkServiceArea: () =>
      get(
        "/service-areas/check",
        z.object({ serviceable: z.boolean(), areaId: z.string(), hours: z.string() }),
      ) as Promise<{ serviceable: boolean; areaId: string; hours: string }>,
    listPartnerJobs: () => get("/partner/jobs", z.array(deliveryJobSchema)) as Promise<DeliveryJob[]>,
    acceptJob: (id: string, opts?: MutatingOpts) => post(`/partner/jobs/${id}/accept`, {}, deliveryJobSchema, opts) as Promise<DeliveryJob>,
    handoverJob: (
      id: string,
      input: Omit<HandoverInput, "jobId"> & { expectedVersion: number },
      opts?: MutatingOpts,
    ) => {
      const { expectedVersion, ...handover } = input;
      const body = { ...handoverInputSchema.parse({ ...handover, jobId: id }), expectedVersion };
      return post(`/partner/jobs/${id}/handover`, body, deliveryJobSchema, opts) as Promise<DeliveryJob>;
    },
    reportJobException: (id: string, reason: string, opts?: MutatingOpts) =>
      post(`/partner/jobs/${id}/exception`, { reason }, deliveryJobSchema, opts) as Promise<DeliveryJob>,
    listOpsOrders: () => get("/ops/orders", z.array(orderSchema)) as Promise<Order[]>,
    recordIntake: (id: string, expectedVersion: number, measuredLines: unknown[], opts?: IntakeOpts) =>
      post(
        `/ops/orders/${id}/intake`,
        opts?.bagIds === undefined
          ? { expectedVersion, measuredLines }
          : { expectedVersion, measuredLines, bagIds: opts.bagIds },
        orderSchema,
        opts,
      ) as Promise<Order>,
    advanceCare: (id: string, expectedVersion: number, to: CareTarget, opts?: MutatingOpts) =>
      post(`/ops/orders/${id}/care`, { expectedVersion, to }, orderSchema, opts) as Promise<Order>,
    listOpsDeliveries: () => get("/ops/deliveries", z.array(deliveryJobSchema)) as Promise<DeliveryJob[]>,
    dispatchDelivery: (id: string, opts?: DispatchOpts) => post(`/ops/deliveries/${id}/dispatch`, {
      ...(opts?.assignedTo ? { assignedTo: opts.assignedTo } : {}),
      ...(opts?.expectedVersion !== undefined ? { expectedVersion: opts.expectedVersion } : {}),
    }, deliveryJobSchema, opts) as Promise<DeliveryJob>,
    createRefund: (orderId: string, paymentId: string, amountMinor: number, reason: string, opts?: RefundOpts) =>
      post(
        "/ops/refunds",
        opts?.obligationId === undefined
          ? { orderId, paymentId, amountMinor, reason }
          : { orderId, paymentId, amountMinor, reason, obligationId: opts.obligationId },
        z.record(z.unknown()),
        opts,
      ) as Promise<unknown>,
    postConversationMessage: (text: string, opts: { receivedAt?: string; draftId?: string; idempotencyKey?: string } = {}) =>
      post(
        "/demo/conversations/messages",
        conversationMessageSchema.parse({ text, receivedAt: opts.receivedAt, draftId: opts.draftId }),
        conversationMessageResultSchema,
        opts.idempotencyKey === undefined ? undefined : { idempotencyKey: opts.idempotencyKey },
      ) as Promise<ConversationMessageResult & { quote?: Quote }>,
    confirmDraft: (draftId: string, revision: number, quoteId: string, opts?: MutatingOpts) =>
      post(`/conversation-drafts/${draftId}/confirm`, draftConfirmSchema.parse({ draftId, revision, quoteId }), checkoutSchema, opts) as Promise<Checkout>,

    /* Pilot surface: a kg-based laundry order from booking through pickup,
     * intake approval, care, payment at return and handover. */

    pilotConfig: () => get("/pilot/config", pilotConfigSchema) as Promise<PilotConfig>,
    pilotRiders: () => get("/pilot/riders", z.array(pilotRiderSchema)) as Promise<PilotRider[]>,
    pilotListOrders: () => get("/pilot/orders", z.array(pilotOrderSchema)) as Promise<PilotOrder[]>,
    pilotOrder: (id: string) => get(`/pilot/orders/${id}`, pilotOrderSchema) as Promise<PilotOrder>,
    pilotCreateOrder: (input: PilotBooking, opts?: MutatingOpts) =>
      post("/pilot/orders", pilotBookingSchema.parse(input), pilotOrderSchema, opts) as Promise<PilotOrder>,
    pilotAction: (id: string, action: PilotAction, opts?: MutatingOpts) =>
      post(`/pilot/orders/${id}/actions`, pilotActionSchema.parse(action), pilotOrderSchema, opts) as Promise<PilotOrder>,
    pilotSetSlotCapacity: (slotId: string, capacity: number, opts?: MutatingOpts) =>
      put(`/pilot/slots/${slotId}`, { capacity }, pilotSlotSchema, opts) as Promise<PilotSlot>,
    /** The latest position the assigned delivery partner reported, with the
     * capture time, the source and the server-measured age. */
    pilotLocation: (id: string) => get(`/pilot/orders/${id}/location`, pilotLocationSchema) as Promise<PilotLocation>,
    pilotReportLocation: (id: string, report: PilotLocationReport, opts?: MutatingOpts) =>
      post(`/pilot/orders/${id}/location`, pilotLocationReportSchema.parse(report), pilotLocationSchema, opts) as Promise<PilotLocation>,
  };
}

export type WandaryClient = ReturnType<typeof createClient>;
