const developmentOrigins = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:8081', 'http://localhost:8082', 'http://localhost:5173', 'http://localhost:19006'];
const loopback = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host) || host.endsWith('.localhost');

export function resolveCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const production = env.NODE_ENV === 'production';
  const configured = (env.CORS_ORIGIN ?? env.FRONTEND_URL ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (production && !configured.length) throw new Error('Production requires exact HTTPS CORS_ORIGIN values');
  const origins = configured.map(value => {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('CORS_ORIGIN must contain exact HTTP(S) origins'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (production && (url.protocol !== 'https:' || loopback(url.hostname)))) throw new Error('CORS_ORIGIN must contain permitted exact origins, not URLs, wildcards or credentials');
    return url.origin;
  });
  return [...new Set([...(production ? [] : developmentOrigins), ...origins])];
}

export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  const problems: string[] = [];
  if (env.DEMO_MODE !== 'false') problems.push("DEMO_MODE must be 'false' in production");
  let database: URL | undefined;
  try { database = new URL(env.DATABASE_URL ?? ''); } catch { /* Report no secret values. */ }
  if (!database || !['postgres:', 'postgresql:'].includes(database.protocol) || loopback(database.hostname) || database.pathname === '/' || database.searchParams.get('sslmode') !== 'verify-full') {
    problems.push('DATABASE_URL must identify a non-loopback PostgreSQL database with sslmode=verify-full');
  }
  for (const name of ['WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID']) {
    if (!env[name]) problems.push(`${name} must be configured in production`);
  }
  if (env.WHATSAPP_VERIFY_TOKEN === 'demo-verify-token') problems.push('WHATSAPP_VERIFY_TOKEN must not use the demo default');
  if (problems.length) throw new Error(`Refusing production start: ${problems.join('; ')}`);
  resolveCorsOrigins(env);
}
