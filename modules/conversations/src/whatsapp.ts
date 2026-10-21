import { createHmac, timingSafeEqual } from "node:crypto";

/** Meta Cloud API webhook verification (raw-body HMAC before parsing). */
export function verifyWhatsappSignature(rawBody: Buffer, header: string | undefined): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return false;
  const digest = header?.match(/^sha256=([a-fA-F0-9]{64})$/)?.[1];
  if (!digest) return false;
  const want = createHmac("sha256", secret).update(rawBody).digest();
  return timingSafeEqual(want, Buffer.from(digest, "hex"));
}

export function whatsappApiVersion(): string {
  // Pinned to the currently documented Cloud API version; override only for tests.
  return process.env.WHATSAPP_API_VERSION || "v26.0";
}

export function whatsappBaseUrl(): string {
  const url = new URL(process.env.WHATSAPP_API_BASE_URL || "https://graph.facebook.com");
  const localFixture = process.env.NODE_ENV !== "production"
    && ["localhost", "127.0.0.1"].includes(url.hostname)
    && ["http:", "https:"].includes(url.protocol);
  const graphApi = url.origin === "https://graph.facebook.com";
  if ((!localFixture && !graphApi) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("WhatsApp API base must be the trusted Graph origin or a non-production loopback fixture");
  }
  return url.origin;
}

export function whatsappChallenge(mode: string | undefined, token: string | undefined, challenge: string | undefined): string | null {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? "demo-verify-token";
  if (mode === "subscribe" && token === verifyToken && challenge) return challenge;
  return null;
}

interface OutgoingResult { status: "sent" | "simulated" | "not-configured"; id?: string }

async function providerRequest<T>(url: string, init: RequestInit, timeoutMs: number, read: (response: Response) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Keep the deadline active through body consumption. Automatic redirects
    // could turn a provider URL into an internal request or move credentials.
    const response = await fetch(url, { ...init, signal: ctrl.signal, redirect: "error" });
    try { return await read(response); }
    finally { if (!response.bodyUsed) await response.body?.cancel(); }
  } finally {
    clearTimeout(timer);
  }
}

async function boundedBody(response: Response, maxBytes: number, label: string): Promise<Buffer> {
  const length = Number(response.headers.get("content-length"));
  if (length > maxBytes) throw new Error(`${label} exceeds ${maxBytes === MEDIA_MAX_BYTES ? "10 MB" : "64 KB"} limit`);
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  let complete = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { complete = true; break; }
      size += value.byteLength;
      if (size > maxBytes) throw new Error(`${label} exceeds ${maxBytes === MEDIA_MAX_BYTES ? "10 MB" : "64 KB"} limit`);
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function providerJson(response: Response, label: string): Promise<unknown> {
  if (!response.ok) throw new Error(`${label} failed: ${response.status}`);
  return JSON.parse((await boundedBody(response, 64 * 1024, label)).toString("utf8"));
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
  const json = await providerRequest(`${whatsappBaseUrl()}/${whatsappApiVersion()}/${phoneId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(opts?.template
      ? { messaging_product: "whatsapp", to, type: "template", template: { name: opts.template, language: { code: "en" } } }
      : { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body } }),
  }, 15_000, response => providerJson(response, "WhatsApp send")) as { messages?: { id?: unknown }[] };
  const id = json?.messages?.[0]?.id;
  if (typeof id !== "string" || !id.trim()) throw new Error("WhatsApp acknowledgement missing message id");
  return { status: "sent", id };
}

const MEDIA_MIME_ALLOW = new Set([
  "audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav", "audio/webm", "audio/aac", "audio/3gpp", "audio/opus",
]);
const MEDIA_MAX_BYTES = 10 * 1024 * 1024;

function assertTrustedHttpsMediaUrl(url: string): URL {
  const u = new URL(url);
  const base = new URL(whatsappBaseUrl());
  if (u.username || u.password) throw new Error("Media URL must not embed credentials");
  if (["localhost", "127.0.0.1"].includes(base.hostname) && u.origin === base.origin) {
    // Fixtures stay on their exact origin, including port. A substring in an
    // unrelated hostname cannot authorize an internal network request.
    return u;
  }
  if (u.protocol !== "https:") throw new Error("Media URL must be https");
  if (u.port) throw new Error("Media URL port is not trusted");
  if (base.hostname !== "graph.facebook.com" || !["graph.facebook.com", "lookaside.fbsbx.com"].includes(u.hostname)) {
    throw new Error("Media URL host is not trusted");
  }
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
  const meta = await providerRequest(
    `${whatsappBaseUrl()}/${whatsappApiVersion()}/${mediaId}?phone_number_id=${encodeURIComponent(phoneId)}`,
    { method: "GET", headers: { Authorization: `Bearer ${token}` } },
    15_000,
    response => providerJson(response, "Media lookup"),
  ) as { url?: string; mime_type?: string; file_size?: string | number };
  if (!meta.url) throw new Error("Media lookup returned no url");
  assertTrustedHttpsMediaUrl(meta.url);
  const declaredSize = Number(meta.file_size ?? 0);
  if (declaredSize > MEDIA_MAX_BYTES) throw new Error("Media exceeds 10 MB limit");
  if (meta.mime_type && !MEDIA_MIME_ALLOW.has(meta.mime_type.split(";")[0].trim().toLowerCase())) {
    throw new Error(`Unsupported media type ${meta.mime_type}`);
  }
  return providerRequest(meta.url, { method: "GET", headers: { Authorization: `Bearer ${token}` } }, 20_000, async response => {
    if (!response.ok) throw new Error(`Media download failed: ${response.status}`);
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase()
      ?? meta.mime_type?.split(";")[0].trim().toLowerCase() ?? "audio/ogg";
    if (!MEDIA_MIME_ALLOW.has(contentType)) throw new Error(`Unsupported media type ${contentType}`);
    const bytes = await boundedBody(response, MEDIA_MAX_BYTES, "Media");
    if (bytes.length === 0) throw new Error("Empty media download");
    return { bytes, mime: contentType };
  });
}
