import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

interface ApplicationServer { server: Server; close(): Promise<void> }
export interface NodeFetchOptions {
  /** Server-only ingress credential; never a customer token or browser value. */
  originSecret: string;
  maxBodyBytes?: number;
  timeoutMs?: number;
}
const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length']);
const failure = (status: number, code: string, message: string) => Response.json({ code, message, traceId: randomUUID(), retryable: status === 503 }, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
function matches(actual: string | null, expected: string) {
  if (!actual) return false;
  return timingSafeEqual(createHash('sha256').update(actual).digest(), createHash('sha256').update(expected).digest());
}
async function boundedBody(request: Request, limit: number, timeoutMs: number): Promise<Buffer | undefined> {
  if (!request.body) return undefined;
  const reader = request.body.getReader(), parts: Uint8Array[] = [];
  let bytes = 0, aborted = request.signal.aborted;
  const cancel = () => { aborted = true; void reader.cancel().catch(() => undefined); };
  const timer = setTimeout(cancel, timeoutMs);
  request.signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      if (aborted) throw new Error('Body read aborted');
      const item = await reader.read();
      if (aborted) throw new Error('Body read aborted');
      if (item.done) return Buffer.concat(parts, bytes);
      bytes += item.value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new RangeError('Request exceeds ingress body limit'); }
      parts.push(item.value);
    }
  } finally { clearTimeout(timer); request.signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

/** Node-24 Fetch-host adapter for the EXISTING compiled Nest HTTP server. It
 * neither rewrites business routes nor starts migrations or chooses providers.
 * Native-origin callers authenticate before body reading/application startup.
 * Public ingress must strip caller origin secrets and supply its own binding.
 */
export function createNodeFetchHandler(createApplication: () => Promise<ApplicationServer>, options: NodeFetchOptions) {
  if (!/^[a-f0-9]{64}$/i.test(options.originSecret) || /^([a-f0-9])\1{63}$/i.test(options.originSecret)) throw new Error('A separate random ingress secret is required');
  const limit = options.maxBodyBytes ?? 65_536, timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_048_576 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Ingress limits must be bounded');
  let pending: Promise<ApplicationServer & { origin: string }> | undefined;
  async function application() {
    pending ??= (async () => {
      const app = await createApplication();
      try {
        if (app.server.listening) throw new Error('Fetch host requires a non-listening application server');
        await new Promise<void>((resolve, reject) => {
          app.server.once('error', reject);
          app.server.listen(0, '127.0.0.1', () => { app.server.removeListener('error', reject); resolve(); });
        });
        const address = app.server.address();
        if (!address || typeof address === 'string' || address.address !== '127.0.0.1') throw new Error('Ingress server must bind loopback only');
        return { ...app, origin: `http://127.0.0.1:${address.port}` };
      } catch (error) { await app.close(); throw error; }
    })();
    // Startup failures may be transient; do not retain a rejected promise.
    try { return await pending; } catch (error) { pending = undefined; throw error; }
  }
  return {
    async fetch(request: Request): Promise<Response> {
      if (!matches(request.headers.get('x-laundry-origin-secret'), options.originSecret)) return failure(401, 'UNAUTHENTICATED', 'Ingress authentication required');
      let body: Buffer | undefined;
      try { body = await boundedBody(request, limit, timeoutMs); }
      catch (error) { return error instanceof RangeError ? failure(413, 'INVALID_INPUT', 'Request body is too large') : failure(400, 'INVALID_INPUT', 'Request body could not be read'); }
      let app: Awaited<ReturnType<typeof application>>;
      try { app = await application(); }
      catch { return failure(503, 'PROVIDER_UNAVAILABLE', 'Application startup is temporarily unavailable'); }
      const incoming = new URL(request.url), target = new URL(app.origin);
      // Assign components, never resolve an attacker-controlled //host path.
      target.pathname = incoming.pathname; target.search = incoming.search;
      const headers = new Headers(request.headers);
      for (const name of [...headers.keys()]) {
        if (hopHeaders.has(name.toLowerCase()) || name.toLowerCase().startsWith('x-forwarded-') || name.toLowerCase().startsWith('x-laundry-') || name.toLowerCase() === 'forwarded') headers.delete(name);
      }
      try {
        const result = await fetch(target, { method: request.method, headers,
          ...(body === undefined || ['GET', 'HEAD'].includes(request.method) ? {} : { body }),
          redirect: 'manual', signal: AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]),
        });
        const responseHeaders = new Headers(result.headers);
        for (const name of [...responseHeaders.keys()]) if (hopHeaders.has(name.toLowerCase())) responseHeaders.delete(name);
        responseHeaders.set('Cache-Control', 'no-store'); responseHeaders.set('X-Content-Type-Options', 'nosniff');
        return new Response(request.method === 'HEAD' ? null : result.body, { status: result.status, headers: responseHeaders });
      } catch {
        // A request may have committed before transport loss. Never call it a
        // definite failure or silently resend it with another command key.
        return failure(503, 'PROVIDER_OUTCOME_UNKNOWN', 'Request outcome is unknown; reconcile the original command');
      }
    },
    async close() {
      const current = pending; pending = undefined;
      if (current) await (await current).close();
    },
  };
}
