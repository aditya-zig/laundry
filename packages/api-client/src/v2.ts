import { z } from "zod";
import { v2 } from "@laundry/contracts";

export interface V2ClientOptions {
  baseUrl?: string;
  getToken?: () => string | undefined;
  fetchImpl?: typeof fetch;
  generateKey?: () => string;
}

export interface V2MutatingOpts {
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export class UnknownOutcomeError extends Error {
  readonly code = "PROVIDER_OUTCOME_UNKNOWN" as const;
  readonly outcome = "UNKNOWN" as const;
  override readonly cause: unknown;

constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "UnknownOutcomeError";
    this.cause = cause;
  }
}

export class V2ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly traceId: string;
  readonly retryable: boolean;
  readonly fieldErrors: unknown;
  readonly currentVersion: number | undefined;

constructor(
    status: number,
    envelope: {
      code: string;
      message: string;
      traceId: string;
      retryable: boolean;
      fieldErrors?: unknown;
      currentVersion?: number;
    },
  ) {
    super(`${envelope.code}: ${envelope.message}`);
    this.name = "V2ApiError";
    this.status = status;
    this.code = envelope.code;
    this.traceId = envelope.traceId;
    this.retryable = envelope.retryable;
    this.fieldErrors = envelope.fieldErrors;
    this.currentVersion = envelope.currentVersion;
  }
}

const DEFAULT_BASE = "http://localhost:4100/v2";
const emptyObjectSchema = z.object({}).passthrough();
const unknownResponseSchema = z.unknown();
const stringResponseSchema = z.string();
const stringArraySchema = z.array(z.string());
const objectArraySchema = z.array(emptyObjectSchema);
const booleanResponseSchema = z.boolean();

type Schema<T> = z.ZodType<T>;
type Query = Record<string, string | number | boolean | undefined>;
type Input = Record<string, unknown>;

function queryString(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const result = params.toString();
  return result ? `?${result}` : "";
}

function encodeId(id: string): string {
  return encodeURIComponent(id);
}

export function createV2Client(options: V2ClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const generateKey = options.generateKey ?? (() => crypto.randomUUID());

async function request<T>(
    method: string,
    path: string,
    schema: Schema<T>,
    body?: unknown,
    opts: V2MutatingOpts = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

if (body !== undefined) headers["Content-Type"] = "application/json";

const token = options.getToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;

if (method !== "GET") {
      const key = opts.idempotencyKey;
      if (!key && !generateKey) {
        throw new Error("An idempotency key is required");
      }
      headers["Idempotency-Key"] = key ?? generateKey();
    }

let response: Response;

try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: opts.signal,
      });
    } catch (error) {
      throw new UnknownOutcomeError(
        "The request outcome is unknown. Retry only with the same idempotency key.",
        error,
      );
    }

const payload: unknown = await response.json().catch(() => null);

if (!response.ok) {
      const parsed = v2.errorEnvelopeSchema.safeParse(payload);

if (parsed.success) {
        const envelope = parsed.data;
        if (response.status >= 500 && envelope.retryable) {
          throw new V2ApiError(response.status, {
            code: String(envelope.code),
            message: envelope.message,
            traceId: envelope.traceId,
            retryable: envelope.retryable,
            fieldErrors: "fieldErrors" in envelope ? envelope.fieldErrors : undefined,
            currentVersion: "currentVersion" in envelope &&
              typeof envelope.currentVersion === "number"
              ? envelope.currentVersion
              : undefined,
          });
        }

throw new V2ApiError(response.status, {
          code: String(envelope.code),
          message: envelope.message,
          traceId: envelope.traceId,
          retryable: envelope.retryable,
          fieldErrors: "fieldErrors" in envelope ? envelope.fieldErrors : undefined,
          currentVersion: "currentVersion" in envelope &&
            typeof envelope.currentVersion === "number"
            ? envelope.currentVersion
            : undefined,
        });
      }

if (response.status >= 500) {
        throw new UnknownOutcomeError(
          `The server returned HTTP ${response.status}; the request outcome is unknown.`,
        );
      }

throw new V2ApiError(response.status, {
        code: "UNKNOWN_ERROR",
        message: `Request failed with HTTP ${response.status}`,
        traceId: "trace-unknown",
        retryable: false,
      });
    }

return schema.parse(payload);
  }

function get<T>(path: string, schema: Schema<T>): Promise<T> {
    return request("GET", path, schema);
  }

function post<T>(
    path: string,
    body: unknown,
    schema: Schema<T>,
    opts?: V2MutatingOpts,
  ): Promise<T> {
    return request("POST", path, schema, body, opts);
  }

function patch<T>(
    path: string,
    body: unknown,
    schema: Schema<T>,
    opts?: V2MutatingOpts,
  ): Promise<T> {
    return request("PATCH", path, schema, body, opts);
  }

function put<T>(
    path: string,
    body: unknown,
    schema: Schema<T>,
    opts?: V2MutatingOpts,
  ): Promise<T> {
    return request("PUT", path, schema, body, opts);
  }

function del<T>(
    path: string,
    schema: Schema<T>,
    opts?: V2MutatingOpts,
  ): Promise<T> {
    return request("DELETE", path, schema, undefined, opts);
  }

const order = v2.orderSchema;
  const quote = v2.quoteSchema;
  const service = v2.serviceSchema;
  const obligation = v2.obligationSchema;
  const receipt = v2.receiptSchema;
  const refund = v2.refundSchema;
  const riderJob = v2.riderJobSchema;
  const tracking = v2.customerTrackingSchema;
  const incident = v2.incidentSchema;
  const review = v2.reviewSchema;
  const addressSchema = emptyObjectSchema;
  const sessionSchema = emptyObjectSchema;
  const otpRequestSchema = emptyObjectSchema;
  const uploadIntentResult = v2.uploadIntentResultSchema;
  const mediaDownload = v2.mediaDownloadSchema;
  const custodyReceipt = v2.custodyReceiptSchema;
  const timeline = z.array(v2.orderTimelineEventSchema);
  const serviceList = z.array(service);
  const orderList = z.array(order);
  const obligationList = z.array(obligation);
  const receiptList = z.array(receipt);
  const refundList = z.array(refund);
  const incidentList = z.array(incident);
  const reviewList = z.array(v2.publicReviewSchema);
  const jobList = z.array(riderJob);
  const genericObject = emptyObjectSchema;

return {
    requestOtp: (phone: string, opts?: V2MutatingOpts) =>
      post("/identity/otp", { phone }, otpRequestSchema, opts),

verifyOtp: (challengeId: string, code: string, opts?: V2MutatingOpts) =>
      post("/identity/otp/verify", { challengeId, code }, sessionSchema, opts),

refreshSession: (opts?: V2MutatingOpts) =>
      post("/identity/session/refresh", {}, sessionSchema, opts),

logout: (opts?: V2MutatingOpts) =>
      post("/identity/session/logout", {}, genericObject, opts),

me: () => get("/identity/me", genericObject),

listAddresses: () => get("/identity/addresses", z.array(addressSchema)),

createAddress: (input: Input, opts?: V2MutatingOpts) =>
      post("/identity/addresses", input, addressSchema, opts),

updateAddress: (
      id: string,
      input: Input,
      expectedVersion: number,
      opts?: V2MutatingOpts,
    ) =>
      patch(`/identity/addresses/${encodeId(id)}`, {
        ...input,
        expectedVersion,
      }, addressSchema, opts),

deleteAddress: (id: string, opts?: V2MutatingOpts) =>
      del(`/identity/addresses/${encodeId(id)}`, genericObject, opts),

listServices: () => get("/catalog/services", serviceList),

getService: (id: string) =>
      get(`/catalog/services/${encodeId(id)}`, service),

checkServiceArea: () =>
      get("/availability/area", genericObject),

listSlots: (input: Query) =>
      get(`/availability/slots${queryString(input)}`, genericObject),

createQuote: (input: v2.QuoteInput, opts?: V2MutatingOpts) =>
      post("/orders/quote", v2.quoteInputSchema.parse(input), quote, opts),

bookOrder: (input: v2.BookingInput, opts?: V2MutatingOpts) =>
      post("/orders", v2.bookingInputSchema.parse(input), order, opts),

listOrders: (query?: Query) =>
      get(`/orders${queryString(query)}`, orderList),

getOrder: (id: string) =>
      get(`/orders/${encodeId(id)}`, order),

getOrderTimeline: (id: string) =>
      get(`/orders/${encodeId(id)}/timeline`, timeline),

cancelOrder: (
      id: string,
      reason: string,
      expectedVersion: number,
      opts?: V2MutatingOpts,
    ) =>
      post(`/orders/${encodeId(id)}/cancel`, {
        reason,
        expectedVersion,
      }, order, opts),

rescheduleOrder: (
      id: string,
      window: v2.ScheduleWindow,
      expectedVersion: number,
      opts?: V2MutatingOpts,
    ) =>
      post(`/orders/${encodeId(id)}/reschedule`, {
        window,
        expectedVersion,
      }, order, opts),

decideAdjustment: (
      id: string,
      adjustmentId: string,
      adjustmentVersion: number,
      decision: v2.AdjustmentDecision,
      opts?: V2MutatingOpts,
    ) =>
      post(`/orders/${encodeId(id)}/adjustment-decision`, {
        adjustmentId,
        adjustmentVersion,
        decision,
      }, order, opts),

getCustodyReceipt: (id: string) =>
      get(`/orders/${encodeId(id)}/custody-receipt`, custodyReceipt),

listObligations: (query?: Query) =>
      get(`/billing/obligations${queryString(query)}`, obligationList),

getObligation: (id: string) =>
      get(`/billing/obligations/${encodeId(id)}`, obligation),

listReceipts: (obligationId: string) =>
      get(`/billing/obligations/${encodeId(obligationId)}/receipts`, receiptList),

listRefunds: (query?: Query) =>
      get(`/billing/refunds${queryString(query)}`, refundList),

getTracking: (orderId: string) =>
      get(`/logistics/tracking/${encodeId(orderId)}`, tracking),

createUploadIntent: (input: v2.UploadIntent, opts?: V2MutatingOpts) =>
      post("/media/upload-intents", v2.uploadIntentSchema.parse(input), uploadIntentResult, opts),

finalizeUpload: (uploadId: string, opts?: V2MutatingOpts) =>
      post(`/media/uploads/${encodeId(uploadId)}/finalize`, {}, genericObject, opts),

getDownloadUrl: (mediaId: string) =>
      get(`/media/${encodeId(mediaId)}/download`, mediaDownload),

listIncidents: () =>
      get("/incidents", incidentList),

createIncident: (input: Input, opts?: V2MutatingOpts) =>
      post("/incidents", input, incident, opts),

listIncidentMessages: (incidentId: string) =>
      get(`/incidents/${encodeId(incidentId)}/messages`, z.array(v2.incidentMessageSchema)),

postIncidentMessage: (
      incidentId: string,
      input: Input,
      opts?: V2MutatingOpts,
    ) =>
      post(`/incidents/${encodeId(incidentId)}/messages`, input, v2.incidentMessageSchema, opts),

requestRewash: (
      incidentId: string,
      input: Input,
      opts?: V2MutatingOpts,
    ) =>
      post(`/incidents/${encodeId(incidentId)}/rewash`, input, v2.rewashRequestSchema, opts),

createReview: (input: v2.Review, opts?: V2MutatingOpts) =>
      post("/reviews", v2.reviewSchema.parse(input), review, opts),

getReviewEligibility: (orderId: string) =>
      get(`/reviews/eligibility/${encodeId(orderId)}`, v2.reviewEligibilitySchema),

listPublicReviews: (serviceId: string, query?: Query) =>
      get(`/reviews/services/${encodeId(serviceId)}${queryString(query)}`, reviewList),

listJobs: () =>
      get("/rider/jobs", jobList),

getJob: (id: string) =>
      get(`/rider/jobs/${encodeId(id)}`, riderJob),

acceptJob: (id: string, opts?: V2MutatingOpts) =>
      post(`/rider/jobs/${encodeId(id)}/accept`, {}, riderJob, opts),

recordHandover: (
      jobId: string,
      input: Input,
      opts?: V2MutatingOpts,
    ) =>
      post(`/rider/jobs/${encodeId(jobId)}/handover`, input, v2.handoverResultSchema, opts),

reportJobException: (
      id: string,
      input: Input,
      opts?: V2MutatingOpts,
    ) =>
      post(`/rider/jobs/${encodeId(id)}/exception`, input, riderJob, opts),

reportLocation: (
      id: string,
      input: Input,
      opts?: V2MutatingOpts,
    ) =>
      post(`/rider/jobs/${encodeId(id)}/location`, input, v2.locationReportSchema, opts),

listOpsOrders: (query?: Query) =>
      get(`/ops/orders${queryString(query)}`, orderList),

recordIntake: (
      id: string,
      input: Input,
      expectedVersion: number,
      opts?: V2MutatingOpts,
    ) =>
      post(`/ops/orders/${encodeId(id)}/intake`, {
        ...input,
        expectedVersion,
      }, order, opts),

advanceCare: (
      id: string,
      target: v2.OrderStatus,
      expectedVersion: number,
      opts?: V2MutatingOpts,
    ) =>
      post(`/ops/orders/${encodeId(id)}/care`, {
        target,
        expectedVersion,
      }, order, opts),

recordQualityCheck: (
      id: string,
      input: Input,
      expectedVersion: number,
      opts?: V2MutatingOpts,
    ) =>
      post(`/ops/orders/${encodeId(id)}/quality-check`, {
        ...input,
        expectedVersion,
      }, order, opts),

holdOrder: (
      id: string,
      reason: string,
      expectedVersion: number,
      opts?: V2MutatingOpts,
    ) =>
      post(`/ops/orders/${encodeId(id)}/hold`, {
        reason,
        expectedVersion,
      }, order, opts),

resolveException: (
      id: string,
      input: Input,
      expectedVersion: number,
      opts?: V2MutatingOpts,
    ) =>
      post(`/ops/orders/${encodeId(id)}/resolve-exception`, {
        ...input,
        expectedVersion,
      }, order, opts),

confirmManualPayment: (
      obligationId: string,
      input: Input,
      opts?: V2MutatingOpts,
    ) =>
      post(`/ops/billing/obligations/${encodeId(obligationId)}/confirm-manual-payment`, input, obligation, opts),

createRefund: (input: Input, opts?: V2MutatingOpts) =>
      post("/ops/billing/refunds", input, refund, opts),

reconciliation: (period: string) =>
      get(`/ops/billing/reconciliation${queryString({ period })}`, v2.reconciliationSchema),

assignDelivery: (input: Input, opts?: V2MutatingOpts) =>
      post("/ops/logistics/assignments", input, v2.assignmentSchema, opts),

reassignDelivery: (id: string, input: Input, opts?: V2MutatingOpts) =>
      post(`/ops/logistics/assignments/${encodeId(id)}/reassign`, input, v2.assignmentSchema, opts),

cancelLeg: (id: string, input: Input, opts?: V2MutatingOpts) =>
      post(`/ops/logistics/legs/${encodeId(id)}/cancel`, input, v2.legSchema, opts),

resolveIncident: (id: string, input: Input, opts?: V2MutatingOpts) =>
      post(`/ops/incidents/${encodeId(id)}/resolve`, input, v2.incidentResolutionSchema, opts),

moderateReview: (id: string, input: Input, opts?: V2MutatingOpts) =>
      post(`/ops/reviews/${encodeId(id)}/moderate`, input, v2.reviewModerationSchema, opts),

listDeadLetters: (query?: Query) =>
      get(`/ops/jobs/dead-letters${queryString(query)}`, objectArraySchema),

replayJob: (id: string, opts?: V2MutatingOpts) =>
      post(`/ops/jobs/${encodeId(id)}/replay`, {}, genericObject, opts),

jobHealth: () =>
      get("/ops/jobs/health", genericObject),
  };
}

export type V2Client = ReturnType<typeof createV2Client>;
