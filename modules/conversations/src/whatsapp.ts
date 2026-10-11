import { createHmac, timingSafeEqual } from "node:crypto";

/** Meta Cloud API webhook verification (raw-body HMAC before parsing). */
export function verifyWhatsappSignature(rawBody: Buffer, header: string | undefined): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return false;
  if (!header?.startsWith("sha256=")) return false;
  const want = createHmac("sha256", secret).update(rawBody).digest("hex");
  const got = header.slice("sha256=".length);
  if (want.length !== got.length) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(got));
}

export function whatsappApiVersion(): string {
  // Pinned to the currently documented Cloud API version; override only for tests.
  return process.env.WHATSAPP_API_VERSION ?? "v26.0";
}

export function whatsappBaseUrl(): string {
  return (process.env.WHATSAPP_API_BASE_URL ?? "https://graph.facebook.com").replace(/\/$/, "");
}

export function whatsappChallenge(mode: string | undefined, token: string | undefined, challenge: string | undefined): string | null {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? "demo-verify-token";
  if (mode === "subscribe" && token === verifyToken && challenge) return challenge;
  return null;
}

interface OutgoingResult { status: "sent" | "simulated" | "not-configured"; id?: string }

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function sendWhatsappText(to: string, body: string, opts?: { template?: string }): Promise<OutgoingResult> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  // Local demo never sends: accurate status instead of a fake success.
  // Never attempt a live send without explicit credentials.
  if (!token || !phoneId) {
    return { status: "not-configured" };
  }
  if ((process.env.DEMO_MODE ?? "true") !== "false") {
    return { status: "simulated" };
  }
  const res = await fetchWithTimeout(`${whatsappBaseUrl()}/${whatsappApiVersion()}/${phoneId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(opts?.template
      ? { messaging_product: "whatsapp", to, type: "template", template: { name: opts.template, language: { code: "en" } } }
      : { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body } }),
  }, 15_000);
  if (!res.ok) throw new Error(`WhatsApp send failed: ${res.status}`);
  const json = (await res.json()) as { messages?: { id: string }[] };
  return { status: "sent", id: json.messages?.[0]?.id };
}

const MEDIA_MIME_ALLOW = new Set([
  "audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav", "audio/webm", "audio/aac", "audio/3gpp", "audio/opus",
]);
const MEDIA_MAX_BYTES = 10 * 1024 * 1024;

function assertTrustedHttpsMediaUrl(url: string): URL {
  const u = new URL(url);
  const baseOverride = process.env.WHATSAPP_API_BASE_URL ?? "";
  const isTestFixture = /localhost|127\.0\.0\.1/.test(baseOverride);
  if (isTestFixture && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) {
    // Local deterministic provider fixture for tests; never a live send.
    return u;
  }
  if (u.protocol !== "https:") throw new Error("Media URL must be https");
  if (u.username || u.password) throw new Error("Media URL must not embed credentials");
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1") {
    throw new Error("Media URL host is not trusted");
  }
  // Base API host is always trusted; media CDN hosts vary by region, so we
  // require https + no credentials + non-local host rather than a fixed list.
  // Callers additionally enforce size/MIME/timeout bounds after download.
  return u;
}

/**
 * Configured Meta media retrieval, per Cloud API Media docs:
 * GET /{version}/{media-id} returns {url, mime_type, file_size}; the URL is
 * valid ~5 minutes and must be downloaded with an authenticated GET.
 * Returns raw bytes bounded to 10 MB with MIME/size/timeout enforcement.
 */
export async function retrieveWhatsappMedia(mediaId: string): Promise<{ bytes: Buffer; mime: string }> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error("WhatsApp media not configured (missing token/phone-number-id)");
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(mediaId)) throw new Error("Invalid media id");
  const metaRes = await fetchWithTimeout(
    `${whatsappBaseUrl()}/${whatsappApiVersion()}/${mediaId}?phone_number_id=${encodeURIComponent(phoneId)}`,
    { method: "GET", headers: { Authorization: `Bearer ${token}` } },
    15_000,
  );
  if (!metaRes.ok) throw new Error(`Media lookup failed: ${metaRes.status}`);
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string; file_size?: string | number };
  if (!meta.url) throw new Error("Media lookup returned no url");
  assertTrustedHttpsMediaUrl(meta.url);
  const declaredSize = Number(meta.file_size ?? 0);
  if (declaredSize > MEDIA_MAX_BYTES) throw new Error("Media exceeds 10 MB limit");
  if (meta.mime_type && !MEDIA_MIME_ALLOW.has(meta.mime_type.split(";")[0].trim().toLowerCase())) {
    throw new Error(`Unsupported media type ${meta.mime_type}`);
  }
  const binRes = await fetchWithTimeout(meta.url, { method: "GET", headers: { Authorization: `Bearer ${token}` } }, 20_000);
  if (!binRes.ok) throw new Error(`Media download failed: ${binRes.status}`);
  const lenHeader = binRes.headers.get("content-length");
  if (lenHeader && Number(lenHeader) > MEDIA_MAX_BYTES) throw new Error("Media exceeds 10 MB limit");
  const buf = Buffer.from(await binRes.arrayBuffer());
  if (buf.length === 0) throw new Error("Empty media download");
  if (buf.length > MEDIA_MAX_BYTES) throw new Error("Media exceeds 10 MB limit");
  const contentType = binRes.headers.get("content-type")?.split(";")[0].trim().toLowerCase()
    ?? meta.mime_type?.split(";")[0].trim().toLowerCase() ?? "audio/ogg";
  if (!MEDIA_MIME_ALLOW.has(contentType)) throw new Error(`Unsupported media type ${contentType}`);
  return { bytes: buf, mime: contentType };
}
