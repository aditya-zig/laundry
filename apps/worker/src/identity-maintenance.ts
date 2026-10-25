import { getPool, closePool } from '../../../modules/shared/src/db';
import { maintainIdentity } from '../../../modules/identity/src';

// Narrow production-capable privacy worker. It has no provider adapter, no
// notification dispatcher and no authority to turn on business ordering.
let stopping = false;
let wake: (() => void) | undefined;
const stop = () => { stopping = true; wake?.(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
async function main() {
  const once = process.argv.includes('--once');
  if (process.argv.slice(2).some(arg => arg !== '--once')) throw new Error('Use --once or no arguments');
  if (!process.env.DATABASE_URL) throw new Error('Identity maintenance requires an explicit database');
  if (process.env.NODE_ENV === 'production') {
    const url = new URL(process.env.DATABASE_URL);
    if (process.env.DEMO_MODE !== 'false' || !['postgres:', 'postgresql:'].includes(url.protocol) || url.searchParams.get('sslmode') !== 'verify-full' || ['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('Production identity maintenance requires non-demo TLS PostgreSQL');
  }
  try {
    do {
      const result = await maintainIdentity(getPool());
      // Only bounded counts; never rows, phones, credentials or provider errors.
      console.log(JSON.stringify({ service: 'identity-maintenance', ...result }));
      if (!once && !stopping) await new Promise<void>(resolve => {
        const timer = setTimeout(() => { wake = undefined; resolve(); }, 60_000);
        wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
      });
    } while (!once && !stopping);
  } finally { await closePool(); }
}
main().catch(() => { console.error('[identity-maintenance] failed; inspect redacted database health'); process.exitCode = 1; });
