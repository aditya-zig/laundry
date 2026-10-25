import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

/**
 * Bounded, repeatable retention sweeps.
 *
 * Each sweep runs in one transaction, writes one `job_privacy_runs` row and one
 * `v2_audit` row with counts only, and commits the deletions with that audit.
 * Repeating a sweep is a no-op because every predicate excludes rows already
 * handled. A row tied to an order that is not delivered or cancelled is never
 * deleted; it is counted as refused and left for a later run.
 *
 * The coordinator owns scheduling. These functions are pure callables so a
 * long-running worker, a one-shot task or a test can all invoke the same code.
 */
export type PrivacySweepName = 'OTP_CHALLENGES' | 'SESSION_FAMILIES' | 'WHATSAPP_LINKS' | 'MEDIA_RETENTION';

export interface PrivacySweepOptions {
  db: Pool;
  clock?: () => Date;
  batchSize?: number;
}

export interface PrivacySweepResult {
  runId: string;
  sweep: PrivacySweepName;
  status: 'COMPLETED' | 'SKIPPED';
  detail?: string;
  rowsDeleted: number;
  rowsRedacted: number;
  rowsRefused: number;
  startedAt: string;
  finishedAt: string;
}

const PRIVACY_ACTOR_ID = '00000000-0000-4000-8000-0000000000b2';
const LIVE_ORDER = "o.status NOT IN ('DELIVERED','CANCELLED')";

function bounds(options: PrivacySweepOptions): { now: Date; batchSize: number } {
  const now = (options.clock ?? (() => new Date()))();
  const batchSize = options.batchSize ?? 200;
  if (!Number.isFinite(now.getTime())) throw new Error('Privacy sweep clock is invalid');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error('Privacy sweep batch must be between 1 and 1000');
  return { now, batchSize };
}

interface SweepOutcome {
  status: 'COMPLETED' | 'SKIPPED';
  detail?: string;
  rowsDeleted?: number;
  rowsRedacted?: number;
  rowsRefused?: number;
}

async function record(
  tx: PoolClient,
  sweep: PrivacySweepName,
  startedAt: Date,
  finishedAt: Date,
  outcome: SweepOutcome,
): Promise<PrivacySweepResult> {
  const rowsDeleted = outcome.rowsDeleted ?? 0;
  const rowsRedacted = outcome.rowsRedacted ?? 0;
  const rowsRefused = outcome.rowsRefused ?? 0;
  const created = (await tx.query<{ id: string }>(
    `INSERT INTO job_privacy_runs
       (sweep, status, detail, rows_deleted, rows_redacted, rows_refused, started_at, finished_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [sweep, outcome.status, outcome.detail ?? null, rowsDeleted, rowsRedacted, rowsRefused, startedAt, finishedAt],
  )).rows[0];
  await tx.query(
    `INSERT INTO v2_audit
       (actor_id, actor_role, aggregate_id, action, reason, before_value, after_value, trace_id)
     VALUES ($1,'SYSTEM',$2,$3,'Scheduled retention sweep','{}'::jsonb,$4,$5)`,
    [
      PRIVACY_ACTOR_ID,
      created.id,
      `PRIVACY_SWEEP_${sweep}`,
      JSON.stringify({ rowsDeleted, rowsRedacted, rowsRefused, status: outcome.status }),
      randomUUID(),
    ],
  );
  return {
    runId: created.id,
    sweep,
    status: outcome.status,
    ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
    rowsDeleted,
    rowsRedacted,
    rowsRefused,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };
}

async function sweep(
  options: PrivacySweepOptions,
  name: PrivacySweepName,
  work: (tx: PoolClient, now: Date, batchSize: number) => Promise<SweepOutcome>,
): Promise<PrivacySweepResult> {
  const { now, batchSize } = bounds(options);
  const startedAt = now;
  const clock = options.clock ?? (() => new Date());
  const client = await options.db.connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SET LOCAL lock_timeout='3s'");
    const outcome = await work(client, now, batchSize);
    const result = await record(client, name, startedAt, clock(), outcome);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally { client.release(discard); }
}

/** Expired one-time codes lose their phone, code hash and provider reference.
 * The row itself stays as a replay tombstone so an expired key cannot become a
 * fresh login just because its secret was erased. */
export async function sweepOtpChallenges(options: PrivacySweepOptions): Promise<PrivacySweepResult> {
  return sweep(options, 'OTP_CHALLENGES', async (tx, now, batchSize) => {
    const redacted = await tx.query(
      `WITH due AS (
         SELECT id FROM identity_otp_challenges
          WHERE expires_at <= $1 AND redacted_at IS NULL
          ORDER BY expires_at, id
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       )
       UPDATE identity_otp_challenges c
          SET phone = NULL, code_hash = NULL, provider_reference = NULL, redacted_at = $1
         FROM due WHERE c.id = due.id`,
      [now, batchSize],
    );
    return { status: 'COMPLETED', rowsRedacted: redacted.rowCount ?? 0 };
  });
}

/** Families past their absolute deadline are revoked, and sessions whose refresh
 * token has expired are deleted unless the customer still has a live order. */
export async function sweepSessionFamilies(options: PrivacySweepOptions): Promise<PrivacySweepResult> {
  return sweep(options, 'SESSION_FAMILIES', async (tx, now, batchSize) => {
    const revoked = await tx.query(
      `WITH due AS (
         SELECT id FROM identity_session_families
          WHERE absolute_expires_at <= $1 AND revoked_at IS NULL
          ORDER BY absolute_expires_at, id
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       )
       UPDATE identity_session_families f
          SET revoked_at = $1, revoke_reason = 'ABSOLUTE_EXPIRY'
         FROM due WHERE f.id = due.id`,
      [now, batchSize],
    );
    const deleted = await tx.query(
      `WITH due AS (
         SELECT s.id FROM identity_sessions s
           JOIN identity_session_families f ON f.id = s.family_id
          WHERE s.refresh_expires_at <= $1
            AND NOT EXISTS (
              SELECT 1 FROM orders_v2_orders o WHERE o.customer_id = f.profile_id AND ${LIVE_ORDER}
            )
          ORDER BY s.refresh_expires_at, s.id
          LIMIT $2
          FOR UPDATE OF s SKIP LOCKED
       )
       DELETE FROM identity_sessions s USING due WHERE s.id = due.id`,
      [now, batchSize],
    );
    const refused = await tx.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM identity_sessions s
         JOIN identity_session_families f ON f.id = s.family_id
        WHERE s.refresh_expires_at <= $1
          AND EXISTS (SELECT 1 FROM orders_v2_orders o WHERE o.customer_id = f.profile_id AND ${LIVE_ORDER})`,
      [now],
    );
    return {
      status: 'COMPLETED',
      rowsRedacted: revoked.rowCount ?? 0,
      rowsDeleted: deleted.rowCount ?? 0,
      rowsRefused: refused.rows[0].count,
    };
  });
}

/** A channel link is stale when its profile is deactivated. Links on active
 * profiles are kept; the schema has no verified-at column to age them out. */
export async function sweepWhatsappLinks(options: PrivacySweepOptions): Promise<PrivacySweepResult> {
  return sweep(options, 'WHATSAPP_LINKS', async (tx, now, batchSize) => {
    const deleted = await tx.query(
      `WITH due AS (
         SELECT l.profile_id FROM identity_whatsapp_links l
           JOIN identity_profiles p ON p.id = l.profile_id
          WHERE p.active = FALSE
            AND NOT EXISTS (
              SELECT 1 FROM orders_v2_orders o WHERE o.customer_id = l.profile_id AND ${LIVE_ORDER}
            )
          ORDER BY l.linked_at, l.profile_id
          LIMIT $1
          FOR UPDATE OF l SKIP LOCKED
       )
       DELETE FROM identity_whatsapp_links l USING due WHERE l.profile_id = due.profile_id`,
      [batchSize],
    );
    const refused = await tx.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM identity_whatsapp_links l
         JOIN identity_profiles p ON p.id = l.profile_id
        WHERE p.active = FALSE
          AND EXISTS (SELECT 1 FROM orders_v2_orders o WHERE o.customer_id = l.profile_id AND ${LIVE_ORDER})`,
    );
    return { status: 'COMPLETED', rowsDeleted: deleted.rowCount ?? 0, rowsRefused: refused.rows[0].count };
  });
}

/** Media retention needs the B07 store. When its table is absent, or does not
 * expose the retention columns, the sweep reports SKIPPED instead of inventing
 * a deletion rule for storage it does not own. */
export async function sweepMediaRetention(options: PrivacySweepOptions): Promise<PrivacySweepResult> {
  return sweep(options, 'MEDIA_RETENTION', async (tx, now, batchSize) => {
    const present = (await tx.query<{ name: string | null }>("SELECT to_regclass('public.media_assets') AS name")).rows[0].name;
    if (present === null) {
      return { status: 'SKIPPED', detail: 'media_assets table is not present' };
    }
    const columns = new Set((await tx.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'media_assets'",
    )).rows.map(row => row.column_name));
    const expiry = columns.has('retention_expires_at') ? 'retention_expires_at' : columns.has('expires_at') ? 'expires_at' : null;
    const missing = ['id', 'order_id', 'deleted_at'].filter(column => !columns.has(column));
    if (expiry === null) missing.push('retention_expires_at');
    if (missing.length > 0) {
      return { status: 'SKIPPED', detail: `media_assets lacks ${missing.join(', ')}` };
    }
    const deleted = await tx.query(
      `WITH due AS (
         SELECT m.id FROM media_assets m
          WHERE m.${expiry} <= $1
            AND m.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM orders_v2_orders o WHERE o.id = m.order_id AND ${LIVE_ORDER}
            )
          ORDER BY m.${expiry}, m.id
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       )
       UPDATE media_assets m SET deleted_at = $1 FROM due WHERE m.id = due.id`,
      [now, batchSize],
    );
    const refused = await tx.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM media_assets m
        WHERE m.${expiry} <= $1
          AND m.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM orders_v2_orders o WHERE o.id = m.order_id AND ${LIVE_ORDER})`,
      [now],
    );
    return { status: 'COMPLETED', rowsDeleted: deleted.rowCount ?? 0, rowsRefused: refused.rows[0].count };
  });
}

export const PRIVACY_SWEEPS: Readonly<Record<PrivacySweepName, (options: PrivacySweepOptions) => Promise<PrivacySweepResult>>> = {
  OTP_CHALLENGES: sweepOtpChallenges,
  SESSION_FAMILIES: sweepSessionFamilies,
  WHATSAPP_LINKS: sweepWhatsappLinks,
  MEDIA_RETENTION: sweepMediaRetention,
};

/** Run every sweep in a fixed order. One sweep failing does not silently skip
 * the others: the caller gets the error and the earlier runs stay recorded. */
export async function runPrivacySweeps(
  options: PrivacySweepOptions,
  order: readonly PrivacySweepName[] = ['OTP_CHALLENGES', 'SESSION_FAMILIES', 'WHATSAPP_LINKS', 'MEDIA_RETENTION'],
): Promise<PrivacySweepResult[]> {
  const results: PrivacySweepResult[] = [];
  for (const name of order) results.push(await PRIVACY_SWEEPS[name](options));
  return results;
}
