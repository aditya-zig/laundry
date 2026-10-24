import { createHash, timingSafeEqual } from 'node:crypto';
import pg from 'pg';

const response = (status, body) => Response.json(body, { status, headers: {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
}});

export function sameSecret(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || expected.length < 32) return false;
  return timingSafeEqual(createHash('sha256').update(actual).digest(), createHash('sha256').update(expected).digest());
}

/** Infrastructure preflight only. This must never be mounted as the product API. */
export function createPlatformHandler({ originSecret, branchName, expectedBranch, databaseName, db, revision }) {
  if (typeof originSecret !== 'string' || originSecret.length < 32) throw new Error('A server-only origin secret of at least 32 characters is required');
  if (!expectedBranch || branchName !== expectedBranch) throw new Error('Platform function is bound to the wrong branch');
  if (!databaseName || !/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) throw new Error('Expected database name is required');
  if (!/^[a-f0-9]{40}$/.test(revision ?? '')) throw new Error('A full source revision is required');
  return {
    async fetch(request) {
      // Authenticate before URL routing, body parsing, or allocating a database connection.
      if (!sameSecret(request.headers.get('x-laundry-origin-secret'), originSecret)) {
        return response(401, { code: 'UNAUTHENTICATED' });
      }
      const path = new URL(request.url).pathname;
      if (request.method !== 'GET' || path !== '/internal/platform') return response(404, { code: 'NOT_FOUND' });
      let client;
      let poisoned = false;
      try {
        client = await db.connect();
        await client.query('BEGIN READ ONLY');
        await client.query("SET LOCAL statement_timeout = '5000ms'");
        const { rows: [state] } = await client.query(`SELECT current_database() AS database,
          current_user AS role,
          to_regclass('public.v2_command_results') IS NOT NULL AS command_schema,
          to_regclass('public.outbox') IS NOT NULL AS legacy_outbox_schema,
          (EXISTS (SELECT 1 FROM pg_roles WHERE (rolcreaterole OR rolcreatedb OR rolsuper)
            AND pg_has_role(current_user, oid, 'MEMBER'))
            OR has_schema_privilege(current_user, 'public', 'CREATE')
            OR has_table_privilege(current_user, 'public.users', 'SELECT')
            OR has_table_privilege(current_user, 'public.orders', 'INSERT')) AS privileged`);
        await client.query('ROLLBACK');
        if (state.database !== databaseName || state.command_schema !== true || state.legacy_outbox_schema !== true || state.privileged !== false) {
          return response(503, { service: 'laundry-platform', infrastructureReady: false, productionReady: false, code: 'DATABASE_CONFIGURATION_INVALID', revision });
        }
        return response(200, { service: 'laundry-platform', environment: 'release-candidate', infrastructureReady: true,
          productionReady: false, productApiEnabled: false, database: 'reachable', revision });
      } catch {
        if (client) try { await client.query('ROLLBACK'); } catch { poisoned = true; }
        // No URLs, driver exceptions, SQL or customer information in HTTP responses/logs.
        return response(503, { service: 'laundry-platform', infrastructureReady: false, productionReady: false, code: 'DATABASE_UNAVAILABLE', revision });
      } finally { client?.release(poisoned); }
    },
  };
}

export function createPlatformPool(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Private platform database connection is required'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname.endsWith('.neon.tech') || !['require', 'verify-full'].includes(parsed.searchParams.get('sslmode'))) {
    throw new Error('Platform database requires a verified-TLS Neon connection');
  }
  parsed.searchParams.set('sslmode', 'verify-full');
  const pool = new pg.Pool({ connectionString: parsed.toString(), max: 2, connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000, maxLifetimeSeconds: 120, query_timeout: 6000, application_name: 'laundry-platform-preflight' });
  pool.on('error', () => { console.error('[laundry-platform] idle database connection removed'); });
  return pool;
}

let handler;
export default {
  fetch(request) {
    // Reject anonymous native-origin traffic without even constructing a pool.
    if (!sameSecret(request.headers.get('x-laundry-origin-secret'), process.env.ORIGIN_SECRET)) return response(401, { code: 'UNAUTHENTICATED' });
    handler ??= createPlatformHandler({ originSecret: process.env.ORIGIN_SECRET, branchName: process.env.NEON_BRANCH,
      expectedBranch: process.env.EXPECTED_BRANCH, databaseName: process.env.EXPECTED_DATABASE,
      revision: process.env.SOURCE_REVISION, db: createPlatformPool(process.env.PLATFORM_DATABASE_URL) });
    return handler.fetch(request);
  },
};
