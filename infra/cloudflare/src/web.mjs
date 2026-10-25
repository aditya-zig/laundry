const apps = new Set(['customer', 'partner', 'ops']);
const originHost = 'br-fancy-glade-a1tjuotr-api.compute.c-1.ap-southeast-1.aws.neon.tech';
const security = {
  'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY', 'permissions-policy': 'camera=(self), microphone=(), geolocation=(self)',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
};
function error(status, code, message) {
  return Response.json({ code, message, traceId: crypto.randomUUID(), retryable: status >= 500 }, { status, headers: { 'cache-control': 'no-store' } });
}
export function apiOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== originHost || url.port || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('Invalid Laundry API origin');
  return url.origin;
}
function navigation(app, path) {
  if (path === '/') return true;
  return app === 'customer' && (/^\/(checkout|basket|orders|account|help)\/?$/.test(path) || /^\/(orders|services)\/[a-f0-9-]{36}\/?$/i.test(path));
}
async function proxy(request, env) {
  if (!env.API_ORIGIN || !/^[a-f0-9]{64}$/i.test(env.API_ORIGIN_SECRET ?? '')) return error(503, 'PROVIDER_UNAVAILABLE', 'The product API is not connected yet');
  let origin;
  try { origin = apiOrigin(env.API_ORIGIN); } catch { return error(503, 'PROVIDER_UNAVAILABLE', 'The product API configuration is unavailable'); }
  if (!['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'].includes(request.method)) return error(405, 'INVALID_INPUT', 'Method not supported');
  const headers = new Headers();
  for (const name of ['content-type', 'authorization', 'idempotency-key', 'accept']) {
    const value = request.headers.get(name); if (value) headers.set(name, value);
  }
  headers.set('x-laundry-origin-secret', env.API_ORIGIN_SECRET);
  let body;
  if (!['GET', 'HEAD'].includes(request.method)) {
    const reader = request.body?.getReader();
    if (reader) {
      let size = 0; const chunks = [];
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 65_536) { await reader.cancel(); return error(413, 'INVALID_INPUT', 'Request body is too large'); }
          chunks.push(chunk.value);
        }
      } catch { return error(400, 'INVALID_INPUT', 'Could not read request body'); }
      finally { reader.releaseLock(); }
      body = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    }
  }
  try {
    const incoming = new URL(request.url);
    const result = await fetch(origin + incoming.pathname + incoming.search, { method: request.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    if (result.status >= 300 && result.status < 400) { await result.body?.cancel(); return error(503, 'PROVIDER_OUTCOME_UNKNOWN', 'API response could not be confirmed'); }
    const output = new Headers({ 'cache-control': 'no-store' });
    for (const name of ['content-type', 'retry-after']) { const value = result.headers.get(name); if (value) output.set(name, value); }
    return new Response(result.body, { status: result.status, headers: output });
  } catch {
    // No automatic mutation retry: the origin may already have committed.
    return error(503, 'PROVIDER_OUTCOME_UNKNOWN', 'API response could not be confirmed; retain the original request key');
  }
}
export default {
  async fetch(request, env) {
    let response;
    const url = new URL(request.url);
    if (!apps.has(env.APP)) response = error(503, 'PROVIDER_UNAVAILABLE', 'Application configuration is unavailable');
    else if (url.pathname === '/health') response = Response.json({ ok: true, service: 'laundry-web', app: env.APP, revision: env.SOURCE_REVISION, productionReady: false, messagingEnabled: false, orderingEnabled: false }, { headers: { 'cache-control': 'no-store' } });
    else if (url.pathname === '/health/ready') response = error(503, 'PROVIDER_UNAVAILABLE', 'Messaging and order activation are deferred');
    else if (/^\/v1(?:\/|$)/.test(url.pathname)) response = error(404, 'NOT_FOUND', 'Legacy demo API is not deployed here');
    else if (/^\/v2(?:\/|$)/.test(url.pathname)) response = await proxy(request, env);
    else if (!['GET', 'HEAD'].includes(request.method)) response = error(405, 'INVALID_INPUT', 'Method not supported');
    else if (url.pathname.startsWith('/.') || /\.(env|map|sql|log)$/i.test(url.pathname)) response = error(404, 'NOT_FOUND', 'Not found');
    else {
      response = await env.ASSETS.fetch(request);
      if (response.status === 404 && navigation(env.APP, url.pathname)) {
        const index = new URL('/index.html', request.url);
        response = await env.ASSETS.fetch(new Request(index, { method: request.method, headers: request.headers }));
      }
    }
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(security)) headers.set(name, value);
    headers.set('x-laundry-revision', env.SOURCE_REVISION ?? 'unknown');
    if (headers.get('content-type')?.includes('text/html')) headers.set('cache-control', 'no-store');
    return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
