import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { v2 } from "@laundry/contracts";
import { v2WireFixtures } from "@laundry/test-fixtures";
import { createV2Client, type V2Client } from "../src/v2.js";

const id = "11111111-1111-4111-8111-111111111111";
const key = "synthetic-inventory-intent";
const opts = { idempotencyKey: key };
const sample = <T>(name: v2.WireSchemaName, schema: z.ZodType<T>) => schema.parse(v2WireFixtures[name]);
type FirstPartyOperation = Exclude<v2.RouteOperationId, "billing.webhook" | "logistics.provider.webhook" | "conversations.webhook">;

// Each entry calls the actual public SDK method. A new route fails compilation
// until a caller example exists; these are not generic raw HTTP invocations.
const callers = {
  "identity.otp.request": c => c.requestOtp("+919000000000", opts),
  "identity.otp.verify": c => c.verifyOtp(id, "123456", opts),
  "identity.session.refresh": c => c.refreshSession("synthetic-refresh", opts),
  "identity.logout": c => c.logout(opts),
  "identity.revoke": c => c.revokeSession(id, opts),
  "identity.me": c => c.me(),
  "identity.staff.invite": c => c.inviteStaff(sample("StaffInvitation", v2.staffInvitationSchema), opts),
  "identity.staff.mfa": c => c.configureStaffMfa(sample("StaffMfaSetup", v2.staffMfaSetupSchema), opts),
  "identity.address.create": c => c.createAddress(sample("AddressInput", v2.addressInputSchema), opts),
  "identity.address.list": c => c.listAddresses(),
  "identity.address.update": c => c.updateAddress(id, sample("AddressInput", v2.addressInputSchema), 1, opts),
  "identity.address.delete": c => c.deleteAddress(id, 1, opts),
  "identity.whatsapp.link": c => c.linkWhatsApp(sample("WhatsAppLink", v2.whatsAppLinkSchema), opts),
  "catalog.services.list": c => c.listServices(),
  "catalog.services.detail": c => c.getService(id),
  "catalog.garments": c => c.listGarmentEligibility(),
  "catalog.rates.effective": c => c.getEffectiveRates(),
  "catalog.services.write": c => c.updateService(id, sample("ServiceUpdate", v2.serviceUpdateSchema), opts),
  "catalog.rate-cards.create": c => c.createRateCard(sample("RateCardInput", v2.rateCardInputSchema), opts),
  "catalog.rate-cards.approve": c => c.approveRateCard(id, sample("VersionedReason", v2.versionedReasonSchema), opts),
  "catalog.rate-cards.activate": c => c.activateRateCard(id, sample("VersionedReason", v2.versionedReasonSchema), opts),
  "availability.area": c => c.checkServiceArea("560038"),
  "availability.slots": c => c.listSlots({ areaId: id, from: "2026-10-22T00:00:00Z", to: "2026-10-23T00:00:00Z", serviceIds: [id] }),
  "availability.calendar": c => c.getOperationsCalendar(),
  "availability.capacity": c => c.setCapacity(sample("CapacityUpdate", v2.capacityUpdateSchema), opts),
  "orders.quote": c => c.createQuote(sample("QuoteInput", v2.quoteInputSchema), opts),
  "orders.book": c => c.bookOrder(sample("BookingInput", v2.bookingInputSchema), opts),
  "orders.list": c => c.listOrders(),
  "orders.detail": c => c.getOrder(id),
  "orders.timeline": c => c.getOrderTimeline(id),
  "orders.cancel": c => c.cancelOrder(id, "Synthetic cancellation", 1, opts),
  "orders.reschedule": c => c.rescheduleOrder(id, sample("OrderReschedule", v2.orderRescheduleSchema), opts),
  "orders.adjustment.decide": c => c.decideAdjustment(id, id, 1, "ACCEPT", 1, opts),
  "orders.ops.queue": c => c.listOpsOrders(),
  "orders.ops.intake": c => { const { expectedVersion, ...input } = sample("IntakeRecord", v2.intakeRecordSchema); return c.recordIntake(id, input, expectedVersion, opts); },
  "orders.ops.care": c => c.advanceCare(id, "IN_CARE", 1, opts),
  "orders.ops.qc": c => { const { expectedVersion, ...input } = sample("QualityCheck", v2.qualityCheckSchema); return c.recordQualityCheck(id, input, expectedVersion, opts); },
  "orders.ops.hold": c => c.holdOrder(id, "Synthetic hold", 1, opts),
  "orders.ops.exception": c => c.resolveException(id, { action: "RESUME", reason: "Synthetic resolution" }, 1, opts),
  "billing.obligations": c => c.listOrderObligations(id),
  "billing.attempts": c => c.listOrderPaymentAttempts(id),
  "billing.receipts": c => c.listOrderReceipts(id),
  "billing.refunds": c => c.listOrderRefunds(id),
  "billing.manual.confirm": c => c.confirmManualPayment(id, sample("ManualPaymentConfirmation", v2.manualPaymentConfirmationSchema), opts),
  "billing.refund.create": c => c.createRefund(sample("RefundRequest", v2.refundRequestSchema), opts),
  "billing.reconcile": c => c.reconciliation("2026-10", opts),
  "logistics.rider.jobs": c => c.listJobs(),
  "logistics.rider.job": c => c.getJob(id),
  "logistics.rider.accept": c => c.acceptJob(id, 1, opts),
  "logistics.rider.handover": c => { const { jobId, ...input } = sample("RiderHandover", v2.riderHandoverSchema); return c.recordHandover(jobId, input, opts); },
  "logistics.rider.exception": c => c.reportJobException(id, sample("DeliveryException", v2.deliveryExceptionSchema), opts),
  "logistics.rider.location": c => { const { jobId, ...input } = sample("RiderLocationReport", v2.riderLocationReportSchema); return c.reportLocation(jobId, input, opts); },
  "logistics.ops.assign": c => c.assignDelivery(sample("AssignmentInput", v2.assignmentInputSchema), opts),
  "logistics.ops.reassign": c => c.reassignDelivery(id, sample("ReassignmentInput", v2.reassignmentInputSchema), opts),
  "logistics.ops.cancel": c => c.cancelLeg(id, sample("LegCancellation", v2.legCancellationSchema), opts),
  "logistics.tracking": c => c.getOrderTracking(id),
  "media.upload.intent": c => c.createUploadIntent(sample("UploadIntent", v2.uploadIntentSchema), opts),
  "media.upload.finalize": c => c.finalizeUpload(id, opts),
  "media.download": c => c.getDownloadUrl(id, opts),
  "support.incidents.create": c => c.createIncident(sample("IncidentInput", v2.incidentInputSchema), opts),
  "support.incidents.list": c => c.listIncidents(),
  "support.incidents.messages": c => c.postIncidentMessage(id, sample("IncidentMessageInput", v2.incidentMessageInputSchema), opts),
  "support.incidents.resolve": c => c.resolveIncident(id, sample("IncidentResolutionInput", v2.incidentResolutionInputSchema), opts),
  "support.rewash.create": c => c.requestRewash(id, sample("RewashRequestInput", v2.rewashRequestInputSchema), opts),
  "reviews.create": c => c.createReview(sample("ReviewInput", v2.reviewInputSchema), opts),
  "reviews.moderate": c => c.moderateReview(id, sample("ReviewModerationInput", v2.reviewModerationInputSchema), opts),
  "reviews.public": c => c.listPublicReviews(id),
  "conversations.confirm": c => c.confirmDraft(sample("DraftConfirmation", v2.draftConfirmationSchema), opts),
  "conversations.optout": c => c.optOutConversation(sample("ConversationOptOut", v2.conversationOptOutSchema), opts),
  "conversations.handoff": c => c.handoffConversation(id, sample("ConversationHandoff", v2.conversationHandoffSchema), opts),
  "jobs.dead-letter.list": c => c.listDeadLetters(),
  "jobs.replay": c => c.replayJob(id, sample("JobReplay", v2.jobReplaySchema), opts),
  "jobs.health": c => c.jobHealth(),
  "billing.obligations.list": c => c.listObligations(),
  "billing.obligation.read": c => c.getObligation(id),
  "billing.receipts.list": c => c.listReceipts(id),
  "billing.refunds.list": c => c.listRefunds(),
  "logistics.tracking.read": c => c.getTracking(id),
  "orders.custody-receipt": c => c.getCustodyReceipt(id),
  "support.incidents.messages.list": c => c.listIncidentMessages(id),
  "reviews.eligibility": c => c.getReviewEligibility(id),
} satisfies Record<FirstPartyOperation, (client: V2Client) => Promise<unknown>>;

describe("SDK executable inventory against deterministic wire fixtures", () => {
  for (const [operationId, invoke] of Object.entries(callers)) {
    it(`${operationId} sends the declared verb/path/body and parses its declared response`, async () => {
      const route = v2.ROUTE_REGISTRY.find(r => r.id === operationId);
      if (!route) throw new Error(`Missing route ${operationId}`);
      const response = Reflect.get(v2WireFixtures, route.responseSchema);
      const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json(response));
      const client = createV2Client({ baseUrl: "https://example.invalid/v2", fetchImpl });
      const result = await invoke(client);
      expect(result).toEqual(v2.getWireSchema(route.responseSchema).parse(response));
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0];
      expect(init?.method).toBe(route.method);
      const expected = route.path.replace(/\{[^}]+\}/g, "[^/]+");
      expect(new URL(String(url)).pathname).toMatch(new RegExp(`^${expected}$`));
      expect(init?.headers).toMatchObject(route.method === "GET" ? { Accept: "application/json" } : { "Idempotency-Key": key });
      if (route.method === "GET") expect(init?.headers).not.toHaveProperty("Idempotency-Key");
      if (route.requestSchema) expect(v2.getWireSchema(route.requestSchema).safeParse(JSON.parse(String(init?.body))).success).toBe(true);
    });
  }

  it("excludes authenticated provider webhooks from the first-party app SDK", () => {
    expect(v2.ROUTE_REGISTRY.filter(r => r.authentication === "PROVIDER_SIGNATURE").map(r => r.id).sort()).toEqual([
      "billing.webhook", "conversations.webhook", "logistics.provider.webhook",
    ]);
  });
});
