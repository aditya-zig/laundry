import { getPool, closePool } from '../../../modules/shared/src/db';
import { JobsService, runPrivacySweeps } from '../../../modules/jobs/src';
import { verifyRuntimeDatabase } from '../../../modules/shared/src/runtime-database';

/**
 * Narrow v2 job runtime. It dispatches the shared event outbox and can run one
 * privacy pass. It has no provider adapter and no authority to start business
 * ordering. The legacy v1 outbox consumer in `main.ts` is untouched.
 *
 * Refuses to start when the B10 proposal tables are absent, instead of failing
 * every claim with a missing-relation error.
 */
let stopping = false;
let wake: (() => void) | undefined;
const stop = () => { stopping = true; wake?.(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

function parseMode(argv: string[]): { once: boolean; privacy: boolean } {
  const args = argv.slice(2);
  const allowed = new Set(['--once', '--privacy']);
  const unknown = args.filter(arg => !allowed.has(arg));
  if (unknown.length > 0) throw new Error(`Unknown arguments: ${unknown.join(' ')}`);
  return { once: args.includes('--once'), privacy: args.includes('--privacy') };
}

async function assertTables(): Promise<void> {
  const row = (await getPool().query<{ runs: string | null; dead: string | null; privacy: string | null }>(
    `SELECT to_regclass('public.job_runs')::text AS runs,
            to_regclass('public.job_dead_letters')::text AS dead,
            to_regclass('public.job_privacy_runs')::text AS privacy`,
  )).rows[0];
  if (!row.runs || !row.dead || !row.privacy) {
    throw new Error('B10 tables are missing; the coordinator must apply modules/schema/proposals/B10.sql before this runtime starts');
  }
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv);
  if (!process.env.DATABASE_URL) throw new Error('The job runtime requires an explicit database');
  if (process.env.NODE_ENV === 'production') {
    if (process.env.DATABASE_URL_UNPOOLED || process.env.LAUNDRY_ALLOW_MIGRATIONS === 'true') {
      throw new Error('Migration credentials must not be supplied to the job runtime');
    }
    const url = new URL(process.env.DATABASE_URL);
    if (process.env.DEMO_MODE !== 'false' || !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.searchParams.get('sslmode') !== 'verify-full' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('Production job dispatch requires non-demo TLS PostgreSQL');
    }
  }
  try {
    await assertTables();
    if (process.env.NODE_ENV === 'production' || process.env.LAUNDRY_DATABASE_MODE === 'runtime') {
      await verifyRuntimeDatabase(getPool());
    }
    if (mode.privacy) {
      // Counts only. Sweeps never log a phone number, address or media key.
      const results = await runPrivacySweeps({ db: getPool() });
      console.log(JSON.stringify({ service: 'job-privacy', results }));
      return;
    }
    const jobs = new JobsService({
      db: getPool(),
      clock: () => new Date(),
      log: line => console.log(JSON.stringify({ service: 'job-dispatch', ...line })),
    });
    do {
      const summary = await jobs.dispatchBatch();
      const observed = await jobs.observability();
      console.log(JSON.stringify({ service: 'job-dispatch', summary, observed }));
      if (!mode.once && !stopping) {
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => { wake = undefined; resolve(); }, 2_000);
          wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
        });
      }
    } while (!mode.once && !stopping);
  } finally {
    await closePool();
  }
}

main().catch(() => {
  console.error('[job-dispatch] failed; inspect redacted database health');
  process.exitCode = 1;
});
