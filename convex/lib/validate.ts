// Self-contained wire validators. Mirrors packages/contracts/src/schemas.ts
// without importing zod or Node builtins, so the Convex bundler stays happy.

import { EngineError } from "./errors";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(v: unknown, field = "id"): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) {
    throw new EngineError("INVALID_INPUT", `${field} must be a UUID`, {
      status: 400,
      fieldErrors: { [field]: "must be a UUID" },
    });
  }
  return v;
}

export function assertUuidOptional(v: unknown, field = "id"): string | undefined {
  if (v === undefined) return undefined;
  return assertUuid(v, field);
}

function assertInstant(v: unknown, field: string): string {
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) {
    throw new EngineError("INVALID_INPUT", `${field} must be an ISO-8601 instant`, {
      status: 400,
      fieldErrors: { [field]: "must be a datetime" },
    });
  }
  return v;
}

export interface WireWindow {
  start: string;
  end: string;
  timezone: string;
}

export function parseWindow(v: unknown): WireWindow {
  const o = v as Record<string, unknown>;
  if (!o || typeof o !== "object") throw new EngineError("INVALID_INPUT", "window is required", { status: 400 });
  const start = assertInstant(o.start, "pickupWindow.start");
  const end = assertInstant(o.end, "pickupWindow.end");
  if (typeof o.timezone !== "string" || o.timezone.length < 1) {
    throw new EngineError("INVALID_INPUT", "timezone is required", { status: 400 });
  }
  if (!(Date.parse(end) > Date.parse(start))) {
    throw new EngineError("INVALID_INPUT", "Pickup window end must be after start", { status: 400 });
  }
  return { start, end, timezone: o.timezone };
}

export interface QuoteLineInput {
  serviceId: string;
  garmentTypeId: string;
  quantity: number;
  estimatedWeightGrams?: number;
  careNotes?: string;
}

export interface QuoteInput {
  addressId: string;
  lines: QuoteLineInput[];
  pickupWindow: WireWindow;
  requestedReturnBy: string;
  timezone: string;
}

export function parseQuoteInput(body: unknown): QuoteInput {
  const o = body as Record<string, unknown>;
  if (!o || typeof o !== "object") throw new EngineError("INVALID_INPUT", "body is required", { status: 400 });
  const addressId = assertUuid(o.addressId, "addressId");
  const rawLines = o.lines;
  if (!Array.isArray(rawLines) || rawLines.length < 1 || rawLines.length > 20) {
    throw new EngineError("INVALID_INPUT", "Order needs 1..20 lines", { status: 400 });
  }
  const lines: QuoteLineInput[] = rawLines.map((l, i) => {
    const line = l as Record<string, unknown>;
    const serviceId = assertUuid(line?.serviceId, "lines.serviceId");
    const garmentTypeId = assertUuid(line?.garmentTypeId, "lines.garmentTypeId");
    const q = line?.quantity;
    if (typeof q !== "number" || !Number.isInteger(q) || q < 1 || q > 100) {
      throw new EngineError("INVALID_INPUT", "Quantity must be 1..100", {
        status: 400,
        fieldErrors: { [`lines.${i}.quantity`]: "1..100" },
      });
    }
    const w = line?.estimatedWeightGrams;
    if (w !== undefined && (typeof w !== "number" || !Number.isInteger(w) || w < 1 || w > 50000)) {
      throw new EngineError("INVALID_INPUT", "estimatedWeightGrams must be 1..50000", { status: 400 });
    }
    const care = line?.careNotes;
    if (care !== undefined && (typeof care !== "string" || care.length > 500)) {
      throw new EngineError("INVALID_INPUT", "careNotes too long", { status: 400 });
    }
    return {
      serviceId,
      garmentTypeId,
      quantity: q,
      ...(w === undefined ? {} : { estimatedWeightGrams: w }),
      ...(care === undefined ? {} : { careNotes: care }),
    };
  });
  const pickupWindow = parseWindow(o.pickupWindow);
  const requestedReturnBy = assertInstant(o.requestedReturnBy, "requestedReturnBy");
  if (typeof o.timezone !== "string" || o.timezone.length < 1) {
    throw new EngineError("INVALID_INPUT", "timezone is required", { status: 400 });
  }
  return { addressId, lines, pickupWindow, requestedReturnBy, timezone: o.timezone };
}

export function parseCheckout(body: unknown): { quoteId: string; expectedVersion?: number } {
  const o = body as Record<string, unknown>;
  if (!o || typeof o !== "object") throw new EngineError("INVALID_INPUT", "body is required", { status: 400 });
  const quoteId = assertUuid(o.quoteId, "quoteId");
  if (o.expectedVersion !== undefined) {
    if (typeof o.expectedVersion !== "number" || !Number.isInteger(o.expectedVersion) || o.expectedVersion < 1) {
      throw new EngineError("INVALID_INPUT", "expectedVersion must be >= 1", { status: 400 });
    }
    return { quoteId, expectedVersion: o.expectedVersion };
  }
  return { quoteId };
}

export function parseReview(body: unknown) {
  const o = body as Record<string, unknown>;
  if (!o || typeof o !== "object") throw new EngineError("INVALID_INPUT", "body is required", { status: 400 });
  const orderId = assertUuid(o.orderId, "orderId");
  const overall = o.overall;
  if (typeof overall !== "number" || !Number.isInteger(overall) || overall < 1 || overall > 5) {
    throw new EngineError("INVALID_INPUT", "overall must be 1..5", { status: 400 });
  }
  for (const f of ["serviceScore", "deliveryScore"] as const) {
    const s = o[f];
    if (s !== undefined && (typeof s !== "number" || !Number.isInteger(s) || s < 1 || s > 5)) {
      throw new EngineError("INVALID_INPUT", `${f} must be 1..5`, { status: 400 });
    }
  }
  const comment = o.comment;
  if (comment !== undefined && (typeof comment !== "string" || comment.length > 2000)) {
    throw new EngineError("INVALID_INPUT", "comment too long", { status: 400 });
  }
  const mediaIds = (o.mediaIds ?? []) as unknown;
  if (!Array.isArray(mediaIds)) throw new EngineError("INVALID_INPUT", "mediaIds must be an array", { status: 400 });
  for (const m of mediaIds) assertUuid(m, "mediaIds");
  if (typeof o.publishConsent !== "boolean") {
    throw new EngineError("INVALID_INPUT", "publishConsent is required", { status: 400 });
  }
  return {
    orderId,
    overall,
    serviceScore: o.serviceScore as number | undefined,
    deliveryScore: o.deliveryScore as number | undefined,
    comment: comment as string | undefined,
    mediaIds: mediaIds as string[],
    publishConsent: o.publishConsent as boolean,
  };
}

export function parseHandover(body: unknown, jobId: string) {
  const o = body as Record<string, unknown>;
  if (!o || typeof o !== "object") throw new EngineError("INVALID_INPUT", "body is required", { status: 400 });
  const actionId = assertUuid(o.actionId, "actionId");
  const bagIds = o.bagIds;
  if (!Array.isArray(bagIds) || bagIds.length < 1 || bagIds.some((b) => typeof b !== "string" || b.length < 1)) {
    throw new EngineError("INVALID_INPUT", "bagIds must be a non-empty string array", { status: 400 });
  }
  const method = o.method;
  if (method !== "OTP" && method !== "PROVIDER_PROOF" && method !== "OPERATOR_EXCEPTION") {
    throw new EngineError("INVALID_INPUT", "unknown handover method", { status: 400 });
  }
  const expectedVersion = o.expectedVersion;
  if (typeof expectedVersion !== "number" || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new EngineError("INVALID_INPUT", "expectedVersion must be >= 1", { status: 400 });
  }
  const capturedAt = o.capturedAt !== undefined ? assertInstant(o.capturedAt, "capturedAt") : new Date().toISOString();
  return {
    jobId: assertUuid(jobId, "jobId"),
    actionId,
    bagIds: bagIds as string[],
    method: method as "OTP" | "PROVIDER_PROOF" | "OPERATOR_EXCEPTION",
    proofReference: o.proofReference as string | undefined,
    otp: o.otp as string | undefined,
    capturedAt,
    expectedVersion,
  };
}
