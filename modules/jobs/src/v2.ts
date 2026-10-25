import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { v2 } from '@laundry/contracts';
import { createPostgresCommandExecutor } from '../../shared/src/command-executor';
import { JobsFault } from './errors';
import { retryDelayMs } from './backoff';
import type { JobHandler, JobHandlerRegistry } from './registry';

/**
 * Durable v2 job dispatch over the shared event outbox.
 *
 * v2_outbox is the queue: one row per domain event, with a due time and an
 * attempt counter. v2_inbox is the per-consumer dedupe ledger, written in the
 * same transaction as the consumer effect through the shared command executor.
 * job_runs adds the lease and version the outbox does not carry.
 *
 * Delivery is at-least-once. The effect of each consumer is exactly once,
 * because the inbox row and the effect commit together and a redelivered event
 * finds the inbox row and skips.
 */
export interface JobsOptions {
  db: Pool;
  authenticate?: (token: string) => Promise<{ actor: v2.Actor }>;
  registry?: JobHandlerRegistry;
  clock?: () => Date;
  maxAttempts?: number;
  leaseSeconds?: number;
  batchSize?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: () => number;
  workerId?: string;
  log?: (line: JobLogLine) => void;
}

export interface JobLogLine {
  event: 'job.claimed' | 'job.completed' | 'job.failed' | 'job.dead-letter' | 'job.skipped';
  jobId: string;
  eventType: string;
  consumer?: string;
  code?: string;
  outcome?: 'FAILED' | 'UNKNOWN';
  attempts?: number;
  dueAt?: string;
}

export interface DispatchSummary {
  claimed: number;
  completed: number;
  failed: number;
  deadLettered: number;
}

export interface JobObservability extends v2.JobHealth {
  lastSuccessfulDispatchAt: string | null;
  oldestUndeliveredSeconds: number | null;
}

interface ClaimedRow {
  event_id: string;
  event_type: string;
  envelope: Record<string, unknown>;
  attempts: number;
  due_at: Date;
  version: number;
}

interface JobRow {
  event_id: string;
  event_type: string;
  attempts: number;
  due_at: Date;
  dispatched_at: Date | null;
  version: number;
  lease_expires_at: Date | null;
  last_error_code: string | null;
}

interface DeadLetterRow {
  id: string;
  job_id: string;
  consumer: string;
  event_type: string;
  attempts: number;
  reason_code: string;
  reason: string;
  job_version: number;
  dead_lettered_at: Date;
  replayed_at: Date | null;
}

const OPERATORS = new Set<v2.ActorRole>(['OPERATOR', 'ADMIN']);
const SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-0000000000b1';
const DEFAULT_MAX_ATTEMPTS = 5;

const RETRYABLE_PG_CODES = new Set(['40001', '40P01']);

/** Map any thrown value onto the published error vocabulary. Unknown outcomes
 * stay distinguishable from ordinary failures so operators can tell a timeout
 * after a side effect from a clean rejection. */
export function classifyFailure(error: unknown): { code: v2.ErrorCode; outcome: 'FAILED' | 'UNKNOWN'; retryable: boolean } {
  const candidate = error as { code?: unknown; name?: unknown } | null;
  if (candidate?.name === 'UnknownOutcomeError' || candidate?.code === 'PROVIDER_OUTCOME_UNKNOWN') {
    return { code: 'PROVIDER_OUTCOME_UNKNOWN', outcome: 'UNKNOWN', retryable: true };
  }
  if (typeof candidate?.code === 'string' && Object.hasOwn(v2.errorRetryable, candidate.code)) {
    const code = candidate.code as v2.ErrorCode;
    return { code, outcome: 'FAILED', retryable: v2.errorRetryable[code] };
  }
  if (typeof candidate?.code === 'string' && RETRYABLE_PG_CODES.has(candidate.code)) {
    return { code: 'PROVIDER_UNAVAILABLE', outcome: 'FAILED', retryable: true };
  }
  return { code: 'PROVIDER_UNAVAILABLE', outcome: 'FAILED', retryable: true };
}

function cursorOf(row: { dead_lettered_at: Date; id: string }): string {
  return Buffer.from(`${row.dead_lettered_at.toISOString()}|${row.id}`).toString('base64url');
}

function decodeCursor(cursor: string | undefined): { at: Date; id: string } | undefined {
  if (cursor === undefined) return undefined;
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const split = raw.lastIndexOf('|');
  if (split === -1) throw new JobsFault('INVALID_INPUT', 'Cursor is not valid');
  const at = new Date(raw.slice(0, split));
  if (Number.isNaN(at.getTime())) throw new JobsFault('INVALID_INPUT', 'Cursor is not valid');
  return { at, id: raw.slice(split + 1) };
}

export class JobsService {
  private readonly executor: ReturnType<typeof createPostgresCommandExecutor>;
  private readonly clock: () => Date;
  private readonly registry: JobHandlerRegistry | undefined;
  private readonly maxAttempts: number;
  private readonly leaseSeconds: number;
  private readonly batchSize: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly jitter: () => number;
  private readonly workerId: string;
  private readonly log: (line: JobLogLine) => void;

  constructor(private readonly options: JobsOptions) {
    this.executor = createPostgresCommandExecutor(options.db);
    this.clock = options.clock ?? (() => new Date());
    this.registry = options.registry;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.leaseSeconds = options.leaseSeconds ?? 60;
    this.batchSize = options.batchSize ?? 20;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 5 * 60_000;
    this.jitter = options.jitter ?? Math.random;
    this.workerId = options.workerId ?? `worker-${randomUUID()}`;
    this.log = options.log ?? (() => undefined);
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 100) {
      throw new Error('Job attempts must be between 1 and 100');
    }
    if (!Number.isFinite(this.leaseSeconds) || this.leaseSeconds < 1 || this.leaseSeconds > 3600) {
      throw new Error('Job lease must be between 1 and 3600 seconds');
    }
    if (!Number.isInteger(this.batchSize) || this.batchSize < 1 || this.batchSize > 100) {
      throw new Error('Job batch size must be between 1 and 100');
    }
  }

  private async actor(token: string): Promise<v2.Actor> {
    if (!this.options.authenticate) throw new JobsFault('UNAUTHENTICATED', 'Sign in again to continue');
    return (await this.options.authenticate(token)).actor;
  }

  private async actorOf(token: string, allowed: Set<v2.ActorRole>): Promise<v2.Actor> {
    const actor = await this.actor(token);
    if (!allowed.has(actor.role)) throw new JobsFault('FORBIDDEN', 'This operation is not permitted for your role');
    return actor;
  }

  /**
   * Claim due rows inside one short transaction. `FOR UPDATE SKIP LOCKED` lets
   * replicas run together without duplicating a claim, and the lease survives a
   * crash: an unfinished row becomes claimable again when the lease expires.
   */
  async claim(limit = this.batchSize): Promise<ClaimedRow[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Claim limit must be between 1 and 100');
    const now = this.clock();
    const expiresAt = new Date(now.getTime() + this.leaseSeconds * 1000);
    const client = await this.options.db.connect();
    let discard = false;
    try {
      await client.query('BEGIN');
      const rows = (await client.query<ClaimedRow>(
        `SELECT o.event_id, o.event_type, o.envelope, o.attempts, o.due_at,
                COALESCE(r.version, 1) AS version
           FROM v2_outbox o
           LEFT JOIN job_runs r ON r.event_id = o.event_id
          WHERE o.dispatched_at IS NULL
            AND o.due_at <= $1
            AND (r.lease_expires_at IS NULL OR r.lease_expires_at <= $1)
            AND NOT EXISTS (
              SELECT 1 FROM job_dead_letters d
               WHERE d.job_id = o.event_id AND d.replayed_at IS NULL
            )
          ORDER BY o.due_at, o.event_id
          LIMIT $2
          FOR UPDATE OF o SKIP LOCKED`,
        [now, limit],
      )).rows;
      if (rows.length > 0) {
        await client.query(
          `INSERT INTO job_runs (event_id, version, lease_owner, lease_expires_at, updated_at)
           SELECT unnest($1::uuid[]), 1, $2, $3, $4
           ON CONFLICT (event_id) DO UPDATE
             SET lease_owner = EXCLUDED.lease_owner,
                 lease_expires_at = EXCLUDED.lease_expires_at,
                 updated_at = EXCLUDED.updated_at`,
          [rows.map(row => row.event_id), this.workerId, expiresAt, now],
        );
      }
      await client.query('COMMIT');
      return rows;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
      throw error;
    } finally { client.release(discard); }
  }

  /** Claim and run one batch. A handler failure never throws out of the batch:
   * it is recorded, rescheduled and eventually dead-lettered. */
  async dispatchBatch(limit = this.batchSize): Promise<DispatchSummary> {
    const claimed = await this.claim(limit);
    const summary: DispatchSummary = { claimed: claimed.length, completed: 0, failed: 0, deadLettered: 0 };
    for (const job of claimed) {
      this.log({ event: 'job.claimed', jobId: job.event_id, eventType: job.event_type, attempts: job.attempts });
      const outcome = await this.dispatchOne(job);
      summary[outcome === 'COMPLETED' ? 'completed' : outcome === 'FAILED' ? 'failed' : 'deadLettered'] += 1;
    }
    return summary;
  }

  private async dispatchOne(job: ClaimedRow): Promise<'COMPLETED' | 'FAILED' | 'DEAD_LETTER'> {
    let event: v2.DomainEvent;
    try {
      event = v2.domainEventSchema.parse(job.envelope);
    } catch {
      return this.recordFailure(job, 'PROVIDER_UNAVAILABLE', 'envelope', job.event_type, 'FAILED');
    }
    const consumers = v2.EVENT_CONSUMERS[event.eventType] ?? [];
    let failure: { consumer: string; code: v2.ErrorCode; outcome: 'FAILED' | 'UNKNOWN' } | undefined;
    for (const consumer of consumers) {
      const handler = this.registry?.get(consumer, event.eventType);
      if (!handler) {
        this.log({ event: 'job.skipped', jobId: job.event_id, eventType: event.eventType, consumer });
        continue;
      }
      try {
        await this.executor.consume(
          consumer,
          { id: SYSTEM_ACTOR_ID, role: 'SYSTEM', consumerScopes: [consumer] },
          event,
          async scope => { await handler({ consumer, event, scope }); },
        );
      } catch (error) {
        const classified = classifyFailure(error);
        failure ??= { consumer, code: classified.code, outcome: classified.outcome };
      }
    }
    if (failure) {
      return this.recordFailure(job, failure.code, failure.consumer, event.eventType, failure.outcome);
    }
    await this.complete(job.event_id, event.eventType);
    return 'COMPLETED';
  }

  private async complete(jobId: string, eventType: string): Promise<void> {
    const now = this.clock();
    await this.options.db.query(
      'UPDATE v2_outbox SET dispatched_at = $2 WHERE event_id = $1 AND dispatched_at IS NULL',
      [jobId, now],
    );
    await this.options.db.query(
      `UPDATE job_runs
          SET lease_owner = NULL, lease_expires_at = NULL, last_error_code = NULL,
              last_error_consumer = NULL, last_success_at = $2, updated_at = $2
        WHERE event_id = $1`,
      [jobId, now],
    );
    this.log({ event: 'job.completed', jobId, eventType });
  }

  private async recordFailure(
    job: ClaimedRow,
    code: v2.ErrorCode,
    consumer: string,
    eventType: string,
    outcome: 'FAILED' | 'UNKNOWN',
  ): Promise<'FAILED' | 'DEAD_LETTER'> {
    const now = this.clock();
    const attempts = job.attempts + 1;
    const terminal = attempts >= this.maxAttempts || !v2.errorRetryable[code];
    // The reason is derived from the code and the attempt count only. Provider
    // messages can contain a phone number or an address, so they never reach
    // the dead-letter row or the log line.
    const reason = `Consumer ${consumer} failed with ${code} after ${attempts} attempt${attempts === 1 ? '' : 's'}`;
    if (!terminal) {
      const dueAt = new Date(now.getTime() + retryDelayMs(attempts, this.jitter, { baseMs: this.baseDelayMs, maxMs: this.maxDelayMs }));
      await this.options.db.query(
        'UPDATE v2_outbox SET attempts = $2, due_at = $3 WHERE event_id = $1',
        [job.event_id, attempts, dueAt],
      );
      await this.options.db.query(
        `UPDATE job_runs
            SET version = version + 1, lease_owner = NULL, lease_expires_at = NULL,
                last_error_code = $2, last_error_consumer = $3, updated_at = $4
          WHERE event_id = $1`,
        [job.event_id, code, consumer, now],
      );
      this.log({ event: 'job.failed', jobId: job.event_id, eventType, consumer, code, outcome, attempts, dueAt: dueAt.toISOString() });
      return 'FAILED';
    }
    await this.options.db.query('UPDATE v2_outbox SET attempts = $2 WHERE event_id = $1', [job.event_id, attempts]);
    const version = job.version + 1;
    await this.options.db.query(
      `INSERT INTO job_dead_letters
         (job_id, consumer, event_type, attempts, reason_code, reason, job_version, dead_lettered_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (job_id) WHERE replayed_at IS NULL DO NOTHING`,
      [job.event_id, consumer, eventType, attempts, code, reason, version, now],
    );
    await this.options.db.query(
      `INSERT INTO job_runs (event_id, version, lease_owner, lease_expires_at, last_error_code, last_error_consumer, updated_at)
       VALUES ($1, $2, NULL, NULL, $3, $4, $5)
       ON CONFLICT (event_id) DO UPDATE
         SET version = EXCLUDED.version, lease_owner = NULL, lease_expires_at = NULL,
             last_error_code = EXCLUDED.last_error_code, last_error_consumer = EXCLUDED.last_error_consumer,
             updated_at = EXCLUDED.updated_at`,
      [job.event_id, version, code, consumer, now],
    );
    this.log({ event: 'job.dead-letter', jobId: job.event_id, eventType, consumer, code, outcome, attempts });
    return 'DEAD_LETTER';
  }

  private async snapshot(): Promise<{ health: v2.JobHealth; lastSuccessfulDispatchAt: Date | null; oldestDueAt: Date | null }> {
    const now = this.clock();
    const row = (await this.options.db.query<{
      queued: number; claimed: number; dead_letter: number; oldest_due_at: Date | null; last_success_at: Date | null;
    }>(
      `WITH open_jobs AS (
         SELECT o.event_id, o.due_at, r.lease_expires_at,
                EXISTS (SELECT 1 FROM job_dead_letters d WHERE d.job_id = o.event_id AND d.replayed_at IS NULL) AS dead
           FROM v2_outbox o
           LEFT JOIN job_runs r ON r.event_id = o.event_id
          WHERE o.dispatched_at IS NULL
       )
       SELECT
         COUNT(*) FILTER (WHERE NOT dead AND (lease_expires_at IS NULL OR lease_expires_at <= $1))::int AS queued,
         COUNT(*) FILTER (WHERE NOT dead AND lease_expires_at > $1)::int AS claimed,
         (SELECT COUNT(*)::int FROM job_dead_letters WHERE replayed_at IS NULL) AS dead_letter,
         MIN(due_at) FILTER (WHERE NOT dead AND (lease_expires_at IS NULL OR lease_expires_at <= $1)) AS oldest_due_at,
         (SELECT MAX(dispatched_at) FROM v2_outbox) AS last_success_at
       FROM open_jobs`,
      [now],
    )).rows[0];
    const health = v2.jobHealthSchema.parse({
      queued: row.queued,
      claimed: row.claimed,
      deadLetter: row.dead_letter,
      oldestDueAt: row.oldest_due_at === null ? null : row.oldest_due_at.toISOString(),
      observedAt: now.toISOString(),
    });
    return { health, lastSuccessfulDispatchAt: row.last_success_at, oldestDueAt: row.oldest_due_at };
  }

  /** Operator health view. Computed from the database on every call; this
   * process holds no counters that a restart would erase. */
  async health(token: string): Promise<v2.JobHealth> {
    await this.actorOf(token, OPERATORS);
    return (await this.snapshot()).health;
  }

  /** Worker-side observability. Adds the two values the strict wire schema has
   * no fields for, so they can be logged without widening the contract. */
  async observability(): Promise<JobObservability> {
    const { health, lastSuccessfulDispatchAt, oldestDueAt } = await this.snapshot();
    return {
      ...health,
      lastSuccessfulDispatchAt: lastSuccessfulDispatchAt === null ? null : lastSuccessfulDispatchAt.toISOString(),
      oldestUndeliveredSeconds: oldestDueAt === null ? null : Math.max(0, Math.floor((this.clock().getTime() - oldestDueAt.getTime()) / 1000)),
    };
  }

  async deadLetters(token: string, query: { cursor?: string; limit?: number } = {}): Promise<v2.Page<v2.Job>> {
    await this.actorOf(token, OPERATORS);
    const page = v2.pageQuerySchema.parse(query);
    const cursor = decodeCursor(page.cursor);
    const filters = ['replayed_at IS NULL'];
    const values: unknown[] = [];
    if (cursor) {
      values.push(cursor.at, cursor.id);
      filters.push(`(dead_lettered_at, id) < ($1, $2)`);
    }
    values.push(page.limit + 1);
    const rows = (await this.options.db.query<DeadLetterRow>(
      `SELECT * FROM job_dead_letters
        WHERE ${filters.join(' AND ')}
        ORDER BY dead_lettered_at DESC, id DESC
        LIMIT $${values.length}`,
      values,
    )).rows;
    const items = rows.slice(0, page.limit).map(row => v2.jobSchema.parse({
      id: row.job_id,
      kind: row.event_type,
      status: 'DEAD_LETTER',
      version: row.job_version,
      attempts: row.attempts,
      runAt: row.dead_lettered_at.toISOString(),
      lastErrorCode: row.reason_code,
    }));
    return {
      items,
      pageInfo: {
        hasMore: rows.length > page.limit,
        ...(rows.length > page.limit ? { nextCursor: cursorOf(rows[page.limit - 1]) } : {}),
      },
    };
  }

  /**
   * Operator replay. The dead letter is closed, the outbox row keeps its
   * original event identity (so consumers that already applied it skip), and
   * the attempt budget restarts. The command executor supplies idempotency and
   * the audit row, so replaying twice with the same key returns the first
   * response and requeues once. A replayed job that dead-letters again is a new
   * dead-letter record at a new version, which needs a new key to requeue.
   */
  async replay(token: string, jobId: string, input: v2.JobReplay, key: string): Promise<v2.Job> {
    const parsed = v2.jobReplaySchema.parse(input);
    v2.idSchema.parse(jobId);
    const actor = await this.actorOf(token, OPERATORS);
    const result = await this.executor.execute(
      {
        actor,
        operation: 'jobs.replay',
        idempotencyKey: key,
        payload: { jobId, reason: parsed.reason } as unknown as v2.JsonValue,
        traceId: randomUUID(),
      },
      async () => { await this.actorOf(token, OPERATORS); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const now = this.clock();
        const job = (await tx.query<JobRow>(
          `SELECT o.event_id, o.event_type, o.attempts, o.due_at, o.dispatched_at,
                  COALESCE(r.version, 1) AS version, r.lease_expires_at, r.last_error_code
             FROM v2_outbox o
             LEFT JOIN job_runs r ON r.event_id = o.event_id
            WHERE o.event_id = $1
            FOR UPDATE OF o`,
          [jobId],
        )).rows[0];
        if (!job) throw new JobsFault('NOT_FOUND', 'Job not found');
        const dead = (await tx.query<DeadLetterRow>(
          'SELECT * FROM job_dead_letters WHERE job_id = $1 AND replayed_at IS NULL FOR UPDATE',
          [jobId],
        )).rows[0];
        if (!dead) throw new JobsFault('VERSION_CONFLICT', 'Job is not dead-lettered', job.version);
        if (job.version !== parsed.expectedVersion) {
          throw new JobsFault('VERSION_CONFLICT', 'Job changed since it was read', job.version);
        }
        await tx.query(
          'UPDATE job_dead_letters SET replayed_at = $2, replay_count = replay_count + 1 WHERE id = $1',
          [dead.id, now],
        );
        await tx.query(
          'UPDATE v2_outbox SET attempts = 0, due_at = $2, dispatched_at = NULL WHERE event_id = $1',
          [jobId, now],
        );
        const version = job.version + 1;
        await tx.query(
          `INSERT INTO job_runs (event_id, version, lease_owner, lease_expires_at, last_error_code, last_error_consumer, updated_at)
           VALUES ($1, $2, NULL, NULL, NULL, NULL, $3)
           ON CONFLICT (event_id) DO UPDATE
             SET version = EXCLUDED.version, lease_owner = NULL, lease_expires_at = NULL,
                 last_error_code = NULL, last_error_consumer = NULL, updated_at = EXCLUDED.updated_at`,
          [jobId, version, now],
        );
        await scope.audit({
          aggregateId: jobId,
          action: 'JOB_REPLAYED',
          reason: parsed.reason,
          before: { version: job.version, attempts: job.attempts, reasonCode: dead.reason_code },
          after: { version, attempts: 0, dueAt: now.toISOString() },
        });
        return v2.jobSchema.parse({
          id: jobId,
          kind: job.event_type,
          status: 'QUEUED',
          version,
          attempts: 0,
          runAt: now.toISOString(),
        }) as unknown as v2.JsonValue;
      },
    );
    return v2.jobSchema.parse(result);
  }
}

export type { JobHandler };
