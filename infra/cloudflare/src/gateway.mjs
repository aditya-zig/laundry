const json = (status, body, traceId, headers = {}) => Response.json(body, { status, headers: {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000', 'X-Request-Id': traceId, ...headers,
}});

async function sameSecret(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || expected.length < 32) return false;
  const encode = value => new TextEncoder().encode(value);
  const [a, b] = await Promise.all([actual, expected].map(value => crypto.subtle.digest('SHA-256', encode(value))));
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let mismatch = 0;
  for (let i = 0; i < aa.length; i++) mismatch |= aa[i] ^ bb[i];
  return mismatch === 0;
}

export function platformOrigin(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('Platform origin is not configured'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !/^\/[\s]*$/.test(url.pathname) ||
    !/^[a-z0-9-]+\.compute\.[a-z0-9.-]+\.aws\.neon\.tech$/.test(url.hostname)) {
    throw new Error('Platform origin must be a native Neon Function HTTPS origin');
  }
  return url;
}

export function createGateway(fetchUpstream = fetch) {
  return {
    async fetch(request, env) {
      const traceId = crypto.randomUUID();
      const incoming = new URL(request.url);
      if (!['GET', 'HEAD'].includes(request.method)) return json(503, { code: 'PRODUCTION_NOT_ENABLED', productionReady: false, traceId }, traceId, { 'Retry-After': '3600' });
      if (incoming.pathname === '/health/live') return json(200, { service: 'laundry-gateway', alive: true, productionReady: false, revision: env.SOURCE_REVISION }, traceId);
      if (incoming.pathname === '/health/ready') return json(503, { service: 'laundry-gateway', productionReady: false, productApiEnabled: false, traceId }, traceId, { 'Retry-After': '3600' });
      if (incoming.pathname !== '/internal/platform') return json(503, { code: 'PRODUCTION_NOT_ENABLED', productionReady: false, traceId }, traceId, { 'Retry-After': '3600' });
      if (!await sameSecret(request.headers.get('authorization'), `Bearer ${env.OPERATIONS_TOKEN ?? ''}`) || !env.OPERATIONS_TOKEN || env.OPERATIONS_TOKEN.length < 32) {
        return json(401, { code: 'UNAUTHENTICATED', traceId }, traceId);
      }
      try {
        const target = platformOrigin(env.PLATFORM_ORIGIN);
        if (!env.ORIGIN_SECRET || env.ORIGIN_SECRET.length < 32) throw new Error('Origin secret is missing');
        target.pathname = '/internal/platform';
        // Do not forward arbitrary paths, headers, cookies, user tokens or query parameters.
        const result = await fetchUpstream(target, { method: 'GET', headers: { 'x-laundry-origin-secret': env.ORIGIN_SECRET },
          redirect: 'manual', signal: AbortSignal.timeout(15000) });
        if (![200, 503].includes(result.status) || !result.headers.get('content-type')?.includes('application/json')) throw new Error('Invalid upstream response');
        const body = await result.json();
        // Whitelist response fields. An upstream error must not leak private origin or credentials.
        if (body.service !== 'laundry-platform' || body.productionReady !== false || body.revision !== env.SOURCE_REVISION ||
          (result.status === 200 && (body.infrastructureReady !== true || body.productApiEnabled !== false || body.database !== 'reachable'))) throw new Error('Invalid platform receipt');
        return json(result.status, { service: 'laundry-platform', infrastructureReady: body.infrastructureReady === true,
          productionReady: false, productApiEnabled: false, database: result.status === 200 ? 'reachable' : 'unavailable', revision: env.SOURCE_REVISION, traceId }, traceId);
      } catch {
        return json(503, { code: 'PLATFORM_UNAVAILABLE', productionReady: false, traceId }, traceId, { 'Retry-After': '30' });
      }
    },
  };
}

export default createGateway();
