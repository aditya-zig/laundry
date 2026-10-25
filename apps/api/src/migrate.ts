import { initializeDb, closePool } from '../../../modules/shared/src/db';

async function main() {
  if (process.argv.slice(2).join(' ') !== '--apply' || process.env.LAUNDRY_ALLOW_MIGRATIONS !== 'true') throw new Error('Use --apply and explicit LAUNDRY_ALLOW_MIGRATIONS=true for the separate migration job');
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL_UNPOOLED) throw new Error('Explicit application and direct migration database settings are required');
  if (process.env.DEMO_MODE !== 'false') throw new Error('Deployment migrations must not seed demo data');
  if (process.env.NODE_ENV === 'production') {
    for (const setting of [process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED]) {
      const url = new URL(setting);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.searchParams.get('sslmode') !== 'verify-full') throw new Error('Production migration connections require verified TLS PostgreSQL');
    }
  }
  try {
    await initializeDb();
    console.log('[laundry-migrations] reviewed migration chain applied without demo seeding');
  } finally { await closePool(); }
}
main().catch(() => { console.error('[laundry-migrations] failed; inspect redacted database health and migration configuration'); process.exitCode = 1; });
