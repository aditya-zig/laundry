import type { Pool } from 'pg';

export interface IdentityMaintenanceResult {
  challengesRedacted: number;
  commandSecretsRedacted: number;
  expiredFamiliesRevoked: number;
  obsoleteRateBucketsDeleted: number;
}

/** Bounded, repeatable privacy maintenance. Hash-only replay tombstones remain;
 * an expired client key must never become a new send/login simply because the
 * privacy worker erased its secret payload. Audit/business records are not
 * deleted under an invented commercial retention policy. */
export async function maintainIdentity(db: Pool, options: { now?: Date; batchSize?: number } = {}): Promise<IdentityMaintenanceResult> {
  const now = options.now ?? new Date(), size = options.batchSize ?? 200;
  if (!Number.isFinite(now.getTime()) || !Number.isInteger(size) || size < 1 || size > 1000) throw new Error('Invalid identity maintenance bounds');
  const tx = await db.connect();
  let discard = false;
  try {
    await tx.query('BEGIN');
    await tx.query("SET LOCAL statement_timeout='10s'");
    await tx.query("SET LOCAL lock_timeout='3s'");
    // Skip locked batches permit independent replicas without waiting on active
    // verification/rotation transactions or duplicating deletions.
    const challenges = await tx.query(`WITH due AS (
      SELECT id FROM identity_otp_challenges WHERE expires_at<=$1 AND redacted_at IS NULL
      ORDER BY expires_at,id LIMIT $2 FOR UPDATE SKIP LOCKED)
      UPDATE identity_otp_challenges c SET phone=NULL,code_hash=NULL,provider_reference=NULL,redacted_at=$1
      FROM due WHERE c.id=due.id`, [now, size]);
    const commands = await tx.query(`WITH due AS (
      SELECT scope,key_hash FROM identity_command_results WHERE expires_at<=$1 AND redacted_at IS NULL
      ORDER BY expires_at,scope,key_hash LIMIT $2 FOR UPDATE SKIP LOCKED)
      UPDATE identity_command_results c SET sealed_result=NULL,session_id=NULL,redacted_at=$1
      FROM due WHERE c.scope=due.scope AND c.key_hash=due.key_hash`, [now, size]);
    const families = await tx.query(`WITH due AS (
      SELECT id FROM identity_session_families WHERE absolute_expires_at<=$1 AND revoked_at IS NULL
      ORDER BY absolute_expires_at,id LIMIT $2 FOR UPDATE SKIP LOCKED)
      UPDATE identity_session_families f SET revoked_at=$1,revoke_reason='ABSOLUTE_EXPIRY'
      FROM due WHERE f.id=due.id`, [now, size]);
    const currentHour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
    const rates = await tx.query(`WITH due AS (
      SELECT key_hash,bucket_start FROM identity_rate_buckets WHERE bucket_start<$1
      ORDER BY bucket_start,key_hash LIMIT $2 FOR UPDATE SKIP LOCKED)
      DELETE FROM identity_rate_buckets b USING due WHERE b.key_hash=due.key_hash AND b.bucket_start=due.bucket_start`, [currentHour, size]);
    await tx.query('COMMIT');
    return { challengesRedacted: challenges.rowCount ?? 0, commandSecretsRedacted: commands.rowCount ?? 0,
      expiredFamiliesRevoked: families.rowCount ?? 0, obsoleteRateBucketsDeleted: rates.rowCount ?? 0 };
  } catch (error) {
    try { await tx.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally { tx.release(discard); }
}
