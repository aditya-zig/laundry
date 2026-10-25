import { z } from "zod";
import { errorCodeSchema } from "./common.js";
import { getWireSchema, type WireSchemaName } from "./wire.js";

export const routeIdSchema = z.string().trim().min(1);
export type RouteId = z.infer<typeof routeIdSchema>;

/** A route is either public or restricted to one or more actor roles. */
export const routeRoleSchema = z.enum([
  "PUBLIC",
  "PROVIDER",
  "CUSTOMER",
  "RIDER",
  "FACILITY",
  "OPERATOR",
  "SUPPORT",
  "ADMIN",
]);
export type RouteRole = z.infer<typeof routeRoleSchema>;

export const routeEntrySchema = z.object({
  id: routeIdSchema,
  method: z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]),
  path: z.string().regex(/^\/v2(?:\/[a-zA-Z0-9_{}.-]+)*$/),
  summary: z.string().trim().min(1),
  requestSchema: z.string().trim().min(1).optional(),
  responseSchema: z.string().trim().min(1),
  roles: z.array(routeRoleSchema).min(1),
  authentication: z.enum(["PUBLIC", "SESSION", "PROVIDER_SIGNATURE"]),
  idempotency: z.enum(["REQUIRED", "OPTIONAL", "NOT_APPLICABLE", "PROVIDER_EVENT"]),
  errorCodes: z.array(errorCodeSchema).min(1),
  ownerTask: z.string().trim().min(1),
  status: z.enum(["PUBLISHED", "DRAFT"]),
});
export type RouteEntry = z.infer<typeof routeEntrySchema>;

export const routeRegistrySchema = z
  .array(routeEntrySchema)
  .superRefine((routes: z.infer<typeof routeEntrySchema>[], ctx) => {
    const seen = new Set<string>();
    const ids = new Set<string>();
    routes.forEach((route, index) => {
      const key = `${route.method} ${route.path}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "path"],
          message: "A route cannot duplicate another method and path pair.",
        });
      }
      seen.add(key);
      if (ids.has(route.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "id"], message: "Route IDs must be unique." });
      }
      ids.add(route.id);
    });
  });
export type RouteRegistry = z.infer<typeof routeRegistrySchema>;

const customer = ["CUSTOMER"] as const;
const publicRoles = ["PUBLIC"] as const;
const staff = ["OPERATOR", "SUPPORT", "ADMIN"] as const;
const operator = ["OPERATOR", "ADMIN"] as const;
const rider = ["RIDER"] as const;
const authenticated = ["CUSTOMER", "RIDER", "FACILITY", "OPERATOR", "SUPPORT", "ADMIN"] as const;
const fulfillment = ["FACILITY", "OPERATOR", "ADMIN"] as const;
const system = ["PROVIDER"] as const;

type RouteDefinition = {
  id: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  summary: string;
  requestSchema?: WireSchemaName;
  responseSchema: WireSchemaName;
  roles: readonly ("PUBLIC" | "PROVIDER" | "CUSTOMER" | "RIDER" | "FACILITY" | "OPERATOR" | "SUPPORT" | "ADMIN")[];
  idempotency: "REQUIRED" | "OPTIONAL" | "NOT_APPLICABLE" | "PROVIDER_EVENT";
  errorCodes: readonly string[];
  ownerTask: string;
  status: "PUBLISHED" | "DRAFT";
};

function route<Id extends string>(definition: RouteDefinition & { id: Id }): RouteEntry & { id: Id } {
  const parsed = routeEntrySchema.parse({
    ...definition,
    authentication: definition.roles.includes("PROVIDER") ? "PROVIDER_SIGNATURE" : definition.roles.includes("PUBLIC") ? "PUBLIC" : "SESSION",
    roles: [...definition.roles],
    // Operational failures/rate limits are part of every route's wire
    // boundary, not evidence that a runtime handler or provider is enabled.
    errorCodes: [...new Set([...definition.errorCodes, 'PROVIDER_UNAVAILABLE', 'PROVIDER_OUTCOME_UNKNOWN', 'RATE_LIMITED'])],
  });
  getWireSchema(parsed.responseSchema);
  if (parsed.requestSchema) getWireSchema(parsed.requestSchema);
  return { ...parsed, id: definition.id };
}

export const ROUTE_REGISTRY = [
  route({ id: "identity.otp.request", method: "POST", path: "/v2/identity/otp", summary: "Request a sign-in OTP", requestSchema: "OtpRequest", responseSchema: "OtpChallenge", roles: publicRoles, idempotency: "REQUIRED", errorCodes: ["INVALID_INPUT", "RATE_LIMITED"], ownerTask: "B01", status: "PUBLISHED" }),
  route({ id: "identity.otp.verify", method: "POST", path: "/v2/identity/otp/verify", summary: "Verify a sign-in OTP", requestSchema: "OtpVerify", responseSchema: "Session", roles: publicRoles, idempotency: "REQUIRED", errorCodes: ["INVALID_INPUT", "UNAUTHENTICATED"], ownerTask: "B01", status: "PUBLISHED" }),
  route({ id: "identity.session.refresh", method: "POST", path: "/v2/identity/session/refresh", summary: "Refresh a session", requestSchema: "SessionRefresh", responseSchema: "Session", roles: publicRoles, idempotency: "REQUIRED", errorCodes: ["UNAUTHENTICATED"], ownerTask: "B01", status: "PUBLISHED" }),
  route({ id: "identity.logout", method: "POST", path: "/v2/identity/logout", summary: "Log out the current session", responseSchema: "LogoutResult", roles: authenticated, idempotency: "REQUIRED", errorCodes: ["UNAUTHENTICATED"], ownerTask: "B01", status: "PUBLISHED" }),
  route({ id: "identity.revoke", method: "POST", path: "/v2/identity/sessions/{sessionId}/revoke", summary: "Revoke a session", responseSchema: "SessionRevocation", roles: authenticated, idempotency: "REQUIRED", errorCodes: ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"], ownerTask: "B01", status: "PUBLISHED" }),
  route({ id: "identity.me", method: "GET", path: "/v2/identity/me", summary: "Get the authenticated actor", responseSchema: "Actor", roles: authenticated, idempotency: "NOT_APPLICABLE", errorCodes: ["UNAUTHENTICATED"], ownerTask: "B01", status: "PUBLISHED" }),
  route({ id: "identity.staff.invite", method: "POST", path: "/v2/identity/staff/invitations", summary: "Invite a staff member", requestSchema: "StaffInvitation", responseSchema: "StaffInvitationResult", roles: operator, idempotency: "REQUIRED", errorCodes: ["FORBIDDEN", "INVALID_INPUT"], ownerTask: "B01", status: "PUBLISHED" }),
  route({ id: "identity.staff.mfa", method: "POST", path: "/v2/identity/staff/mfa", summary: "Configure staff MFA", requestSchema: "StaffMfaSetup", responseSchema: "StaffMfaResult", roles: [...fulfillment, "SUPPORT"], idempotency: "REQUIRED", errorCodes: ["FORBIDDEN", "UNAUTHENTICATED"], ownerTask: "B01", status: "PUBLISHED" }),
  route({ id: "identity.address.create", method: "POST", path: "/v2/identity/addresses", summary: "Create a customer address", requestSchema: "AddressInput", responseSchema: "Address", roles: customer, idempotency: "REQUIRED", errorCodes: ["INVALID_INPUT"], ownerTask: "B01", status: "PUBLISHED" }),
  route({ id: "identity.address.list", method: "GET", path: "/v2/identity/addresses", summary: "List owned addresses", responseSchema: "AddressList", roles: customer, idempotency: "NOT_APPLICABLE", errorCodes: ["UNAUTHENTICATED"], ownerTask: "B01", status: "PUBLISHED" }),
  route({ id: "identity.address.update", method: "PATCH", path: "/v2/identity/addresses/{addressId}", summary: "Update an owned address", requestSchema: "AddressUpdate", responseSchema: "Address", roles: customer, idempotency: "REQUIRED", errorCodes: ["NOT_FOUND", "VERSION_CONFLICT"], ownerTask: "B01", status: "PUBLISHED" }),
  route({ id: "identity.address.delete", method: "DELETE", path: "/v2/identity/addresses/{addressId}", summary: "Delete an owned address", requestSchema: "AddressDelete", responseSchema: "DeleteResult", roles: customer, idempotency: "REQUIRED", errorCodes: ["NOT_FOUND", "VERSION_CONFLICT"], ownerTask: "B01", status: "PUBLISHED" }),
  route({ id: "identity.whatsapp.link", method: "POST", path: "/v2/identity/whatsapp/link", summary: "Link a verified WhatsApp number", requestSchema: "WhatsAppLink", responseSchema: "WhatsAppLinkResult", roles: customer, idempotency: "REQUIRED", errorCodes: ["UNAUTHENTICATED", "VERSION_CONFLICT"], ownerTask: "B01", status: "PUBLISHED" }),

route({ id: "catalog.services.list", method: "GET", path: "/v2/catalog/services", summary: "List public services", responseSchema: "ServiceList", roles: publicRoles, idempotency: "NOT_APPLICABLE", errorCodes: ["INVALID_INPUT"], ownerTask: "B02", status: "PUBLISHED" }),
  route({ id: "catalog.services.detail", method: "GET", path: "/v2/catalog/services/{serviceId}", summary: "Get public service details", responseSchema: "Service", roles: publicRoles, idempotency: "NOT_APPLICABLE", errorCodes: ["NOT_FOUND"], ownerTask: "B02", status: "PUBLISHED" }),
  route({ id: "catalog.garments", method: "GET", path: "/v2/catalog/garments/eligibility", summary: "Check garment eligibility", responseSchema: "GarmentEligibilityList", roles: publicRoles, idempotency: "NOT_APPLICABLE", errorCodes: ["INVALID_INPUT"], ownerTask: "B02", status: "PUBLISHED" }),
  route({ id: "catalog.rates.effective", method: "GET", path: "/v2/catalog/rates/effective", summary: "Get effective public rates", responseSchema: "EffectiveRateSummary", roles: publicRoles, idempotency: "NOT_APPLICABLE", errorCodes: ["NOT_FOUND"], ownerTask: "B02", status: "PUBLISHED" }),
  route({ id: "catalog.services.write", method: "PATCH", path: "/v2/ops/catalog/services/{serviceId}", summary: "Update a service", requestSchema: "ServiceUpdate", responseSchema: "Service", roles: operator, idempotency: "REQUIRED", errorCodes: ["FORBIDDEN", "VERSION_CONFLICT"], ownerTask: "B02", status: "PUBLISHED" }),
  route({ id: "catalog.rate-cards.create", method: "POST", path: "/v2/ops/catalog/rate-cards", summary: "Create a draft rate card", requestSchema: "RateCardInput", responseSchema: "RateCard", roles: operator, idempotency: "REQUIRED", errorCodes: ["INVALID_INPUT", "VERSION_CONFLICT"], ownerTask: "B02", status: "PUBLISHED" }),
  route({ id: "catalog.rate-cards.approve", method: "POST", path: "/v2/ops/catalog/rate-cards/{rateCardId}/approve", summary: "Approve a rate card", requestSchema: "VersionedReason", responseSchema: "RateCard", roles: operator, idempotency: "REQUIRED", errorCodes: ["FORBIDDEN", "VERSION_CONFLICT"], ownerTask: "B02", status: "PUBLISHED" }),
  route({ id: "catalog.rate-cards.activate", method: "POST", path: "/v2/ops/catalog/rate-cards/{rateCardId}/activate", summary: "Activate an approved rate card", requestSchema: "VersionedReason", responseSchema: "RateCard", roles: operator, idempotency: "REQUIRED", errorCodes: ["FORBIDDEN", "VERSION_CONFLICT"], ownerTask: "B02", status: "PUBLISHED" }),

route({ id: "availability.area", method: "GET", path: "/v2/availability/areas/{postalCode}", summary: "Check service availability by postal code", responseSchema: "ServiceArea", roles: publicRoles, idempotency: "NOT_APPLICABLE", errorCodes: ["NOT_FOUND"], ownerTask: "B03", status: "PUBLISHED" }),
  route({ id: "availability.slots", method: "GET", path: "/v2/availability/slots", summary: "List pickup and return slot pairs", responseSchema: "SlotPairList", roles: publicRoles, idempotency: "NOT_APPLICABLE", errorCodes: ["INVALID_INPUT", "NOT_FOUND"], ownerTask: "B03", status: "PUBLISHED" }),
  route({ id: "availability.calendar", method: "GET", path: "/v2/ops/availability/calendar", summary: "View the operations calendar", responseSchema: "OperationsCalendar", roles: staff, idempotency: "NOT_APPLICABLE", errorCodes: ["FORBIDDEN"], ownerTask: "B03", status: "PUBLISHED" }),
  route({ id: "availability.capacity", method: "PUT", path: "/v2/ops/availability/capacity", summary: "Set slot capacity", requestSchema: "CapacityUpdate", responseSchema: "CapacityResult", roles: operator, idempotency: "REQUIRED", errorCodes: ["FORBIDDEN", "VERSION_CONFLICT"], ownerTask: "B03", status: "PUBLISHED" }),

route({ id: "orders.quote", method: "POST", path: "/v2/orders/quotes", summary: "Price a basket using server rate cards", requestSchema: "QuoteInput", responseSchema: "Quote", roles: customer, idempotency: "REQUIRED", errorCodes: ["INVALID_INPUT", "NOT_FOUND"], ownerTask: "B04", status: "PUBLISHED" }),
  route({ id: "orders.book", method: "POST", path: "/v2/orders", summary: "Book an order from a valid quote", requestSchema: "BookingInput", responseSchema: "Order", roles: customer, idempotency: "REQUIRED", errorCodes: ["VERSION_CONFLICT", "INVALID_INPUT"], ownerTask: "B04", status: "PUBLISHED" }),
  route({ id: "orders.list", method: "GET", path: "/v2/orders", summary: "List owned orders", responseSchema: "OrderPage", roles: customer, idempotency: "NOT_APPLICABLE", errorCodes: ["UNAUTHENTICATED"], ownerTask: "B04", status: "PUBLISHED" }),
  route({ id: "orders.detail", method: "GET", path: "/v2/orders/{orderId}", summary: "Get an owned order", responseSchema: "Order", roles: customer, idempotency: "NOT_APPLICABLE", errorCodes: ["NOT_FOUND", "FORBIDDEN"], ownerTask: "B04", status: "PUBLISHED" }),
  route({ id: "orders.timeline", method: "GET", path: "/v2/orders/{orderId}/timeline", summary: "Get an order timeline", responseSchema: "OrderTimeline", roles: customer, idempotency: "NOT_APPLICABLE", errorCodes: ["NOT_FOUND", "FORBIDDEN"], ownerTask: "B04", status: "PUBLISHED" }),
  route({ id: "orders.cancel", method: "POST", path: "/v2/orders/{orderId}/cancel", summary: "Cancel an eligible order", requestSchema: "OrderCancellation", responseSchema: "Order", roles: customer, idempotency: "REQUIRED", errorCodes: ["VERSION_CONFLICT", "FORBIDDEN"], ownerTask: "B04", status: "PUBLISHED" }),
  route({ id: "orders.reschedule", method: "POST", path: "/v2/orders/{orderId}/reschedule", summary: "Reschedule an eligible order", requestSchema: "OrderReschedule", responseSchema: "Order", roles: customer, idempotency: "REQUIRED", errorCodes: ["VERSION_CONFLICT", "FORBIDDEN"], ownerTask: "B04", status: "PUBLISHED" }),
  route({ id: "orders.adjustment.decide", method: "POST", path: "/v2/orders/{orderId}/adjustments/decision", summary: "Record an adjustment decision", requestSchema: "AdjustmentDecision", responseSchema: "Order", roles: customer, idempotency: "REQUIRED", errorCodes: ["VERSION_CONFLICT", "FORBIDDEN"], ownerTask: "B04", status: "PUBLISHED" }),
  route({ id: "orders.ops.queue", method: "GET", path: "/v2/ops/orders/queue", summary: "List the operations order queue", responseSchema: "OrderQueue", roles: [...fulfillment, "SUPPORT"], idempotency: "NOT_APPLICABLE", errorCodes: ["FORBIDDEN"], ownerTask: "B04", status: "PUBLISHED" }),
  route({ id: "orders.ops.intake", method: "POST", path: "/v2/ops/orders/{orderId}/intake", summary: "Record measured intake", requestSchema: "IntakeRecord", responseSchema: "Order", roles: fulfillment, idempotency: "REQUIRED", errorCodes: ["VERSION_CONFLICT", "INVALID_INPUT"], ownerTask: "B04", status: "PUBLISHED" }),
  route({ id: "orders.ops.care", method: "POST", path: "/v2/ops/orders/{orderId}/care", summary: "Record care progress", requestSchema: "CareUpdate", responseSchema: "Order", roles: fulfillment, idempotency: "REQUIRED", errorCodes: ["VERSION_CONFLICT"], ownerTask: "B04", status: "PUBLISHED" }),
  route({ id: "orders.ops.qc", method: "POST", path: "/v2/ops/orders/{orderId}/quality-check", summary: "Record a quality check", requestSchema: "QualityCheck", responseSchema: "Order", roles: fulfillment, idempotency: "REQUIRED", errorCodes: ["VERSION_CONFLICT", "INVALID_INPUT"], ownerTask: "B04", status: "PUBLISHED" }),
  route({ id: "orders.ops.hold", method: "POST", path: "/v2/ops/orders/{orderId}/hold", summary: "Place an order on hold", requestSchema: "OrderHold", responseSchema: "Order", roles: operator, idempotency: "REQUIRED", errorCodes: ["VERSION_CONFLICT", "FORBIDDEN"], ownerTask: "B04", status: "PUBLISHED" }),
  route({ id: "orders.ops.exception", method: "POST", path: "/v2/ops/orders/{orderId}/exceptions/resolve", summary: "Resolve an order exception", requestSchema: "ExceptionResolution", responseSchema: "Order", roles: staff, idempotency: "REQUIRED", errorCodes: ["VERSION_CONFLICT", "FORBIDDEN"], ownerTask: "B04", status: "PUBLISHED" }),

route({ id: "billing.obligations", method: "GET", path: "/v2/orders/{orderId}/billing/obligations", summary: "List owned payment obligations", responseSchema: "ObligationList", roles: customer, idempotency: "NOT_APPLICABLE", errorCodes: ["NOT_FOUND", "FORBIDDEN"], ownerTask: "B05", status: "PUBLISHED" }),
  route({ id: "billing.attempts", method: "GET", path: "/v2/orders/{orderId}/billing/attempts", summary: "List owned payment attempts", responseSchema: "PaymentAttemptList", roles: customer, idempotency: "NOT_APPLICABLE", errorCodes: ["NOT_FOUND", "FORBIDDEN"], ownerTask: "B05", status: "PUBLISHED" }),
  route({ id: "billing.receipts", method: "GET", path: "/v2/orders/{orderId}/billing/receipts", summary: "List owned receipts", responseSchema: "ReceiptList", roles: customer, idempotency: "NOT_APPLICABLE", errorCodes: ["NOT_FOUND", "FORBIDDEN"], ownerTask: "B05", status: "PUBLISHED" }),
  route({ id: "billing.refunds", method: "GET", path: "/v2/orders/{orderId}/billing/refunds", summary: "List owned refunds", responseSchema: "RefundList", roles: customer, idempotency: "NOT_APPLICABLE", errorCodes: ["NOT_FOUND", "FORBIDDEN"], ownerTask: "B05", status: "PUBLISHED" }),
  route({ id: "billing.manual.confirm", method: "POST", path: "/v2/ops/billing/obligations/{obligationId}/confirm-manual", summary: "Confirm a manual payment", requestSchema: "ManualPaymentConfirmation", responseSchema: "Receipt", roles: operator, idempotency: "REQUIRED", errorCodes: ["VERSION_CONFLICT", "FORBIDDEN"], ownerTask: "B05", status: "PUBLISHED" }),
  route({ id: "billing.refund.create", method: "POST", path: "/v2/ops/billing/refunds", summary: "Request an authorized refund", requestSchema: "RefundRequest", responseSchema: "Refund", roles: operator, idempotency: "REQUIRED", errorCodes: ["VERSION_CONFLICT", "FORBIDDEN", "INVALID_INPUT"], ownerTask: "B05", status: "PUBLISHED" }),
  route({ id: "billing.reconcile", method: "POST", path: "/v2/ops/billing/reconciliation", summary: "Reconcile payment records", requestSchema: "ReconciliationRequest", responseSchema: "Reconciliation", roles: operator, idempotency: "REQUIRED", errorCodes: ["FORBIDDEN", "INVALID_INPUT"], ownerTask: "B05", status: "PUBLISHED" }),
  route({ id: "billing.webhook", method: "POST", path: "/v2/webhooks/payments/{provider}", summary: "Process a signed payment provider event", requestSchema: "PaymentWebhook", responseSchema: "WebhookResult", roles: system, idempotency: "PROVIDER_EVENT", errorCodes: ["UNAUTHENTICATED", "INVALID_INPUT"], ownerTask: "B05", status: "PUBLISHED" }),

route({ id: "logistics.rider.jobs", method: "GET", path: "/v2/rider/jobs", summary: "List active rider jobs", responseSchema: "RiderJobList", roles: rider, idempotency: "NOT_APPLICABLE", errorCodes: ["FORBIDDEN"], ownerTask: "B06", status: "PUBLISHED" }),
  route({ id: "logistics.rider.job", method: "GET", path: "/v2/rider/jobs/{jobId}", summary: "Get a rider job without custody secrets", responseSchema: "RiderJob", roles: rider, idempotency: "NOT_APPLICABLE", errorCodes: ["NOT_FOUND", "FORBIDDEN"], ownerTask: "B06", status: "PUBLISHED" }),
  route({ id: "logistics.rider.accept", method: "POST", path: "/v2/rider/jobs/{jobId}/accept", summary: "Accept an active rider assignment", requestSchema: "VersionedCommand", responseSchema: "Assignment", roles: rider, idempotency: "REQUIRED", errorCodes: ["VERSION_CONFLICT", "FORBIDDEN"], ownerTask: "B06", status: "PUBLISHED" }),
  route({ id: "logistics.rider.handover", method: "POST", path: "/v2/rider/handovers", summary: "Record custody proof", requestSchema: "RiderHandover", responseSchema: "HandoverResult", roles: rider, idempotency: "REQUIRED", errorCodes: ["VERSION_CONFLICT", "FORBIDDEN", "INVALID_INPUT"], ownerTask: "B06", status: "PUBLISHED" }),
  route({ id: "logistics.rider.exception", method: "POST", path: "/v2/rider/jobs/{jobId}/exception", summary: "Report a delivery exception", requestSchema: "DeliveryException", responseSchema: "LegAttempt", roles: rider, idempotency: "REQUIRED", errorCodes: ["VERSION_CONFLICT", "FORBIDDEN"], ownerTask: "B06", status: "PUBLISHED" }),
  route({ id: "logistics.rider.location", method: "POST", path: "/v2/rider/location", summary: "Report current job location", requestSchema: "RiderLocationReport", responseSchema: "Location", roles: rider, idempotency: "REQUIRED", errorCodes: ["FORBIDDEN", "INVALID_INPUT"], ownerTask: "B06", status: "PUBLISHED" }),
  route({ id: "logistics.ops.assign", method: "POST", path: "/v2/ops/logistics/assignments", summary: "Assign a rider to a leg attempt", requestSchema: "AssignmentInput", responseSchema: "Assignment", roles: operator, idempotency: "REQUIRED", errorCodes: ["VERSION_CONFLICT", "FORBIDDEN"], ownerTask: "B06", status: "PUBLISHED" }),
  route({ id: "logistics.ops.reassign", method: "POST", path: "/v2/ops/logistics/assignments/{assignmentId}/reassign", summary: "Reassign a delivery leg", requestSchema: "ReassignmentInput", responseSchema: "Assignment", roles: operator, idempotency: "REQUIRED", errorCodes: ["VERSION_CONFLICT", "FORBIDDEN"], ownerTask: "B06", status: "PUBLISHED" }),
  route({ id: "logistics.ops.cancel", method: "POST", path: "/v2/ops/logistics/legs/{legAttemptId}/cancel", summary: "Cancel a delivery leg attempt", requestSchema: "LegCancellation", responseSchema: "LegAttempt", roles: operator, idempotency: "REQUIRED", errorCodes: ["VERSION_CONFLICT", "FORBIDDEN"], ownerTask: "B06", status: "PUBLISHED" }),
  route({ id: "logistics.provider.webhook", method: "POST", path: "/v2/webhooks/logistics/{provider}", summary: "Process a signed logistics provider event", requestSchema: "LogisticsWebhook", responseSchema: "WebhookResult", roles: system, idempotency: "PROVIDER_EVENT", errorCodes: ["UNAUTHENTICATED", "INVALID_INPUT"], ownerTask: "B06", status: "PUBLISHED" }),
  route({ id: "logistics.tracking", method: "GET", path: "/v2/orders/{orderId}/tracking", summary: "Get customer-safe order tracking", responseSchema: "CustomerTracking", roles: customer, idempotency: "NOT_APPLICABLE", errorCodes: ["NOT_FOUND", "FORBIDDEN"], ownerTask: "B06", status: "PUBLISHED" }),

route({ id: "media.upload.intent", method: "POST", path: "/v2/media/upload-intents", summary: "Create a scoped media upload intent", requestSchema: "UploadIntent", responseSchema: "UploadIntentResult", roles: authenticated, idempotency: "REQUIRED", errorCodes: ["FORBIDDEN", "INVALID_INPUT"], ownerTask: "B07", status: "PUBLISHED" }),
  route({ id: "media.upload.finalize", method: "POST", path: "/v2/media/{mediaId}/finalize", summary: "Finalize and validate an upload", responseSchema: "MediaReference", roles: authenticated, idempotency: "REQUIRED", errorCodes: ["NOT_FOUND", "FORBIDDEN", "INVALID_INPUT"], ownerTask: "B07", status: "PUBLISHED" }),
  route({ id: "media.download", method: "POST", path: "/v2/media/{mediaId}/download", summary: "Create an authorized short-lived download URL", responseSchema: "MediaDownload", roles: authenticated, idempotency: "REQUIRED", errorCodes: ["NOT_FOUND", "FORBIDDEN"], ownerTask: "B07", status: "PUBLISHED" }),

route({ id: "support.incidents.create", method: "POST", path: "/v2/orders/{orderId}/incidents", summary: "Open an incident for an owned order", requestSchema: "IncidentInput", responseSchema: "Incident", roles: customer, idempotency: "REQUIRED", errorCodes: ["NOT_FOUND", "FORBIDDEN", "INVALID_INPUT"], ownerTask: "B08", status: "PUBLISHED" }),
  route({ id: "support.incidents.list", method: "GET", path: "/v2/incidents", summary: "List owned incidents", responseSchema: "IncidentPage", roles: customer, idempotency: "NOT_APPLICABLE", errorCodes: ["UNAUTHENTICATED"], ownerTask: "B08", status: "PUBLISHED" }),
  route({ id: "support.incidents.messages", method: "POST", path: "/v2/incidents/{incidentId}/messages", summary: "Add a message to an incident", requestSchema: "IncidentMessageInput", responseSchema: "IncidentMessage", roles: [...customer, ...staff], idempotency: "REQUIRED", errorCodes: ["NOT_FOUND", "FORBIDDEN"], ownerTask: "B08", status: "PUBLISHED" }),
  route({ id: "support.incidents.resolve", method: "POST", path: "/v2/ops/incidents/{incidentId}/resolve", summary: "Record an audited incident resolution", requestSchema: "IncidentResolutionInput", responseSchema: "Incident", roles: staff, idempotency: "REQUIRED", errorCodes: ["VERSION_CONFLICT", "FORBIDDEN"], ownerTask: "B08", status: "PUBLISHED" }),
  route({ id: "support.rewash.create", method: "POST", path: "/v2/incidents/{incidentId}/rewash-requests", summary: "Request a rewash without completing the original order", requestSchema: "RewashRequestInput", responseSchema: "RewashRequest", roles: customer, idempotency: "REQUIRED", errorCodes: ["NOT_FOUND", "VERSION_CONFLICT"], ownerTask: "B08", status: "PUBLISHED" }),
  route({ id: "reviews.create", method: "POST", path: "/v2/orders/{orderId}/reviews", summary: "Create one review for an eligible delivered order", requestSchema: "ReviewInput", responseSchema: "Review", roles: customer, idempotency: "REQUIRED", errorCodes: ["VERSION_CONFLICT", "FORBIDDEN", "INVALID_INPUT"], ownerTask: "B08", status: "PUBLISHED" }),
  route({ id: "reviews.moderate", method: "POST", path: "/v2/ops/reviews/{reviewId}/moderation", summary: "Moderate a review publication", requestSchema: "ReviewModerationInput", responseSchema: "Review", roles: staff, idempotency: "REQUIRED", errorCodes: ["NOT_FOUND", "FORBIDDEN", "VERSION_CONFLICT"], ownerTask: "B08", status: "PUBLISHED" }),
  route({ id: "reviews.public", method: "GET", path: "/v2/reviews", summary: "List consented published reviews", responseSchema: "PublicReviewPage", roles: publicRoles, idempotency: "NOT_APPLICABLE", errorCodes: ["INVALID_INPUT"], ownerTask: "B08", status: "PUBLISHED" }),

route({ id: "conversations.webhook", method: "POST", path: "/v2/webhooks/conversations/{provider}", summary: "Receive a verified inbound message", requestSchema: "InboundMessage", responseSchema: "ConversationReply", roles: system, idempotency: "PROVIDER_EVENT", errorCodes: ["UNAUTHENTICATED", "INVALID_INPUT"], ownerTask: "B09", status: "PUBLISHED" }),
  route({ id: "conversations.confirm", method: "POST", path: "/v2/conversations/drafts/{draftId}/confirm", summary: "Confirm the current draft revision and quote version", requestSchema: "DraftConfirmation", responseSchema: "Order", roles: customer, idempotency: "REQUIRED", errorCodes: ["VERSION_CONFLICT", "INVALID_INPUT"], ownerTask: "B09", status: "PUBLISHED" }),
  route({ id: "conversations.optout", method: "POST", path: "/v2/conversations/opt-out", summary: "Opt out of automated conversations", requestSchema: "ConversationOptOut", responseSchema: "OptOutResult", roles: customer, idempotency: "REQUIRED", errorCodes: ["INVALID_INPUT"], ownerTask: "B09", status: "PUBLISHED" }),
  route({ id: "conversations.handoff", method: "POST", path: "/v2/ops/conversations/{draftId}/handoff", summary: "Assign a conversation to an operator", requestSchema: "ConversationHandoff", responseSchema: "ConversationDraft", roles: staff, idempotency: "REQUIRED", errorCodes: ["NOT_FOUND", "VERSION_CONFLICT", "FORBIDDEN"], ownerTask: "B09", status: "PUBLISHED" }),

route({ id: "jobs.dead-letter.list", method: "GET", path: "/v2/ops/jobs/dead-letter", summary: "List dead-letter jobs", responseSchema: "JobPage", roles: operator, idempotency: "NOT_APPLICABLE", errorCodes: ["FORBIDDEN"], ownerTask: "B10", status: "PUBLISHED" }),
  route({ id: "jobs.replay", method: "POST", path: "/v2/ops/jobs/{jobId}/replay", summary: "Replay a dead-letter job", requestSchema: "JobReplay", responseSchema: "Job", roles: operator, idempotency: "REQUIRED", errorCodes: ["NOT_FOUND", "VERSION_CONFLICT", "FORBIDDEN"], ownerTask: "B10", status: "PUBLISHED" }),
  route({ id: "jobs.health", method: "GET", path: "/v2/ops/jobs/health", summary: "View job queue health", responseSchema: "JobHealth", roles: operator, idempotency: "NOT_APPLICABLE", errorCodes: ["FORBIDDEN"], ownerTask: "B10", status: "PUBLISHED" }),

  // Customer-owned billing and tracking reads. The order view never embeds
  // the money state, so the customer asks for it explicitly.
  route({ id: "billing.obligations.list", method: "GET", path: "/v2/billing/obligations", summary: "List the obligations of the signed in customer", responseSchema: "ObligationPage", roles: customer, idempotency: "NOT_APPLICABLE", errorCodes: ["UNAUTHENTICATED", "INVALID_INPUT"], ownerTask: "B05", status: "PUBLISHED" }),
  route({ id: "billing.obligation.read", method: "GET", path: "/v2/billing/obligations/{obligationId}", summary: "Read one obligation with its attempts and receipts", responseSchema: "BillingSummary", roles: customer, idempotency: "NOT_APPLICABLE", errorCodes: ["UNAUTHENTICATED", "NOT_FOUND"], ownerTask: "B05", status: "PUBLISHED" }),
  route({ id: "billing.receipts.list", method: "GET", path: "/v2/billing/obligations/{obligationId}/receipts", summary: "List the receipts of one obligation", responseSchema: "ReceiptPage", roles: customer, idempotency: "NOT_APPLICABLE", errorCodes: ["UNAUTHENTICATED", "NOT_FOUND"], ownerTask: "B05", status: "PUBLISHED" }),
  route({ id: "billing.refunds.list", method: "GET", path: "/v2/billing/refunds", summary: "List the refunds of the signed in customer", responseSchema: "RefundPage", roles: customer, idempotency: "NOT_APPLICABLE", errorCodes: ["UNAUTHENTICATED", "INVALID_INPUT"], ownerTask: "B05", status: "PUBLISHED" }),
  route({ id: "logistics.tracking.read", method: "GET", path: "/v2/logistics/tracking/{orderId}", summary: "Read the customer tracking view of one order", responseSchema: "CustomerTracking", roles: customer, idempotency: "NOT_APPLICABLE", errorCodes: ["UNAUTHENTICATED", "NOT_FOUND"], ownerTask: "B06", status: "PUBLISHED" }),
  route({ id: "orders.custody-receipt", method: "GET", path: "/v2/orders/{orderId}/custody-receipt", summary: "Read the owned order custody receipt", responseSchema: "CustodyReceipt", roles: customer, idempotency: "NOT_APPLICABLE", errorCodes: ["NOT_FOUND", "FORBIDDEN"], ownerTask: "B06", status: "PUBLISHED" }),
  route({ id: "support.incidents.messages.list", method: "GET", path: "/v2/incidents/{incidentId}/messages", summary: "Read authorized incident messages", responseSchema: "IncidentMessagePage", roles: [...customer, ...staff], idempotency: "NOT_APPLICABLE", errorCodes: ["NOT_FOUND", "FORBIDDEN"], ownerTask: "B08", status: "PUBLISHED" }),
  route({ id: "reviews.eligibility", method: "GET", path: "/v2/reviews/eligibility/{orderId}", summary: "Read review eligibility for an owned order", responseSchema: "ReviewEligibility", roles: customer, idempotency: "NOT_APPLICABLE", errorCodes: ["NOT_FOUND", "FORBIDDEN"], ownerTask: "B08", status: "PUBLISHED" }),
] satisfies RouteRegistry;

export type RouteOperationId = typeof ROUTE_REGISTRY[number]["id"];

routeRegistrySchema.parse(ROUTE_REGISTRY);

/** Resolve a registry operation without allowing unresolved or unused path parameters. */
export function resolveRoute(id: string, params: Record<string, string> = {}): RouteEntry {
  const entry = ROUTE_REGISTRY.find(route => route.id === id);
  if (!entry) throw new Error(`Unknown route ID: ${id}`);
  const used = new Set<string>();
  const path = entry.path.replace(/\{([^}]+)\}/g, (_, key: string) => {
    if (!Object.hasOwn(params, key)) throw new Error(`Missing route parameter: ${key}`);
    const value = params[key];
    if (!value || value === "." || value === "..") throw new Error(`Invalid route parameter: ${key}`);
    used.add(key);
    return encodeURIComponent(value);
  });
  for (const key of Object.keys(params)) {
    if (!used.has(key)) throw new Error(`Unused route parameter: ${key}`);
  }
  return { ...entry, path };
}
