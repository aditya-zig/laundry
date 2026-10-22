// Demo-only fixtures. Synthetic IDs, no real personal data. Every value is
// labeled demo so app agents can build against stable shapes before live APIs.
import type { Address, Order, Quote, QuoteInput, Review, Service, Session } from "@laundry/contracts";

export * from "./v2.js";

export const DEMO_LABEL = "demo-only fixture: synthetic data, not a real customer, price, or address";

export const demoServices: Service[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    code: "WASH_PRESS",
    name: "Wash and Press",
    description: "Machine wash, dry, and crisp press for everyday cottons.",
    imageUrl: "https://cdn.example.com/demo/wash-press.jpg",
    priceMinor: 7900,
    priceUnit: "from INR 79 per garment",
    turnaroundHours: 48,
    garments: [
      { id: "22222222-2222-4222-8222-222222222222", name: "Shirt", priceMinor: 7900 },
      { id: "33333333-3333-4333-8333-333333333333", name: "Trouser", priceMinor: 8900 },
    ],
    features: ["Free pickup", "48-hour return", "Starch on request"],
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    code: "DRY_CLEAN",
    name: "Dry Cleaning",
    description: "Solvent care for suits, silks, and winter layers.",
    imageUrl: "https://cdn.example.com/demo/dry-clean.jpg",
    priceMinor: 19900,
    priceUnit: "from INR 199 per garment",
    turnaroundHours: 72,
    garments: [{ id: "55555555-5555-4555-8555-555555555555", name: "Blazer", priceMinor: 19900 }],
    features: ["Stain pre-check", "Garment bag return"],
  },
];

export const demoAddress: Address = {
  id: "66666666-6666-4666-8666-666666666666",
  version: 1,
  ownerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  label: "Home (demo)",
  line1: "14 Demo Lane",
  city: "Bengaluru",
  postalCode: "560001",
};

export const demoQuoteInput: QuoteInput = {
  addressId: demoAddress.id,
  lines: [{ serviceId: demoServices[0].id, garmentTypeId: demoServices[0].garments[0].id, quantity: 5 }],
  pickupWindow: { start: "2026-10-12T09:00:00.000Z", end: "2026-10-12T10:00:00.000Z", timezone: "Asia/Kolkata" },
  requestedReturnBy: "2026-10-17T18:00:00.000Z",
  timezone: "Asia/Kolkata",
};

export const demoQuote: Quote = {
  id: "77777777-7777-4777-8777-777777777777",
  version: 1,
  expiresAt: "2026-10-11T16:00:00.000Z",
  rateCardId: "88888888-8888-4888-8888-888888888888",
  rateCardVersion: 3,
  lines: [{ ...demoQuoteInput.lines[0], unitPriceMinor: 7900, lineTotalMinor: 39500 }],
  totalMinor: 44900,
  currency: "INR",
  provisional: true,
  pickupWindow: demoQuoteInput.pickupWindow,
  promisedReturnWindow: { start: "2026-10-14T09:00:00.000Z", end: "2026-10-14T18:00:00.000Z", timezone: "Asia/Kolkata" },
  breakdown: [
    { label: "5 x Shirt wash and press", amountMinor: 39500 },
    { label: "Pickup fee", amountMinor: 0 },
    { label: "Tax (demo)", amountMinor: 5400 },
  ],
};

export const demoOrder: Order = {
  id: "99999999-9999-4999-8999-999999999999",
  version: 2,
  status: "CONFIRMED",
  customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  facilityId: "12121212-1212-4121-8121-121212121212",
  lines: [{ ...demoQuote.lines[0], orderLineId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
  totalMinor: demoQuote.totalMinor,
  currency: "INR",
  pickupWindow: demoQuote.pickupWindow,
  promisedReturnWindow: demoQuote.promisedReturnWindow,
  createdAt: "2026-10-11T10:00:00.000Z",
  timeline: [
    { status: "AWAITING_PAYMENT", label: "Checkout created", at: "2026-10-11T10:00:00.000Z" },
    { status: "CONFIRMED", label: "Payment captured", at: "2026-10-11T10:05:00.000Z" },
  ],
  paymentStatus: "CAPTURED",
  deliveries: [
    {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      orderId: "99999999-9999-4999-8999-999999999999",
      leg: "PICKUP",
      status: "ASSIGNED",
      version: 1,
      customerName: "Demo Customer",
      address: "14 Demo Lane, Bengaluru 560001",
      window: demoQuoteInput.pickupWindow,
      bagIds: [],
      provider: "manual",
      dispatchMode: "MANUAL",
      capabilities: ["OTP_HANDOVER"],
      assignedTo: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    },
  ],
};

export const demoSession: Session = {
  token: "demo-token-do-not-use-in-production",
  user: { id: demoOrder.customerId, role: "customer", name: "Demo Customer", phone: "+91-90000-00001" },
};

export const demoReview: Review = {
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  orderId: demoOrder.id,
  overall: 5,
  serviceScore: 5,
  deliveryScore: 4,
  comment: "Crisp shirts, on-time demo return.",
  mediaIds: [],
  publishConsent: true,
  version: 1,
  createdAt: "2026-10-11T12:00:00.000Z",
};

export const demoError = {
  code: "VERSION_CONFLICT",
  message: "Expected version 1 but current is 2",
  traceId: "trace-demo-1",
  retryable: false,
};

export const demoConversationReply = {
  draft: {
    draftId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    revision: 2,
    state: "QUOTED",
    quoteId: demoQuote.id,
    expiresAt: "2026-10-12T10:00:00.000Z",
    missingFields: ["addressId"],
  },
  reply: "Demo reply: which address should we pick up from?",
  missingFields: ["addressId"],
};
