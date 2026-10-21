// Laundry Convex HTTP transport. Thin router only: every /v1 REST call is
// forwarded to the frozen internal.engine.dispatch mutation with
// { method, path, token, body, idempotencyKey }, and the engine's
// { status, body } is returned verbatim. This file owns no business logic,
// no auth decisions, and no provider integrations.

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const MAX_BODY_BYTES = 15_000_000;

const LOCAL_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:8081",
  "http://localhost:8082",
  "http://localhost:5173",
  "http://localhost:19006",
];

function parseOriginList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function allowedOrigins(): string[] {
  const plural = parseOriginList(process.env.CORS_ORIGINS);
  const singular = parseOriginList(process.env.CORS_ORIGIN);
  const alias = parseOriginList(process.env.FRONTEND_URL);
  return [...(demoMode() ? LOCAL_ORIGINS : []), ...plural, ...singular, ...alias];
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key",
    Vary: "Origin",
  };
  if (origin) {
    const normalized = origin.replace(/\/$/, "");
    if (allowedOrigins().includes(normalized)) {
      headers["Access-Control-Allow-Origin"] = normalized;
    }
  }
  return headers;
}

function envelope(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>
): { status: number; body: Record<string, unknown> } {
  return {
    status,
    body: {
      code,
      message,
      traceId: crypto.randomUUID(),
      retryable: status >= 500 || status === 429,
      ...(extra ?? {}),
    },
  };
}

function jsonResponse(
  status: number,
  body: unknown,
  cors: Record<string, string>
): Response {
  return new Response(JSON.stringify(body ?? null), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

function demoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}

function providerReadiness() {
  const razorpay =
    Boolean(process.env.RAZORPAY_KEY_ID) &&
    Boolean(process.env.RAZORPAY_KEY_SECRET);
  const whatsapp =
    Boolean(process.env.WHATSAPP_TOKEN) &&
    Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID) &&
    Boolean(process.env.WHATSAPP_APP_SECRET);
  return { razorpay, whatsapp };
}

function healthBody() {
  const demo = demoMode();
  const providers = providerReadiness();
  return {
    ok: true,
    service: "laundry-convex-http",
    demoMode: demo,
    providers: {
      razorpayConfigured: providers.razorpay,
      whatsappConfigured: providers.whatsapp,
    },
    liveReady: false,
    missingCapabilities: ["live-auth", "payment-dispatch", "whatsapp-dispatch", "voice-transcription", "rider-provider"],
    note: demo
      ? "Demo transport: demo auth, demo capture, and manual dispatch only. Live provider lanes are not configured."
      : "Live mode: demo lanes are disabled. Webhook, media, and voice lanes require provider credentials and are rejected honestly when unconfigured.",
  };
}

function isWebhookPath(path: string): boolean {
  return path === "/v1/webhooks/whatsapp" || path.startsWith("/v1/webhooks/");
}

function isMediaPath(path: string): boolean {
  return path.startsWith("/v1/media/");
}

function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (!header) return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() || undefined : undefined;
}

const v1Handler = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const path = url.pathname;
  const fullPath = url.search ? `${url.pathname}${url.search}` : url.pathname;
  const method = request.method.toUpperCase();
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin);

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...cors } });
  }

  if (method === "GET" && (path === "/v1/health" || path === "/health")) {
    return jsonResponse(200, healthBody(), cors);
  }

  // WhatsApp verification handshake is transport-level, not engine state.
  // It succeeds only against the configured verify token; anything else is
  // rejected honestly and no webhook is faked.
  if (path === "/v1/webhooks/whatsapp" && method === "GET") {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!verifyToken) {
      const rejected = envelope(
        502,
        "PROVIDER_UNAVAILABLE",
        "WhatsApp webhook not configured"
      );
      return jsonResponse(rejected.status, rejected.body, cors);
    }
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode !== "subscribe" || token !== verifyToken || !challenge) {
      const rejected = envelope(403, "FORBIDDEN", "Bad verify token");
      return jsonResponse(rejected.status, rejected.body, cors);
    }
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain", ...cors },
    });
  }

  // Live provider lanes are never simulated. The frozen dispatch args carry
  // no raw-body or signature fields, so this transport cannot verify HMAC
  // before parsing; it rejects honestly instead of inventing success.
  if (
    (isWebhookPath(path) || isMediaPath(path)) &&
    !(path === "/v1/webhooks/whatsapp" && method === "GET")
  ) {
    const rejected = envelope(
      501,
      "PROVIDER_UNAVAILABLE",
      "This lane needs provider credentials plus signature-verified transport; the Convex engine stores state only and no event was faked."
    );
    return jsonResponse(rejected.status, rejected.body, cors);
  }
  if (path === "/v1/demo/conversations/voice-notes") {
    const rejected = envelope(
      501,
      "PROVIDER_UNAVAILABLE",
      "Voice transcription needs the provider lane with credentials; nothing was transcribed or booked."
    );
    return jsonResponse(rejected.status, rejected.body, cors);
  }

  const idempotencyKey =
    request.headers.get("idempotency-key") ?? undefined;
  const token = bearerToken(request);

  let body: unknown = null;
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    const contentLength = request.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
      const rejected = envelope(
        413,
        "INVALID_INPUT",
        "Request body exceeds the 15 MB limit"
      );
      return jsonResponse(rejected.status, rejected.body, cors);
    }
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      const rejected = envelope(
        413,
        "INVALID_INPUT",
        "Request body exceeds the 15 MB limit"
      );
      return jsonResponse(rejected.status, rejected.body, cors);
    }
    if (raw.length === 0) {
      body = {};
    } else {
      const contentType = request.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        const rejected = envelope(
          400,
          "INVALID_INPUT",
          "Content-Type must be application/json"
        );
        return jsonResponse(rejected.status, rejected.body, cors);
      }
      try {
        body = JSON.parse(raw);
        if (body === null || typeof body !== "object" || Array.isArray(body)) {
          const rejected = envelope(400, "INVALID_INPUT", "Request body must be a JSON object");
          return jsonResponse(rejected.status, rejected.body, cors);
        }
      } catch {
        const rejected = envelope(
          400,
          "INVALID_INPUT",
          "Request body is not valid JSON"
        );
        return jsonResponse(rejected.status, rejected.body, cors);
      }
    }
  }

  try {
    const result: { status: number; body: unknown } = await ctx.runMutation(
      internal.engine.dispatch,
      {
        method,
        path: fullPath,
        token,
        body,
        idempotencyKey,
      }
    );
    return jsonResponse(result.status, result.body, cors);
  } catch (error) {
    const fallback = envelope(
      500,
      "PROVIDER_OUTCOME_UNKNOWN",
      "Internal transport error"
    );
    void error;
    return jsonResponse(fallback.status, fallback.body, cors);
  }
});

const http = httpRouter();

http.route({ pathPrefix: "/v1/", method: "GET", handler: v1Handler });
http.route({ pathPrefix: "/v1/", method: "POST", handler: v1Handler });
http.route({ pathPrefix: "/v1/", method: "PUT", handler: v1Handler });
http.route({ pathPrefix: "/v1/", method: "PATCH", handler: v1Handler });
http.route({ pathPrefix: "/v1/", method: "DELETE", handler: v1Handler });
http.route({ pathPrefix: "/v1/", method: "OPTIONS", handler: v1Handler });
http.route({ path: "/health", method: "GET", handler: v1Handler });
http.route({ path: "/health", method: "OPTIONS", handler: v1Handler });

export default http;
