import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { v2 } from '@laundry/contracts';
import { createPostgresCommandExecutor } from '../../shared/src/command-executor';
import { MediaFault } from './errors';
import { createMemoryStorage, type StoragePort } from './storage';

/**
 * Private evidence uploads.
 *
 * An upload intent and the object it later becomes are one row. The intent is
 * bound to the actor who created it, a declared MIME type from a per-kind
 * allow list, a declared size inside the hard cap, a purpose and an optional
 * order or incident owner. Finalize is the only transition into AVAILABLE and
 * it verifies the object the store actually holds against the intent.
 *
 * There is no public read path. Download always re-reads the object, checks
 * that the caller is the uploader, the owning customer, staff at the owning
 * facility or an operator, and only then mints a short-lived URL. Every
 * decision is written to media_access_log.
 */
export type PrivateKind = Exclude<v2.MediaKind, 'CATALOG_ASSET'>;

export interface MediaOptions {
  db: Pool;
  authenticate?: (token: string) => Promise<{ actor: v2.Actor }>;
  storage?: StoragePort;
  clock?: () => Date;
  uploadMinutes?: number;
  downloadMinutes?: number;
  retentionDays?: Partial<Record<PrivateKind, number>>;
}

interface MediaRow {
  id: string;
  actor_id: string;
  actor_role: string;
  kind: PrivateKind;
  purpose: string;
  mime_type: string;
  declared_size_bytes: string | number;
  size_bytes: string | number | null;
  digest: string | null;
  storage_key: string;
  upload_expires_at: Date;
  order_id: string | null;
  incident_id: string | null;
  facility_id: string | null;
  state: v2.MediaStatus;
  retention_until: Date;
  finalized_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
}

interface AccessRow extends MediaRow {
  order_customer_id: string | null;
  order_facility_id: string | null;
}

interface OrderOwnerRow {
  customer_id: string;
  facility_id: string | null;
}

const MAX_UPLOAD_BYTES = 10_000_000;
const ALLOWED_MIME: Record<PrivateKind, readonly string[]> = {
  PROOF_IMAGE: ['image/jpeg', 'image/png', 'image/webp'],
  VOICE_NOTE: ['audio/webm', 'audio/mpeg', 'audio/ogg', 'audio/wav'],
  CUSTOMER_ATTACHMENT: ['application/pdf', 'image/jpeg', 'image/png'],
};
const DEFAULT_RETENTION_DAYS: Record<PrivateKind, number> = {
  PROOF_IMAGE: 90,
  VOICE_NOTE: 1,
  CUSTOMER_ATTACHMENT: 180,
};
// The retention sweep has no human actor. This fixed id and role keep the audit
// trail honest instead of borrowing an operator identity.
const SWEEP_ACTOR_ID = '00000000-0000-4000-8000-000000000000';
const STAFF_READERS = new Set<v2.ActorRole>(['OPERATOR', 'ADMIN']);

function bytes(value: string | number): number {
  return Number(value);
}

function storageKey(id: string, actorId: string, bind: { kind: string; mimeType: string; sizeBytes: number; purpose: string }): string {
  // The digest of the intent binding is part of the key, so an object uploaded
  // for one intent cannot be finalized under another.
  const digest = createHash('sha256')
    .update(JSON.stringify([id, actorId, bind.kind, bind.mimeType, bind.sizeBytes, bind.purpose]))
    .digest('hex');
  return `private/${id}/${digest.slice(0, 32)}`;
}

function reference(row: MediaRow): v2.MediaReference {
  return v2.mediaReferenceSchema.parse({
    id: row.id,
    kind: row.kind,
    visibility: 'PRIVATE',
    mimeType: row.mime_type,
    sizeBytes: bytes(row.size_bytes ?? row.declared_size_bytes),
    ownerId: row.actor_id,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.retention_until.toISOString(),
    ...(row.digest === null ? {} : { checksum: row.digest }),
    status: row.state,
  });
}

type DownloadDecision =
  | { allowed: true }
  | { allowed: false; outcome: 'DENIED' | 'NOT_FOUND' | 'EXPIRED'; reason: string; fault: MediaFault };

export class MediaService {
  private readonly executor: ReturnType<typeof createPostgresCommandExecutor>;
  private readonly storage: StoragePort;
  private readonly clock: () => Date;
  private readonly uploadMinutes: number;
  private readonly downloadMinutes: number;
  private readonly retentionDays: Record<PrivateKind, number>;

  constructor(private readonly options: MediaOptions) {
    if (process.env.NODE_ENV === 'production' && options.storage?.mode !== 'LIVE') {
      throw new Error('A live private media storage adapter is required in production');
    }
    this.executor = createPostgresCommandExecutor(options.db);
    this.storage = options.storage ?? createMemoryStorage();
    this.clock = options.clock ?? (() => new Date());
    this.uploadMinutes = options.uploadMinutes ?? 15;
    this.downloadMinutes = options.downloadMinutes ?? 5;
    this.retentionDays = { ...DEFAULT_RETENTION_DAYS, ...options.retentionDays };
    if (!Number.isSafeInteger(this.uploadMinutes) || this.uploadMinutes < 1 || this.uploadMinutes > 15 ||
      !Number.isSafeInteger(this.downloadMinutes) || this.downloadMinutes < 1 || this.downloadMinutes > 5 ||
      Object.values(this.retentionDays).some(days => !Number.isFinite(days) || days <= 0 || days > 365)) {
      throw new Error('Media capability and retention windows must be explicitly bounded');
    }
    if (this.retentionDays.VOICE_NOTE > 1) throw new Error('Voice retention beyond 24 hours requires a separate approved support-retention workflow');
  }

  private async tx<T>(work: (tx: PoolClient) => Promise<T>): Promise<T> {
    const tx = await this.options.db.connect();
    let discard = false;
    try {
      await tx.query('BEGIN');
      await tx.query("SET LOCAL statement_timeout='10s'");
      await tx.query("SET LOCAL lock_timeout='3s'");
      const value = await work(tx);
      await tx.query('COMMIT');
      return value;
    } catch (error) {
      try { await tx.query('ROLLBACK'); } catch { discard = true; }
      throw error;
    } finally { tx.release(discard); }
  }

  private async actor(token: string): Promise<v2.Actor> {
    if (!this.options.authenticate) throw new MediaFault('UNAUTHENTICATED', 'Sign in again to continue');
    return (await this.options.authenticate(token)).actor;
  }

  private async orderOwner(orderId: string, client: Pool | PoolClient = this.options.db): Promise<OrderOwnerRow | undefined> {
    return (await client.query<OrderOwnerRow>(
      'SELECT customer_id, facility_id FROM orders_v2_orders WHERE id=$1 FOR SHARE', [orderId])).rows[0];
  }

  /** An intent may only name an order the actor can already see. Incidents are
   * stored as references but their ownership table belongs to B08. */
  private async assertOrderAccess(actor: v2.Actor, orderId: string, client: Pool | PoolClient = this.options.db): Promise<OrderOwnerRow> {
    const order = await this.orderOwner(orderId, client);
    if (!order) throw new MediaFault('NOT_FOUND', 'Order not found');
    if (actor.role === 'CUSTOMER' && order.customer_id !== actor.id) {
      throw new MediaFault('NOT_FOUND', 'Order not found');
    }
    if (actor.role === 'FACILITY') {
      if (order.facility_id === null || !actor.facilityIds.includes(order.facility_id)) {
        throw new MediaFault('NOT_FOUND', 'Order not found');
      }
    }
    if (actor.role === 'RIDER') {
      throw new MediaFault('FORBIDDEN', 'Rider custody proof is recorded through logistics');
    }
    return order;
  }

  async createUploadIntent(token: string, input: v2.UploadIntent, key: string): Promise<v2.UploadIntentResult> {
    const parsed = v2.uploadIntentSchema.parse(input);
    if (parsed.kind === 'CATALOG_ASSET') {
      throw new MediaFault('INVALID_INPUT', 'Catalog assets are published separately from private evidence');
    }
    const kind: PrivateKind = parsed.kind;
    const allowed = ALLOWED_MIME[kind];
    if (!allowed.includes(parsed.mimeType)) {
      throw new MediaFault('INVALID_INPUT', `${parsed.mimeType} is not allowed for ${kind}`);
    }
    if (parsed.sizeBytes > MAX_UPLOAD_BYTES) {
      throw new MediaFault('INVALID_INPUT', `Uploads are capped at ${MAX_UPLOAD_BYTES} bytes`);
    }
    let actor = await this.actor(token);
    if (actor.role === 'RIDER') throw new MediaFault('FORBIDDEN', 'Rider custody proof requires an assigned logistics upload');
    let order = parsed.orderId === undefined ? undefined : await this.assertOrderAccess(actor, parsed.orderId);
    const purpose = parsed.purpose ?? kind;

    const result = await this.executor.execute(
      { actor, operation: 'media.upload.intent', idempotencyKey: key, payload: parsed as unknown as v2.JsonValue, traceId: randomUUID() },
      async tx => {
        actor = await this.actor(token);
        if (actor.role === 'RIDER') throw new MediaFault('FORBIDDEN', 'Rider custody proof requires an assigned logistics upload');
        order = parsed.orderId === undefined ? undefined : await this.assertOrderAccess(actor, parsed.orderId, tx);
      },
      async scope => {
        const tx = scope.handle;
        const id = randomUUID();
        const createdAt = this.clock();
        const uploadExpiresAt = new Date(createdAt.getTime() + this.uploadMinutes * 60_000);
        const storage = storageKey(id, actor.id, {
          kind, mimeType: parsed.mimeType, sizeBytes: parsed.sizeBytes, purpose,
        });
        const target = await this.storage.createUploadTarget({
          key: storage,
          mimeType: parsed.mimeType,
          sizeBytes: parsed.sizeBytes,
          expiresAt: uploadExpiresAt,
        });
        await tx.query(`INSERT INTO media_objects
          (id,actor_id,actor_role,kind,purpose,mime_type,declared_size_bytes,size_bytes,digest,storage_key,
           upload_expires_at,order_id,incident_id,facility_id,state,retention_until,finalized_at,deleted_at,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,NULL,$8,$9,$10,$11,$12,'PENDING',$9,NULL,NULL,$13)`, [
          id, actor.id, actor.role, kind, purpose, parsed.mimeType, parsed.sizeBytes, storage,
          uploadExpiresAt, parsed.orderId ?? null, parsed.incidentId ?? null, order?.facility_id ?? null, createdAt,
        ]);
        await scope.audit({
          aggregateId: id,
          action: 'MEDIA_UPLOAD_INTENT_CREATED',
          reason: 'Actor requested a private upload target',
          before: {},
          after: {
            kind, purpose, mimeType: parsed.mimeType, declaredSizeBytes: parsed.sizeBytes,
            ...(parsed.orderId === undefined ? {} : { orderId: parsed.orderId }),
            ...(parsed.incidentId === undefined ? {} : { incidentId: parsed.incidentId }),
          },
        });
        return v2.uploadIntentResultSchema.parse({
          uploadId: id,
          uploadUrl: target.url,
          expiresAt: target.expiresAt.toISOString(),
          maxBytes: MAX_UPLOAD_BYTES,
          allowedMimeTypes: [...allowed],
        }) as unknown as v2.JsonValue;
      },
    );
    const capability = v2.uploadIntentResultSchema.parse(result);
    const row = await this.accessRow(capability.uploadId);
    if (!row || row.actor_id !== actor.id) throw new MediaFault('NOT_FOUND', 'Upload not found');
    if (row.state !== 'PENDING' || row.upload_expires_at.getTime() <= this.clock().getTime()) throw new MediaFault('MEDIA_NOT_READY', 'Upload target is no longer usable');
    return capability;
  }

  async finalizeUpload(token: string, uploadId: string, key: string): Promise<v2.MediaReference> {
    v2.idSchema.parse(uploadId);
    let actor = await this.actor(token);
    const result = await this.executor.execute(
      { actor, operation: 'media.upload.finalize', idempotencyKey: key, payload: { uploadId } as unknown as v2.JsonValue, traceId: randomUUID() },
      async tx => {
        actor = await this.actor(token);
        const row = await this.accessRow(uploadId, tx, true);
        if (!row || row.actor_id !== actor.id) throw new MediaFault('NOT_FOUND', 'Upload not found');
        if (!this.owns(row, actor)) throw new MediaFault('NOT_FOUND', 'Upload not found');
        if (row.state === 'DELETED' || row.deleted_at || row.retention_until.getTime() <= this.clock().getTime()) throw new MediaFault('RETENTION_EXPIRED', 'This upload was deleted by retention');
      },
      async scope => {
        const tx = scope.handle;
        const row = (await tx.query<MediaRow>(
          'SELECT * FROM media_objects WHERE id=$1 FOR UPDATE', [uploadId])).rows[0];
        if (!row) throw new MediaFault('NOT_FOUND', 'Upload not found');
        if (row.actor_id !== actor.id) throw new MediaFault('FORBIDDEN', 'This upload belongs to another actor');
        if (row.state === 'DELETED' || row.deleted_at !== null) {
          throw new MediaFault('RETENTION_EXPIRED', 'This upload was deleted by retention');
        }
        if (row.state === 'AVAILABLE') throw new MediaFault('INVALID_INPUT', 'This upload is already finalized');
        if (row.state === 'FAILED') throw new MediaFault('INVALID_INPUT', 'This upload failed validation');
        const now = this.clock();
        if (row.retention_until.getTime() <= now.getTime() || row.upload_expires_at.getTime() <= now.getTime()) {
          throw new MediaFault('RETENTION_EXPIRED', 'The upload window has closed');
        }

        const expectedKey = storageKey(row.id, row.actor_id, {
          kind: row.kind, mimeType: row.mime_type, sizeBytes: bytes(row.declared_size_bytes), purpose: row.purpose,
        });
        if (row.storage_key !== expectedKey) throw new MediaFault('INVALID_INPUT', 'Upload intent binding does not match its storage key');

        const stat = await this.storage.stat(row.storage_key);
        if (!stat) throw new MediaFault('INVALID_INPUT', 'No object was uploaded for this intent');
        if (stat.sizeBytes !== bytes(row.declared_size_bytes)) {
          throw new MediaFault('INVALID_INPUT', 'Uploaded size does not match the intent');
        }
        if (stat.mimeType !== row.mime_type) {
          throw new MediaFault('INVALID_INPUT', 'Uploaded content type does not match the intent');
        }
        if (!/^[0-9a-f]{64}$/.test(stat.sha256)) {
          throw new MediaFault('INVALID_INPUT', 'The store did not report a usable digest');
        }

        const retentionUntil = new Date(now.getTime() + this.retentionDays[row.kind] * 24 * 60 * 60_000);
        const updated = (await tx.query<MediaRow>(`UPDATE media_objects SET
          state='AVAILABLE',size_bytes=$2,digest=$3,finalized_at=$4,retention_until=$5
          WHERE id=$1 AND state='PENDING' RETURNING *`, [
          row.id, stat.sizeBytes, stat.sha256, now, retentionUntil,
        ])).rows[0];
        if (!updated) throw new MediaFault('INVALID_INPUT', 'This upload is already finalized');
        await scope.audit({
          aggregateId: row.id,
          action: 'MEDIA_UPLOAD_FINALIZED',
          reason: 'Stored object matched the upload intent',
          before: { state: row.state, declaredSizeBytes: bytes(row.declared_size_bytes) },
          after: { state: updated.state, sizeBytes: stat.sizeBytes, digest: stat.sha256, retentionUntil: retentionUntil.toISOString() },
        });
        return reference(updated) as unknown as v2.JsonValue;
      },
    );
    return v2.mediaReferenceSchema.parse(result);
  }

  /** Ownership is checked before state so an unrelated actor cannot learn
   * whether a media id exists, is pending or has expired. */
  private owns(row: AccessRow, actor: v2.Actor): boolean {
    if (actor.role === 'CUSTOMER') return row.order_customer_id === actor.id || (row.actor_role === 'CUSTOMER' && row.actor_id === actor.id);
    if (actor.role === 'FACILITY') {
      // Uploading while assigned is not permanent access to a former facility.
      const facilityId = row.order_facility_id;
      return facilityId !== null && actor.facilityIds.includes(facilityId);
    }
    return STAFF_READERS.has(actor.role);
  }

  private decide(row: AccessRow | undefined, actor: v2.Actor, now: Date): DownloadDecision {
    if (!row) {
      return { allowed: false, outcome: 'NOT_FOUND', reason: 'Media not found', fault: new MediaFault('NOT_FOUND', 'Media not found') };
    }
    if (!this.owns(row, actor)) {
      return { allowed: false, outcome: 'DENIED', reason: 'Ownership check failed', fault: new MediaFault('NOT_FOUND', 'Media not found') };
    }
    if (row.state === 'DELETED' || row.deleted_at !== null || row.retention_until.getTime() <= now.getTime()) {
      return { allowed: false, outcome: 'EXPIRED', reason: 'Retention has passed', fault: new MediaFault('RETENTION_EXPIRED', 'This media was deleted by retention') };
    }
    if (row.state !== 'AVAILABLE') {
      return { allowed: false, outcome: 'DENIED', reason: `Media state is ${row.state}`, fault: new MediaFault('MEDIA_NOT_READY', 'This media is not finalized') };
    }
    return { allowed: true };
  }

  private async accessRow(mediaId: string, client: Pool | PoolClient = this.options.db, lock = false): Promise<AccessRow | undefined> {
    return (await client.query<AccessRow>(`SELECT m.*,o.customer_id AS order_customer_id,o.facility_id AS order_facility_id
      FROM media_objects m LEFT JOIN orders_v2_orders o ON o.id=m.order_id
      WHERE m.id=$1${lock ? ' FOR UPDATE OF m' : ''}`, [mediaId])).rows[0];
  }

  /** Denials are written on their own connection so the row survives the
   * rolled-back command transaction. */
  private async logAccess(mediaId: string, actor: v2.Actor, outcome: string, reason: string): Promise<void> {
    await this.options.db.query(`INSERT INTO media_access_log (id,media_id,actor_id,actor_role,outcome,reason,occurred_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), mediaId, actor.id, actor.role, outcome, reason, this.clock()]);
  }

  async download(token: string, mediaId: string, key: string): Promise<v2.MediaDownload> {
    v2.idSchema.parse(mediaId);
    let actor = await this.actor(token);
    const now = this.clock();
    const preflight = this.decide(await this.accessRow(mediaId), actor, now);
    if (!preflight.allowed) {
      await this.logAccess(mediaId, actor, preflight.outcome, preflight.reason);
      throw preflight.fault;
    }

    const result = await this.executor.execute(
      { actor, operation: 'media.download', idempotencyKey: key, payload: { mediaId } as unknown as v2.JsonValue, traceId: randomUUID() },
      async tx => {
        actor = await this.actor(token);
        const decision = this.decide(await this.accessRow(mediaId, tx, true), actor, this.clock());
        if (!decision.allowed) throw decision.fault;
      },
      async scope => {
        const tx = scope.handle;
        const row = await this.accessRow(mediaId, tx, true);
        const decision = this.decide(row, actor, this.clock());
        if (!decision.allowed) throw decision.fault;
        if (!row) throw new MediaFault('NOT_FOUND', 'Media not found');
        const expiresAt = new Date(Math.min(this.clock().getTime() + this.downloadMinutes * 60_000, row.retention_until.getTime()));
        const target = await this.storage.createDownloadUrl({ key: row.storage_key, expiresAt });
        await tx.query(`INSERT INTO media_access_log (id,media_id,actor_id,actor_role,outcome,reason,occurred_at)
          VALUES ($1,$2,$3,$4,'ALLOWED',$5,$6)`, [
          randomUUID(), row.id, actor.id, actor.role, 'Ownership check passed', this.clock(),
        ]);
        return v2.mediaDownloadSchema.parse({
          url: target.url,
          expiresAt: target.expiresAt.toISOString(),
        }) as unknown as v2.JsonValue;
      },
    );
    const capability = v2.mediaDownloadSchema.parse(result);
    if (new Date(capability.expiresAt).getTime() <= this.clock().getTime()) throw new MediaFault('MEDIA_NOT_READY', 'Download authorization expired; request a new capability');
    return capability;
  }

  /**
   * Retention sweep. Every PENDING, AVAILABLE or FAILED object past its
   * retention boundary becomes DELETED, its bytes are removed from the store,
   * and one audit row is written per object. A second run finds nothing.
   */
  async expireMedia(now: Date = this.clock(), limit = 100): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || !Number.isFinite(now.getTime())) throw new MediaFault('INVALID_INPUT', 'Sweep requires a valid time and batch size 1..1000');
    let removed = 0;
    for (;;) {
      const batch = await this.tx(async tx => {
        const rows = (await tx.query<MediaRow>(`SELECT * FROM media_objects
          WHERE state IN ('PENDING','AVAILABLE','FAILED') AND retention_until <= $1
          ORDER BY retention_until LIMIT $2 FOR UPDATE SKIP LOCKED`, [now, limit])).rows;
        if (rows.length === 0) return 0;
        const traceId = randomUUID();
        let deleted = 0;
        for (const row of rows) {
          try {
            await this.storage.remove(row.storage_key);
          } catch {
            // Leave the row for the next sweep rather than recording a delete
            // whose bytes may still exist.
            continue;
          }
          const updated = await tx.query(
            "UPDATE media_objects SET state='DELETED',deleted_at=$2 WHERE id=$1 AND state<>'DELETED'",
            [row.id, now],
          );
          if ((updated.rowCount ?? 0) === 0) continue;
          deleted += 1;
          await tx.query(`INSERT INTO v2_audit
            (actor_id,actor_role,aggregate_id,action,reason,before_value,after_value,trace_id)
            VALUES ($1,'SYSTEM',$2,'MEDIA_RETENTION_DELETED','Retention boundary passed',$3,$4,$5)`, [
            SWEEP_ACTOR_ID, row.id,
            JSON.stringify({ state: row.state, retentionUntil: row.retention_until.toISOString() }),
            JSON.stringify({ state: 'DELETED', deletedAt: now.toISOString() }),
            traceId,
          ]);
        }
        return deleted;
      });
      removed += batch;
      if (batch < limit) return removed;
    }
  }
}
