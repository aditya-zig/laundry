import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Wandary Convex schema. SDK logical IDs are UUID strings stored in a
// separate `lid` field and looked up through indexes. Convex document IDs
// are never exposed on the wire.

const windowValidator = v.object({
  start: v.string(),
  end: v.string(),
  timezone: v.string(),
});

export default defineSchema({
  identities: defineTable({
    lid: v.string(),
    role: v.string(),
    name: v.string(),
    phone: v.string(),
  })
    .index("by_lid", ["lid"])
    .index("by_phone", ["phone"]),

  sessions: defineTable({
    token: v.string(),
    userId: v.string(),
    expiresAt: v.string(),
    createdAt: v.string(),
  })
    .index("by_token", ["token"])
    .index("by_user", ["userId"]),

  otpChallenges: defineTable({
    lid: v.string(),
    phone: v.string(),
    code: v.string(),
    expiresAt: v.string(),
    attempts: v.number(),
    consumed: v.boolean(),
  }).index("by_lid", ["lid"]),

  addresses: defineTable({
    lid: v.string(),
    ownerId: v.string(),
    label: v.string(),
    line1: v.string(),
    city: v.string(),
    postalCode: v.string(),
    version: v.number(),
    deleted: v.boolean(),
  })
    .index("by_lid", ["lid"])
    .index("by_owner", ["ownerId"]),

  services: defineTable({
    lid: v.string(),
    code: v.string(),
    name: v.string(),
    description: v.string(),
    imageUrl: v.string(),
    priceMinor: v.number(),
    priceUnit: v.string(),
    turnaroundHours: v.number(),
    garments: v.array(
      v.object({ lid: v.string(), name: v.string(), priceMinor: v.number() })
    ),
    features: v.array(v.string()),
    active: v.boolean(),
  }).index("by_lid", ["lid"]),

  rateCards: defineTable({
    lid: v.string(),
    version: v.number(),
    currency: v.string(),
  }).index("by_version", ["version"]),

  quotes: defineTable({
    lid: v.string(),
    version: v.number(),
    customerId: v.string(),
    addressId: v.string(),
    lines: v.any(),
    breakdown: v.any(),
    totalMinor: v.number(),
    currency: v.string(),
    provisional: v.boolean(),
    pickupWindow: windowValidator,
    promisedReturn: windowValidator,
    rateCardId: v.optional(v.string()),
    rateCardVersion: v.number(),
    holdId: v.string(),
    expiresAt: v.string(),
  })
    .index("by_lid", ["lid"])
    .index("by_customer", ["customerId"]),

  capacityBuckets: defineTable({
    key: v.string(),
    windowStart: v.string(),
    windowEnd: v.string(),
    capacityTotal: v.number(),
  }).index("by_key", ["key"]),

  capacityHolds: defineTable({
    lid: v.string(),
    bucketKey: v.string(),
    quoteId: v.optional(v.string()),
    expiresAt: v.string(),
    released: v.boolean(),
  })
    .index("by_lid", ["lid"])
    .index("by_bucket", ["bucketKey"])
    .index("by_quote", ["quoteId"]),

  orders: defineTable({
    lid: v.string(),
    version: v.number(),
    customerId: v.string(),
    quoteId: v.string(),
    status: v.string(),
    lines: v.any(),
    totalMinor: v.number(),
    currency: v.string(),
    pickupWindow: windowValidator,
    promisedReturn: windowValidator,
    addressSnapshot: v.any(),
    paymentStatus: v.string(),
    pickupOtp: v.string(),
    returnOtp: v.string(),
    adjustment: v.optional(v.any()),
    facilityId: v.optional(v.string()),
    createdAt: v.string(),
  })
    .index("by_lid", ["lid"])
    .index("by_customer", ["customerId"])
    .index("by_quote", ["quoteId"]),

  orderTimeline: defineTable({
    orderId: v.string(),
    status: v.string(),
    label: v.string(),
    at: v.string(),
  }).index("by_order", ["orderId"]),

  payments: defineTable({
    lid: v.string(),
    orderId: v.string(),
    quoteId: v.string(),
    purpose: v.string(),
    amountMinor: v.number(),
    currency: v.string(),
    status: v.string(),
    provider: v.string(),
    paymentUrl: v.string(),
    expiresAt: v.string(),
  })
    .index("by_lid", ["lid"])
    .index("by_order", ["orderId"]),

  deliveryJobs: defineTable({
    lid: v.string(),
    orderId: v.string(),
    leg: v.string(),
    attempt: v.number(),
    status: v.string(),
    version: v.number(),
    customerName: v.string(),
    address: v.string(),
    window: windowValidator,
    bagIds: v.array(v.string()),
    provider: v.string(),
    dispatchMode: v.string(),
    capabilities: v.array(v.string()),
    assignedTo: v.optional(v.string()),
  })
    .index("by_lid", ["lid"])
    .index("by_order", ["orderId"])
    .index("by_assignee", ["assignedTo"]),

  handoverActions: defineTable({
    actionId: v.string(),
    jobId: v.string(),
    method: v.string(),
    proofRef: v.optional(v.string()),
  })
    .index("by_action", ["actionId"])
    .index("by_job", ["jobId"]),

  refunds: defineTable({
    lid: v.string(),
    orderId: v.string(),
    paymentId: v.string(),
    obligationId: v.optional(v.string()),
    amountMinor: v.number(),
    reason: v.string(),
    status: v.string(),
  })
    .index("by_lid", ["lid"])
    .index("by_order", ["orderId"]),

  refundObligations: defineTable({
    lid: v.string(),
    orderId: v.string(),
    amountMinor: v.number(),
    reason: v.string(),
    status: v.string(),
  }).index("by_order", ["orderId"]),

  reviews: defineTable({
    lid: v.string(),
    orderId: v.string(),
    customerId: v.string(),
    overall: v.number(),
    serviceScore: v.optional(v.number()),
    deliveryScore: v.optional(v.number()),
    comment: v.optional(v.string()),
    mediaIds: v.array(v.string()),
    consent: v.boolean(),
    status: v.string(),
    version: v.number(),
    createdAt: v.string(),
  })
    .index("by_lid", ["lid"])
    .index("by_order", ["orderId"]),

  supportIncidents: defineTable({
    lid: v.string(),
    orderId: v.string(),
    customerId: v.string(),
    status: v.string(),
    messages: v.any(),
    createdAt: v.string(),
  })
    .index("by_lid", ["lid"])
    .index("by_order", ["orderId"])
    .index("by_customer", ["customerId"]),

  conversationDrafts: defineTable({
    lid: v.string(),
    revision: v.number(),
    customerId: v.optional(v.string()),
    conversationKey: v.string(),
    fields: v.any(),
    quoteId: v.optional(v.string()),
    state: v.string(),
    expiresAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_lid", ["lid"])
    .index("by_key", ["conversationKey"]),

  conversationMessages: defineTable({
    lid: v.string(),
    providerMessageId: v.optional(v.string()),
    draftId: v.string(),
    sender: v.string(),
    text: v.string(),
    transcript: v.optional(v.string()),
    createdAt: v.string(),
  })
    .index("by_lid", ["lid"])
    .index("by_provider_msg", ["providerMessageId"])
    .index("by_draft", ["draftId"]),

  idempotencyRecords: defineTable({
    scope: v.string(),
    key: v.string(),
    actorId: v.string(),
    requestHash: v.string(),
    response: v.any(),
  }).index("by_scope_key", ["scope", "key"]),

  webhookInbox: defineTable({
    eventId: v.string(),
  }).index("by_event", ["eventId"]),

  outbox: defineTable({
    aggregateId: v.string(),
    eventType: v.string(),
    payload: v.any(),
    createdAt: v.string(),
  }).index("by_aggregate", ["aggregateId"]),
});
