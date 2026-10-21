import { z } from "zod";
import { v2 } from "@laundry/contracts";

export interface V2ClientOptions {
  baseUrl?: string;
  getToken?: () => string | undefined;
  fetchImpl?: typeof fetch;
  generateKey?: () => string;
}

export interface V2MutatingOpts {
  /** Persist this key with the original payload before sending a mutation.
   * Reuse both after a timeout or restart. Editing intent needs a new key. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export class UnknownOutcomeError extends Error {
  readonly code = "PROVIDER_OUTCOME_UNKNOWN" as const;
  readonly outcome = "UNKNOWN" as const;
  override readonly cause: unknown;
  readonly idempotencyKey: string | undefined;

  constructor(message: string, cause?: unknown, idempotencyKey?: string) {
    super(message);
    this.name = "UnknownOutcomeError";
    this.cause = cause;
    this.idempotencyKey = idempotencyKey;
  }
}

export class V2ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly traceId: string;
  readonly retryable: boolean;
  readonly fieldErrors: unknown;
  readonly currentVersion: number | undefined;
  readonly idempotencyKey: string | undefined;

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
    idempotencyKey?: string,
  ) {
    super(`${envelope.code}: ${envelope.message}`);
    this.name = "V2ApiError";
    this.status = status;
    this.code = envelope.code;
    this.traceId = envelope.traceId;
    this.retryable = envelope.retryable;
    this.fieldErrors = envelope.fieldErrors;
    this.currentVersion = envelope.currentVersion;
    this.idempotencyKey = idempotencyKey;
  }
}

const DEFAULT_BASE = "http://localhost:4100/v2";
const emptyObjectSchema = z.object({}).passthrough();

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

    const isMutation = method !== "GET";
    const idempotencyKey = isMutation
      ? v2.idempotencyKeySchema.parse(opts.idempotencyKey ?? generateKey())
      : undefined;
    if (idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = idempotencyKey;
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
      if (!isMutation) throw error;
      throw new UnknownOutcomeError(
        "The request outcome is unknown. Retry only with the same idempotency key.",
        error,
        idempotencyKey,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (isMutation) {
        throw new UnknownOutcomeError(
          "The response could not be read. Reconcile or retry with the same idempotency key.",
          error,
          idempotencyKey,
        );
      }
      throw error;
    }

    if (!response.ok) {
      const parsed = v2.errorEnvelopeSchema.safeParse(payload);

      if (parsed.success) {
        throw new V2ApiError(response.status, parsed.data, idempotencyKey);
      }

      if (isMutation && response.status >= 500) {
        throw new UnknownOutcomeError(
          `The server returned HTTP ${response.status}; the request outcome is unknown.`,
          undefined,
          idempotencyKey,
        );
      }

      throw new V2ApiError(response.status, {
        code: "UNKNOWN_ERROR",
        message: `Request failed with HTTP ${response.status}`,
        traceId: "trace-unknown",
        retryable: false,
      }, idempotencyKey);
    }

    try {
      return schema.parse(payload);
    } catch (error) {
      if (!isMutation) throw error;
      throw new UnknownOutcomeError(
        "The successful response violated the contract. Reconcile or retry with the same idempotency key.",
        error,
        idempotencyKey,
      );
    }
  }

  function call<T>(
    routeId: v2.RouteOperationId,
    schema: Schema<T>,
    config: {
      params?: Record<string, string>;
      query?: Query;
      body?: unknown;
      opts?: V2MutatingOpts;
    } = {},
  ): Promise<T> {
    const route = v2.resolveRoute(routeId, config.params);
    return request(route.method, route.path.slice("/v2".length) + queryString(config.query),
      schema, config.body, config.opts);
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
  const uploadIntentResult = v2.uploadIntentResultSchema;
  const mediaDownload = v2.mediaDownloadSchema;
  const custodyReceipt = v2.custodyReceiptSchema;
  const timeline = z.array(v2.orderTimelineEventSchema);
  const serviceList = z.array(service);
  const orderList = v2.pageSchema(order);
  const obligationList = v2.pageSchema(obligation);
  const receiptList = v2.pageSchema(receipt);
  const refundList = v2.pageSchema(refund);
  const incidentList = v2.pageSchema(incident);
  const reviewList = v2.pageSchema(v2.publicReviewSchema);
  const jobList = z.array(riderJob);
  const genericObject = emptyObjectSchema;

  return {
    requestOtp: (phone: string, opts?: V2MutatingOpts) =>
      call("identity.otp.request", v2.otpChallengeSchema, { body: v2.otpRequestSchema.parse({ phone }), opts }),

    verifyOtp: (challengeId: string, code: string, opts?: V2MutatingOpts) =>
      call("identity.otp.verify", v2.sessionSchema, { body: v2.otpVerifySchema.parse({ challengeId, code }), opts }),

    refreshSession: (refreshToken: string, opts?: V2MutatingOpts) =>
      call("identity.session.refresh", v2.sessionSchema, { body: v2.sessionRefreshSchema.parse({ refreshToken }), opts }),

    logout: (opts?: V2MutatingOpts) =>
      call("identity.logout", v2.logoutResultSchema, { opts }),

    revokeSession: (sessionId: string, opts?: V2MutatingOpts) =>
      call("identity.revoke", v2.sessionRevocationSchema, { params: { sessionId }, opts }),

    me: () => call("identity.me", v2.actorSchema),

    listAddresses: () => call("identity.address.list", z.array(v2.addressSchema)),

    createAddress: (input: v2.AddressInput, opts?: V2MutatingOpts) =>
      call("identity.address.create", v2.addressSchema, { body: v2.addressInputSchema.parse(input), opts }),

    updateAddress: (
      id: string,
      input: v2.AddressInput,
      expectedVersion: number,
      opts?: V2MutatingOpts,
    ) =>
      call("identity.address.update", v2.addressSchema, { params: { addressId: id }, body: v2.addressUpdateSchema.parse({
        ...input,
        expectedVersion,
      }), opts }),

    deleteAddress: (id: string, expectedVersion: number, opts?: V2MutatingOpts) =>
      call("identity.address.delete", v2.deleteResultSchema, { params: { addressId: id }, body: v2.addressDeleteSchema.parse({ expectedVersion }), opts }),

    listServices: () => call("catalog.services.list", serviceList),

    getService: (id: string) =>
      call("catalog.services.detail", service, { params: { serviceId: id } }),

    checkServiceArea: (postalCode: string) =>
      call("availability.area", v2.serviceAreaSchema, { params: { postalCode } }),

    listSlots: (input: Query) =>
      call("availability.slots", genericObject, { query: input }),

    createQuote: (input: v2.QuoteInput, opts?: V2MutatingOpts) =>
      call("orders.quote", quote, { body: v2.quoteInputSchema.parse(input), opts }),

    bookOrder: (input: v2.BookingInput, opts?: V2MutatingOpts) =>
      call("orders.book", order, { body: v2.bookingInputSchema.parse(input), opts }),

    listOrders: (query?: Query) => call("orders.list", orderList, { query }),

    getOrder: (id: string) => call("orders.detail", order, { params: { orderId: id } }),

    getOrderTimeline: (id: string) => call("orders.timeline", timeline, { params: { orderId: id } }),

    cancelOrder: (
      id: string,
      reason: string,
      expectedVersion: number,
      opts?: V2MutatingOpts,
    ) =>
      call("orders.cancel", order, { params: { orderId: id }, body: {
        reason,
        expectedVersion,
      }, opts }),

    rescheduleOrder: (
      id: string,
      window: v2.ScheduleWindow,
      expectedVersion: number,
      opts?: V2MutatingOpts,
    ) =>
      call("orders.reschedule", order, { params: { orderId: id }, body: {
        window,
        expectedVersion,
      }, opts }),

    decideAdjustment: (
      id: string,
      adjustmentId: string,
      adjustmentVersion: number,
      decision: v2.AdjustmentDecision["decision"],
      opts?: V2MutatingOpts,
    ) =>
      call("orders.adjustment.decide", order, { params: { orderId: id }, body: v2.adjustmentDecisionSchema.parse({
        adjustmentId,
        adjustmentVersion,
        decision,
      }), opts }),

    getCustodyReceipt: (id: string) =>
      call("orders.custody-receipt", custodyReceipt, { params: { orderId: id } }),

    listObligations: (query?: Query) =>
      call("billing.obligations.list", obligationList, { query }),

    getObligation: (id: string) =>
      call("billing.obligation.read", v2.billingSummarySchema, { params: { obligationId: id } }),

    listReceipts: (obligationId: string) =>
      call("billing.receipts.list", receiptList, { params: { obligationId } }),

    listRefunds: (query?: Query) =>
      call("billing.refunds.list", refundList, { query }),

    getTracking: (orderId: string) =>
      call("logistics.tracking.read", tracking, { params: { orderId } }),

    createUploadIntent: (input: v2.UploadIntent, opts?: V2MutatingOpts) =>
      call("media.upload.intent", uploadIntentResult, { body: v2.uploadIntentSchema.parse(input), opts }),

    finalizeUpload: (uploadId: string, opts?: V2MutatingOpts) =>
      call("media.upload.finalize", v2.mediaReferenceSchema, { params: { mediaId: uploadId }, opts }),

    getDownloadUrl: (mediaId: string, opts?: V2MutatingOpts) =>
      call("media.download", mediaDownload, { params: { mediaId }, opts }),

    listIncidents: () =>
      call("support.incidents.list", incidentList),

    createIncident: (input: Input, opts?: V2MutatingOpts) =>
      call("support.incidents.create", incident, { params: { orderId: v2.idSchema.parse(input.orderId) }, body: input, opts }),

    listIncidentMessages: (incidentId: string) =>
      call("support.incidents.messages.list", v2.pageSchema(v2.incidentMessageSchema), { params: { incidentId } }),

    postIncidentMessage: (
      incidentId: string,
      input: Input,
      opts?: V2MutatingOpts,
    ) =>
      call("support.incidents.messages", v2.incidentMessageSchema, { params: { incidentId }, body: input, opts }),

    requestRewash: (
      incidentId: string,
      input: Input,
      opts?: V2MutatingOpts,
    ) =>
      call("support.rewash.create", v2.rewashRequestSchema, { params: { incidentId }, body: input, opts }),

    createReview: (input: v2.ReviewInput, opts?: V2MutatingOpts) =>
      call("reviews.create", review, { params: { orderId: input.orderId }, body: v2.reviewInputSchema.parse(input), opts }),

    getReviewEligibility: (orderId: string) =>
      call("reviews.eligibility", v2.reviewEligibilitySchema, { params: { orderId } }),

    listPublicReviews: (serviceId: string, query?: Query) =>
      call("reviews.public", reviewList, { query: { ...query, serviceId } }),

    listJobs: () =>
      call("logistics.rider.jobs", jobList),

    getJob: (id: string) =>
      call("logistics.rider.job", riderJob, { params: { jobId: id } }),

    acceptJob: (id: string, opts?: V2MutatingOpts) =>
      call("logistics.rider.accept", v2.assignmentSchema, { params: { jobId: id }, opts }),

    recordHandover: (
      jobId: string,
      input: Input,
      opts?: V2MutatingOpts,
    ) =>
      call("logistics.rider.handover", v2.handoverResultSchema, { body: { ...input, jobId }, opts }),

    reportJobException: (
      id: string,
      input: Input,
      opts?: V2MutatingOpts,
    ) =>
      call("logistics.rider.exception", v2.legAttemptSchema, { params: { jobId: id }, body: input, opts }),

    reportLocation: (
      id: string,
      input: Input,
      opts?: V2MutatingOpts,
    ) =>
      call("logistics.rider.location", v2.locationSchema, { body: { ...input, jobId: id }, opts }),

    listOpsOrders: (query?: Query) =>
      call("orders.ops.queue", orderList, { query }),

    recordIntake: (
      id: string,
      input: Input,
      expectedVersion: number,
      opts?: V2MutatingOpts,
    ) =>
      call("orders.ops.intake", order, { params: { orderId: id }, body: {
        ...input,
        expectedVersion,
      }, opts }),

    advanceCare: (
      id: string,
      target: v2.OrderStatus,
      expectedVersion: number,
      opts?: V2MutatingOpts,
    ) =>
      call("orders.ops.care", order, { params: { orderId: id }, body: {
        target,
        expectedVersion,
      }, opts }),

    recordQualityCheck: (
      id: string,
      input: Input,
      expectedVersion: number,
      opts?: V2MutatingOpts,
    ) =>
      call("orders.ops.qc", order, { params: { orderId: id }, body: {
        ...input,
        expectedVersion,
      }, opts }),

    holdOrder: (
      id: string,
      reason: string,
      expectedVersion: number,
      opts?: V2MutatingOpts,
    ) =>
      call("orders.ops.hold", order, { params: { orderId: id }, body: {
        reason,
        expectedVersion,
      }, opts }),

    resolveException: (
      id: string,
      input: Input,
      expectedVersion: number,
      opts?: V2MutatingOpts,
    ) =>
      call("orders.ops.exception", order, { params: { orderId: id }, body: {
        ...input,
        expectedVersion,
      }, opts }),

    confirmManualPayment: (
      obligationId: string,
      input: Input,
      opts?: V2MutatingOpts,
    ) =>
      call("billing.manual.confirm", receipt, { params: { obligationId }, body: input, opts }),

    createRefund: (input: Input, opts?: V2MutatingOpts) =>
      call("billing.refund.create", refund, { body: input, opts }),

    reconciliation: (period: string, opts?: V2MutatingOpts) =>
      call("billing.reconcile", v2.reconciliationSchema, { body: { period }, opts }),

    assignDelivery: (input: Input, opts?: V2MutatingOpts) =>
      call("logistics.ops.assign", v2.assignmentSchema, { body: input, opts }),

    reassignDelivery: (id: string, input: Input, opts?: V2MutatingOpts) =>
      call("logistics.ops.reassign", v2.assignmentSchema, { params: { assignmentId: id }, body: input, opts }),

    cancelLeg: (id: string, input: Input, opts?: V2MutatingOpts) =>
      call("logistics.ops.cancel", v2.legAttemptSchema, { params: { legAttemptId: id }, body: input, opts }),

    resolveIncident: (id: string, input: Input, opts?: V2MutatingOpts) =>
      call("support.incidents.resolve", incident, { params: { incidentId: id }, body: input, opts }),

    moderateReview: (id: string, input: Input, opts?: V2MutatingOpts) =>
      call("reviews.moderate", review, { params: { reviewId: id }, body: input, opts }),

    listDeadLetters: (query?: Query) =>
      call("jobs.dead-letter.list", v2.pageSchema(emptyObjectSchema), { query }),

    replayJob: (id: string, opts?: V2MutatingOpts) =>
      call("jobs.replay", genericObject, { params: { jobId: id }, opts }),

    jobHealth: () =>
      call("jobs.health", genericObject),
  };
}

export type V2Client = ReturnType<typeof createV2Client>;
