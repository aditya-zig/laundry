import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ZodError, type ZodType } from 'zod';
import { v2 } from '@laundry/contracts';
import { createPostgresCommandExecutor } from '../../shared/src/command-executor';
import { ReviewsFault } from './errors';

/**
 * Production-v2 reviews.
 *
 * A review is only representable for a delivered order the customer owns, and
 * it is created unpublished. Publication needs three separate facts to line up:
 * recorded customer consent, approved media, and an audited operator decision.
 * A rejection is terminal, so a later operator cannot quietly flip it back.
 */
export interface ReviewsOptions {
  db: Pool;
  authenticate?: (token: string) => Promise<{ actor: v2.Actor }>;
  clock?: () => Date;
  /** B07 owns media analysis. Until it is wired, media counts as unapproved
   * and a review that carries media cannot be published. */
  mediaApproval?: (mediaIds: string[]) => Promise<boolean>;
}

interface ReviewRow {
  id: string;
  order_id: string;
  customer_id: string;
  overall: number;
  service_score: number | null;
  delivery_score: number | null;
  comment: string | null;
  media_ids: string[];
  publish_consent: boolean;
  publication: v2.ReviewPublication;
  moderation_reason: string | null;
  moderated_by: string | null;
  moderated_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface PublicRow extends ReviewRow {
  phone: string;
}

interface OrderRow {
  id: string;
  customer_id: string;
  status: v2.OrderStatus;
  version: number;
}

const CUSTOMERS = new Set<v2.ActorRole>(['CUSTOMER']);
const STAFF = new Set<v2.ActorRole>(['OPERATOR', 'SUPPORT', 'ADMIN']);

function parse<T>(schema: ZodType<T>, value: unknown, label: string): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ReviewsFault('INVALID_INPUT', `${label}: ${error.issues[0]?.message ?? 'invalid input'}`);
    }
    throw error;
  }
}

function id(value: string, label: string): string {
  return parse(v2.idSchema, value, label);
}

function cursorOf(row: { created_at: Date; id: string }): string {
  return Buffer.from(`${row.created_at.toISOString()}|${row.id}`).toString('base64url');
}

function decodeCursor(cursor: string | undefined): { at: Date; id: string } | undefined {
  if (cursor === undefined) return undefined;
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const split = raw.lastIndexOf('|');
  if (split === -1) throw new ReviewsFault('INVALID_INPUT', 'Cursor is not valid');
  const at = new Date(raw.slice(0, split));
  if (Number.isNaN(at.getTime())) throw new ReviewsFault('INVALID_INPUT', 'Cursor is not valid');
  return { at, id: raw.slice(split + 1) };
}

/** A published review names the customer without publishing a phone number. */
function displayName(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `Customer ${digits.slice(-4)}`;
}

export class ReviewsService {
  private readonly executor: ReturnType<typeof createPostgresCommandExecutor>;
  private readonly clock: () => Date;
  private readonly mediaApproval: (mediaIds: string[]) => Promise<boolean>;
  constructor(private readonly options: ReviewsOptions) {
    this.executor = createPostgresCommandExecutor(options.db);
    this.clock = options.clock ?? (() => new Date());
    this.mediaApproval = options.mediaApproval ?? (async mediaIds => mediaIds.length === 0);
  }

  private async actor(token: string): Promise<v2.Actor> {
    if (!this.options.authenticate) throw new ReviewsFault('UNAUTHENTICATED', 'Sign in again to continue');
    return (await this.options.authenticate(token)).actor;
  }

  private async actorOf(token: string, allowed: Set<v2.ActorRole>): Promise<v2.Actor> {
    const actor = await this.actor(token);
    if (!allowed.has(actor.role)) throw new ReviewsFault('FORBIDDEN', 'This operation is not permitted for your role');
    return actor;
  }

  private async rows<T extends object>(sql: string, values: unknown[] = []): Promise<T[]> {
    return (await this.options.db.query(sql, values)).rows as T[];
  }

  private review(row: ReviewRow): v2.Review {
    return parse(v2.reviewSchema, {
      id: row.id,
      orderId: row.order_id,
      customerId: row.customer_id,
      overall: row.overall,
      ...(row.service_score === null ? {} : { serviceScore: row.service_score }),
      ...(row.delivery_score === null ? {} : { deliveryScore: row.delivery_score }),
      ...(row.comment === null ? {} : { comment: row.comment }),
      mediaIds: row.media_ids,
      publishConsent: row.publish_consent,
      publication: row.publication,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      version: row.version,
      ...(row.moderation_reason === null ? {} : { moderationReason: row.moderation_reason }),
      ...(row.moderated_by === null ? {} : { moderatedBy: row.moderated_by }),
      ...(row.moderated_at === null ? {} : { moderatedAt: row.moderated_at.toISOString() }),
    }, 'Stored review is not valid');
  }

  private publicReview(row: PublicRow): v2.PublicReview {
    return parse(v2.publicReviewSchema, {
      id: row.id,
      orderId: row.order_id,
      displayName: displayName(row.phone),
      overall: row.overall,
      ...(row.service_score === null ? {} : { serviceScore: row.service_score }),
      ...(row.delivery_score === null ? {} : { deliveryScore: row.delivery_score }),
      ...(row.comment === null ? {} : { comment: row.comment }),
      mediaIds: row.media_ids,
      createdAt: row.created_at.toISOString(),
    }, 'Stored public review is not valid');
  }

  private async ownedOrder(token: string, orderId: string): Promise<{ customer: v2.Actor; order: OrderRow }> {
    const customer = await this.actorOf(token, CUSTOMERS);
    const order = (await this.options.db.query<OrderRow>(
      'SELECT id,customer_id,status,version FROM orders_v2_orders WHERE id=$1 AND customer_id=$2',
      [id(orderId, 'orderId'), customer.id],
    )).rows[0];
    if (!order) throw new ReviewsFault('NOT_FOUND', 'Order not found');
    return { customer, order };
  }

  /** Eligibility is projected from the order state and the existing review, not
   * stored, so it cannot drift from the order it describes. */
  async eligibility(token: string, orderId: string): Promise<v2.ReviewEligibility> {
    const { customer, order } = await this.ownedOrder(token, orderId);
    const existing = (await this.options.db.query<{ id: string }>(
      'SELECT id FROM reviews_v2 WHERE order_id=$1 AND customer_id=$2 ORDER BY created_at LIMIT 1', [order.id, customer.id])).rows[0];
    if (existing) {
      return { orderId: order.id, eligible: false, reason: 'This order already has a review', existingReviewId: existing.id };
    }
    if (order.status !== 'DELIVERED') {
      return { orderId: order.id, eligible: false, reason: 'Reviews open after delivery' };
    }
    return { orderId: order.id, eligible: true };
  }

  async create(token: string, orderId: string, input: v2.ReviewInput, key: string): Promise<v2.Review> {
    const parsed = parse(v2.reviewInputSchema, input, 'Review');
    const pathOrderId = id(orderId, 'orderId');
    if (parsed.orderId !== pathOrderId) throw new ReviewsFault('INVALID_INPUT', 'Order id in the body must match the path');
    const customer = await this.actorOf(token, CUSTOMERS);
    const result = await this.executor.execute(
      { actor: customer, operation: 'reviews.create', idempotencyKey: key, payload: { ...parsed, orderId: pathOrderId } as unknown as v2.JsonValue, traceId: randomUUID() },
      async () => { await this.actorOf(token, CUSTOMERS); },
      async scope => {
        const tx: PoolClient = scope.handle;
        // Serialize review creation for the order so two keys cannot both pass
        // the duplicate check before either insert commits.
        const order = (await tx.query<OrderRow>('SELECT id,customer_id,status,version FROM orders_v2_orders WHERE id=$1 AND customer_id=$2 FOR UPDATE', [pathOrderId, customer.id])).rows[0];
        if (!order) throw new ReviewsFault('NOT_FOUND', 'Order not found');
        if (order.version !== parsed.expectedVersion) {
          throw new ReviewsFault('VERSION_CONFLICT', 'Order changed since it was read', order.version);
        }
        if (order.status !== 'DELIVERED') throw new ReviewsFault('INVALID_INPUT', 'Reviews require a delivered order');
        const duplicate = (await tx.query<{ id: string }>('SELECT id FROM reviews_v2 WHERE order_id=$1 AND customer_id=$2', [order.id, customer.id])).rows[0];
        if (duplicate) throw new ReviewsFault('INVALID_INPUT', 'This order already has a review from this customer');
        const at = this.clock();
        const row = (await tx.query<ReviewRow>(`INSERT INTO reviews_v2
          (id,order_id,customer_id,overall,service_score,delivery_score,comment,media_ids,publish_consent,
           publication,moderation_reason,moderated_by,moderated_at,version,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING',NULL,NULL,NULL,1,$10,$10) RETURNING *`, [
          randomUUID(), order.id, customer.id, parsed.overall, parsed.serviceScore ?? null,
          parsed.deliveryScore ?? null, parsed.comment ?? null, JSON.stringify(parsed.mediaIds), parsed.publishConsent, at,
        ])).rows[0];
        await scope.audit({
          aggregateId: row.id,
          action: 'REVIEW_SUBMITTED',
          reason: 'Customer submitted a review',
          before: {},
          after: { orderId: order.id, overall: parsed.overall, publishConsent: parsed.publishConsent, mediaIds: parsed.mediaIds.length },
        });
        return this.review(row) as unknown as v2.JsonValue;
      },
    );
    return parse(v2.reviewSchema, result, 'Review');
  }

  async moderate(token: string, reviewId: string, input: v2.ReviewModerationInput, key: string): Promise<v2.Review> {
    const parsed = parse(v2.reviewModerationInputSchema, input, 'Review moderation');
    const actor = await this.actorOf(token, STAFF);
    const targetId = id(reviewId, 'reviewId');
    const current = (await this.options.db.query<ReviewRow>('SELECT * FROM reviews_v2 WHERE id=$1', [targetId])).rows[0];
    if (!current) throw new ReviewsFault('NOT_FOUND', 'Review not found');
    // Media approval is an external fact. Resolve it before the transaction so
    // the command lock is not held while B07 answers.
    const approved = parsed.decision !== 'PUBLISH' || await this.mediaApproval(current.media_ids);
    const result = await this.executor.execute(
      { actor, operation: 'reviews.moderate', idempotencyKey: key, payload: { ...parsed, reviewId: targetId } as unknown as v2.JsonValue, traceId: randomUUID() },
      async () => { await this.actorOf(token, STAFF); },
      async scope => {
        const tx: PoolClient = scope.handle;
        const review = (await tx.query<ReviewRow>('SELECT * FROM reviews_v2 WHERE id=$1 FOR UPDATE', [targetId])).rows[0];
        if (!review) throw new ReviewsFault('NOT_FOUND', 'Review not found');
        if (review.version !== parsed.expectedVersion) {
          throw new ReviewsFault('VERSION_CONFLICT', 'Review changed since it was read', review.version);
        }
        let publication: v2.ReviewPublication;
        if (parsed.decision === 'PUBLISH') {
          if (review.publication === 'PUBLISHED') throw new ReviewsFault('INVALID_INPUT', 'This review is already published');
          if (review.publication === 'REJECTED') throw new ReviewsFault('INVALID_INPUT', 'A rejected review cannot be published later');
          if (!review.publish_consent) throw new ReviewsFault('REQUIRES_APPROVAL', 'The customer did not consent to publication');
          if (!approved) throw new ReviewsFault('REQUIRES_APPROVAL', 'Review media is not approved for publication');
          publication = 'PUBLISHED';
        } else if (parsed.decision === 'REJECT') {
          if (review.publication === 'REJECTED') throw new ReviewsFault('INVALID_INPUT', 'This review is already rejected');
          publication = 'REJECTED';
        } else {
          if (review.publication !== 'PUBLISHED') throw new ReviewsFault('INVALID_INPUT', 'Only a published review can be hidden');
          publication = 'REJECTED';
        }
        const at = this.clock();
        const row = (await tx.query<ReviewRow>(`UPDATE reviews_v2 SET
          publication=$2,moderation_reason=$3,moderated_by=$4,moderated_at=$5,version=version+1,updated_at=$5
          WHERE id=$1 RETURNING *`, [review.id, publication, parsed.reason, actor.id, at])).rows[0];
        await tx.query(`INSERT INTO reviews_v2_moderation_events
          (id,review_id,seq,decision,from_publication,to_publication,reason,moderated_by,moderated_at)
          SELECT $1,$2,COALESCE(MAX(seq),0)+1,$3,$4,$5,$6,$7,$8 FROM reviews_v2_moderation_events WHERE review_id=$2`,
        [randomUUID(), review.id, parsed.decision, review.publication, publication, parsed.reason, actor.id, at]);
        await scope.audit({
          aggregateId: review.id,
          action: 'REVIEW_MODERATED',
          reason: parsed.reason,
          before: { publication: review.publication, version: review.version },
          after: { publication, version: row.version, decision: parsed.decision },
        });
        return this.review(row) as unknown as v2.JsonValue;
      },
    );
    return parse(v2.reviewSchema, result, 'Review');
  }

  /** The public feed is consented, published reviews only. An empty feed is a
   * valid answer, not an error and not a placeholder review. */
  async publicReviews(query: { serviceId?: string; cursor?: string; limit?: number } = {}): Promise<v2.Page<v2.PublicReview>> {
    const page = parse(v2.pageQuerySchema, { cursor: query.cursor, limit: query.limit }, 'Page query');
    const serviceId = query.serviceId === undefined ? undefined : id(query.serviceId, 'serviceId');
    const cursor = decodeCursor(page.cursor);
    const args: unknown[] = [];
    const filters = ["r.publication='PUBLISHED'", 'r.publish_consent'];
    if (serviceId !== undefined) {
      args.push(serviceId);
      filters.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(o.lines) AS line WHERE line->>'serviceId' = $${args.length})`);
    }
    if (cursor) {
      args.push(cursor.at, cursor.id);
      filters.push(`(r.created_at, r.id) < ($${args.length - 1}::timestamptz, $${args.length}::uuid)`);
    }
    args.push(page.limit + 1);
    const rows = await this.rows<PublicRow>(
      `SELECT r.*, p.phone FROM reviews_v2 r
       JOIN identity_profiles p ON p.id = r.customer_id
       JOIN orders_v2_orders o ON o.id = r.order_id
       WHERE ${filters.join(' AND ')}
       ORDER BY r.created_at DESC, r.id DESC LIMIT $${args.length}`,
      args,
    );
    const items = rows.slice(0, page.limit);
    return {
      items: items.map(row => this.publicReview(row)),
      pageInfo: {
        hasMore: rows.length > page.limit,
        ...(rows.length > page.limit && items.length > 0 ? { nextCursor: cursorOf(items[items.length - 1]) } : {}),
      },
    };
  }
}
