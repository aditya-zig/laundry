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

type Schema<T> = z.ZodType<T>;
type Query = Record<string, string | number | boolean | undefined>;

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
    const body = route.requestSchema ? v2.getWireSchema(route.requestSchema).parse(config.body) : config.body;
    return request(route.method, route.path.slice("/v2".length) + queryString(config.query),
      schema, body, config.opts);
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

  return {
    requestOtp: (phone: string, opts?: V2MutatingOpts) =>
      call("identity.otp.request", v2.otpChallengeSchema, { body: v2.otpRequestSchema.parse({ phone }), opts }),

    verifyOtp: (challengeId: string, code: string, opts?: V2MutatingOpts & { mfaCode?: string }) =>
      call("identity.otp.verify", v2.sessionSchema, { body: v2.otpVerifySchema.parse({ challengeId, code, ...(opts?.mfaCode === undefined ? {} : { mfaCode: opts.mfaCode }) }), opts }),

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

    inviteStaff: (input: v2.StaffInvitation, opts?: V2MutatingOpts) =>
      call("identity.staff.invite", v2.staffInvitationResultSchema, { body: input, opts }),

    configureStaffMfa: (input: v2.StaffMfaSetup, opts?: V2MutatingOpts) =>
      call("identity.staff.mfa", v2.staffMfaResultSchema, { body: input, opts }),

    linkWhatsApp: (input: v2.WhatsAppLink, opts?: V2MutatingOpts) =>
      call("identity.whatsapp.link", v2.whatsAppLinkResultSchema, { body: input, opts }),

    listGarmentEligibility: (query?: Query) =>
      call("catalog.garments", v2.WIRE_SCHEMAS.GarmentEligibilityList, { query }),

    getEffectiveRates: (query?: Query) =>
      call("catalog.rates.effective", v2.WIRE_SCHEMAS.EffectiveRateSummary, { query }),

    updateService: (serviceId: string, input: v2.ServiceUpdate, opts?: V2MutatingOpts) =>
      call("catalog.services.write", service, { params: { serviceId }, body: input, opts }),

    createRateCard: (input: v2.RateCardInput, opts?: V2MutatingOpts) =>
      call("catalog.rate-cards.create", v2.rateCardSchema, { body: input, opts }),

    approveRateCard: (rateCardId: string, input: v2.VersionedReason, opts?: V2MutatingOpts) =>
      call("catalog.rate-cards.approve", v2.rateCardSchema, { params: { rateCardId }, body: input, opts }),

    activateRateCard: (rateCardId: string, input: v2.VersionedReason, opts?: V2MutatingOpts) =>
      call("catalog.rate-cards.activate", v2.rateCardSchema, { params: { rateCardId }, body: input, opts }),

    getOperationsCalendar: (query?: Query) =>
      call("availability.calendar", v2.operationsCalendarSchema, { query }),

    setCapacity: (input: v2.CapacityUpdate, opts?: V2MutatingOpts) =>
      call("availability.capacity", v2.capacityBucketSchema, { body: input, opts }),

    listServices: () => call("catalog.services.list", serviceList),

    getService: (id: string) =>
      call("catalog.services.detail", service, { params: { serviceId: id } }),

    checkServiceArea: (postalCode: string) =>
      call("availability.area", v2.serviceAreaSchema, { params: { postalCode } }),

    listSlots: (input: v2.SlotQuery) => {
      const parsed = v2.slotQuerySchema.parse(input);
      return call("availability.slots", v2.slotPairListSchema, { query: { ...parsed, serviceIds: parsed.serviceIds.join(",") } });
    },

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
      call("orders.cancel", order, { params: { orderId: id }, body: v2.orderCancellationSchema.parse({
        reason,
        expectedVersion,
      }), opts }),

    rescheduleOrder: (
      id: string,
      input: v2.OrderReschedule,
      opts?: V2MutatingOpts,
    ) =>
      call("orders.reschedule", order, { params: { orderId: id }, body: v2.orderRescheduleSchema.parse(input), opts }),

    decideAdjustment: (
      id: string,
      adjustmentId: string,
      adjustmentVersion: number,
      decision: v2.AdjustmentDecision["decision"],
      expectedVersion: number,
      opts?: V2MutatingOpts,
    ) =>
      call("orders.adjustment.decide", order, { params: { orderId: id }, body: v2.adjustmentDecisionSchema.parse({
        adjustmentId,
        adjustmentVersion,
        decision,
        expectedVersion,
      }), opts }),

    getCustodyReceipt: (id: string) =>
      call("orders.custody-receipt", custodyReceipt, { params: { orderId: id } }),

    listOrderObligations: (orderId: string, query?: Query) =>
      call("billing.obligations", v2.WIRE_SCHEMAS.ObligationList, { params: { orderId }, query }),

    listOrderPaymentAttempts: (orderId: string, query?: Query) =>
      call("billing.attempts", v2.WIRE_SCHEMAS.PaymentAttemptList, { params: { orderId }, query }),

    listOrderReceipts: (orderId: string, query?: Query) =>
      call("billing.receipts", v2.WIRE_SCHEMAS.ReceiptList, { params: { orderId }, query }),

    listOrderRefunds: (orderId: string, query?: Query) =>
      call("billing.refunds", v2.WIRE_SCHEMAS.RefundList, { params: { orderId }, query }),

    getOrderTracking: (orderId: string) =>
      call("logistics.tracking", tracking, { params: { orderId } }),

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

    createIncident: (input: v2.IncidentInput, opts?: V2MutatingOpts) =>
      call("support.incidents.create", incident, { params: { orderId: v2.idSchema.parse(input.orderId) }, body: v2.incidentInputSchema.parse(input), opts }),

    listIncidentMessages: (incidentId: string) =>
      call("support.incidents.messages.list", v2.pageSchema(v2.incidentMessageSchema), { params: { incidentId } }),

    postIncidentMessage: (
      incidentId: string,
      input: v2.IncidentMessageInput,
      opts?: V2MutatingOpts,
    ) =>
      call("support.incidents.messages", v2.incidentMessageSchema, { params: { incidentId }, body: v2.incidentMessageInputSchema.parse(input), opts }),

    requestRewash: (
      incidentId: string,
      input: v2.RewashRequestInput,
      opts?: V2MutatingOpts,
    ) =>
      call("support.rewash.create", v2.rewashRequestSchema, { params: { incidentId }, body: v2.rewashRequestInputSchema.parse(input), opts }),

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

    acceptJob: (id: string, expectedVersion: number, opts?: V2MutatingOpts) =>
      call("logistics.rider.accept", v2.assignmentSchema, { params: { jobId: id }, body: v2.versionedCommandSchema.parse({ expectedVersion }), opts }),

    recordHandover: (
      jobId: string,
      input: Omit<v2.RiderHandover, "jobId">,
      opts?: V2MutatingOpts,
    ) =>
      call("logistics.rider.handover", v2.handoverResultSchema, { body: v2.riderHandoverSchema.parse({ ...input, jobId }), opts }),

    reportJobException: (
      id: string,
      input: v2.DeliveryException,
      opts?: V2MutatingOpts,
    ) =>
      call("logistics.rider.exception", v2.legAttemptSchema, { params: { jobId: id }, body: v2.deliveryExceptionSchema.parse(input), opts }),

    reportLocation: (
      id: string,
      input: Omit<v2.RiderLocationReport, "jobId">,
      opts?: V2MutatingOpts,
    ) =>
      call("logistics.rider.location", v2.locationSchema, { body: v2.riderLocationReportSchema.parse({ ...input, jobId: id }), opts }),

    listOpsOrders: (query?: Query) =>
      call("orders.ops.queue", orderList, { query }),

    recordIntake: (
      id: string,
      input: Omit<v2.IntakeRecord, "expectedVersion">,
      expectedVersion: number,
      opts?: V2MutatingOpts,
    ) =>
      call("orders.ops.intake", order, { params: { orderId: id }, body: v2.intakeRecordSchema.parse({
        ...input,
        expectedVersion,
      }), opts }),

    advanceCare: (
      id: string,
      target: v2.CareUpdate["target"],
      expectedVersion: number,
      opts?: V2MutatingOpts,
    ) =>
      call("orders.ops.care", order, { params: { orderId: id }, body: v2.careUpdateSchema.parse({
        target,
        expectedVersion,
      }), opts }),

    recordQualityCheck: (
      id: string,
      input: Omit<v2.QualityCheck, "expectedVersion">,
      expectedVersion: number,
      opts?: V2MutatingOpts,
    ) =>
      call("orders.ops.qc", order, { params: { orderId: id }, body: v2.qualityCheckSchema.parse({
        ...input,
        expectedVersion,
      }), opts }),

    holdOrder: (
      id: string,
      reason: string,
      expectedVersion: number,
      opts?: V2MutatingOpts,
    ) =>
      call("orders.ops.hold", order, { params: { orderId: id }, body: v2.orderHoldSchema.parse({
        reason,
        expectedVersion,
      }), opts }),

    resolveException: (
      id: string,
      input: Omit<v2.ExceptionResolution, "expectedVersion">,
      expectedVersion: number,
      opts?: V2MutatingOpts,
    ) =>
      call("orders.ops.exception", order, { params: { orderId: id }, body: v2.exceptionResolutionSchema.parse({
        ...input,
        expectedVersion,
      }), opts }),

    confirmManualPayment: (
      obligationId: string,
      input: v2.ManualPaymentConfirmation,
      opts?: V2MutatingOpts,
    ) =>
      call("billing.manual.confirm", receipt, { params: { obligationId }, body: v2.manualPaymentConfirmationSchema.parse(input), opts }),

    createRefund: (input: v2.RefundRequest, opts?: V2MutatingOpts) =>
      call("billing.refund.create", refund, { body: v2.refundRequestSchema.parse(input), opts }),

    reconciliation: (period: string, opts?: V2MutatingOpts) =>
      call("billing.reconcile", v2.reconciliationSchema, { body: v2.reconciliationRequestSchema.parse({ period }), opts }),

    assignDelivery: (input: v2.AssignmentInput, opts?: V2MutatingOpts) =>
      call("logistics.ops.assign", v2.assignmentSchema, { body: v2.assignmentInputSchema.parse(input), opts }),

    reassignDelivery: (id: string, input: v2.ReassignmentInput, opts?: V2MutatingOpts) =>
      call("logistics.ops.reassign", v2.assignmentSchema, { params: { assignmentId: id }, body: v2.reassignmentInputSchema.parse(input), opts }),

    cancelLeg: (id: string, input: v2.LegCancellation, opts?: V2MutatingOpts) =>
      call("logistics.ops.cancel", v2.legAttemptSchema, { params: { legAttemptId: id }, body: v2.legCancellationSchema.parse(input), opts }),

    resolveIncident: (id: string, input: v2.IncidentResolutionInput, opts?: V2MutatingOpts) =>
      call("support.incidents.resolve", incident, { params: { incidentId: id }, body: v2.incidentResolutionInputSchema.parse(input), opts }),

    moderateReview: (id: string, input: v2.ReviewModerationInput, opts?: V2MutatingOpts) =>
      call("reviews.moderate", review, { params: { reviewId: id }, body: v2.reviewModerationInputSchema.parse(input), opts }),

    confirmDraft: (input: v2.DraftConfirmation, opts?: V2MutatingOpts) =>
      call("conversations.confirm", order, { params: { draftId: input.draftId }, body: input, opts }),

    optOutConversation: (input: v2.ConversationOptOut, opts?: V2MutatingOpts) =>
      call("conversations.optout", v2.optOutResultSchema, { body: input, opts }),

    handoffConversation: (draftId: string, input: v2.ConversationHandoff, opts?: V2MutatingOpts) =>
      call("conversations.handoff", v2.conversationDraftSchema, { params: { draftId }, body: input, opts }),

    listDeadLetters: (query?: Query) =>
      call("jobs.dead-letter.list", v2.pageSchema(v2.jobSchema), { query }),

    replayJob: (id: string, input: v2.JobReplay, opts?: V2MutatingOpts) =>
      call("jobs.replay", v2.jobSchema, { params: { jobId: id }, body: v2.jobReplaySchema.parse(input), opts }),

    jobHealth: () =>
      call("jobs.health", v2.jobHealthSchema),
  };
}

export type V2Client = ReturnType<typeof createV2Client>;
