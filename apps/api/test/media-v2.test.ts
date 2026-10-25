import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes, randomUUID } from 'node:crypto';
import { v2 } from '@laundry/contracts';
import { MediaModule } from '../src/features/media/media.module';
import { configureHttpBody } from '../src/http-body';
import { EnvelopeFilter } from '../src/filters/http-exception.filter';
import { closePool, getPool, initializeDb } from '../../../modules/shared/src/db';
import { MediaService, createMemoryStorage, type MemoryStorage } from '../../../modules/media/src';
import { IdentityService, type OtpDelivery } from '../../../modules/identity/src';

const customerAPhone = '+919000080001';
const customerBPhone = '+919000080002';
const operatorPhone = '+919000080003';
const facilityPhone = '+919000080004';
const otherFacilityPhone = '+919000080005';
const riderPhone = '+919000080006';

const keys = { hashKey: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex') };
const key = () => randomUUID();
const TRUNCATE = `TRUNCATE media_objects, media_access_log,
  orders_v2_quotes, orders_v2_orders, orders_v2_timeline, orders_v2_adjustments,
  v2_command_results, v2_audit, v2_outbox, v2_inbox,
  identity_profiles, identity_otp_challenges, identity_rate_buckets, identity_session_families,
  identity_sessions, identity_command_results, identity_addresses, identity_audit,
  identity_staff, identity_staff_facilities, identity_staff_invitations, identity_staff_mfa,
  identity_staff_mfa_enrollments CASCADE`;

let now: Date;
let identity: IdentityService;
let media: MediaService;
let storage: MemoryStorage;
let deliveries: { phone: string; code: string; challengeId: string }[];
const clock = () => now;

function nextTime(ms: number) {
  now = new Date(now.getTime() + ms);
}

async function provisionStaff(phone: string, role: string, facilityIds: string[] = []) {
  const id = randomUUID();
  await getPool().query('INSERT INTO identity_staff (id,phone,role,created_at) VALUES ($1,$2,$3,$4)', [id, phone, role, now]);
  for (const facilityId of facilityIds) {
    await getPool().query('INSERT INTO identity_staff_facilities (staff_id,facility_id) VALUES ($1,$2)', [id, facilityId]);
  }
}

async function signin(phone: string) {
  const challenge = await identity.requestOtp({ phone }, key(), 'test-peer');
  const delivery = deliveries.find(item => item.challengeId === challenge.challengeId)!;
  return identity.verifyOtp({ challengeId: challenge.challengeId, code: delivery.code }, key(), 'test-peer');
}

async function seedOrder(customerId: string, facilityId: string | null): Promise<string> {
  const quoteId = randomUUID();
  const orderId = randomUUID();
  await getPool().query(`INSERT INTO orders_v2_quotes
    (id,version,customer_id,status,area_id,address_id,address_snapshot,lines,rate_cards,breakdown,
     total_minor,currency,provisional,pickup_window,return_window,catalog_version,expires_at,created_at)
    VALUES ($1,1,$2,'BOOKED',$3,$4,$5,$6,'[]','[]',0,'INR',false,$7,$8,1,$9,$9)`, [
    quoteId, customerId, randomUUID(), randomUUID(),
    JSON.stringify({ line1: '1 Synthetic Road' }), JSON.stringify([{ label: 'Synthetic line' }]),
    JSON.stringify({ start: '2026-10-26T03:30:00.000Z', end: '2026-10-26T04:30:00.000Z' }),
    JSON.stringify({ start: '2026-10-28T03:30:00.000Z', end: '2026-10-28T04:30:00.000Z' }),
    now,
  ]);
  await getPool().query(`INSERT INTO orders_v2_orders
    (id,version,status,customer_id,facility_id,quote_id,area_id,address_snapshot,lines,rate_cards,
     containers,measured_lines,total_minor,currency,payment_model,pickup_window,return_window,hold_id,
     resume_status,quality_check_passed,created_at,updated_at)
    VALUES ($1,1,'CONFIRMED',$2,$3,$4,$5,$6,$7,'[]','[]'::jsonb,NULL,0,'INR','DUE_AT_RETURN',$8,$9,NULL,NULL,false,$10,$10)`, [
    orderId, customerId, facilityId, quoteId, randomUUID(),
    JSON.stringify({ line1: '1 Synthetic Road' }), JSON.stringify([{ label: 'Synthetic line' }]),
    JSON.stringify({ start: '2026-10-26T03:30:00.000Z', end: '2026-10-26T04:30:00.000Z' }),
    JSON.stringify({ start: '2026-10-28T03:30:00.000Z', end: '2026-10-28T04:30:00.000Z' }),
    now,
  ]);
  return orderId;
}

async function intent(token: string, input: Partial<v2.UploadIntent> = {}, idem = key()) {
  return media.createUploadIntent(token, {
    kind: 'PROOF_IMAGE',
    mimeType: 'image/jpeg',
    sizeBytes: 8,
    purpose: 'Pickup condition evidence',
    ...input,
  }, idem);
}

function upload(target: v2.UploadIntentResult, body: Buffer = Buffer.from('evidence'), mimeType = 'image/jpeg') {
  storage.upload(target.uploadUrl, body, mimeType);
}

async function accepted(token: string, input: Partial<v2.UploadIntent> = {}) {
  const created = await intent(token, input);
  upload(created, Buffer.from('evidence'), input.mimeType ?? 'image/jpeg');
  const reference = await media.finalizeUpload(token, created.uploadId, key());
  return { created, reference };
}

const accessLog = async (mediaId: string) =>
  (await getPool().query<{ outcome: string; actor_role: string; reason: string }>(
    'SELECT outcome,actor_role,reason FROM media_access_log WHERE media_id=$1 ORDER BY occurred_at,outcome', [mediaId])).rows;

const mediaRow = async (mediaId: string) =>
  (await getPool().query<{ state: string; size_bytes: string | null; digest: string | null; retention_until: Date }>(
    'SELECT state,size_bytes,digest,retention_until FROM media_objects WHERE id=$1', [mediaId])).rows[0];

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/laundry_verify_')) {
    throw new Error('Disposable local PostgreSQL required');
  }
  await initializeDb();
  // The proposal is applied after the canonical migrations, exactly as the
  // coordinator integration would apply it.
  const proposal = readFileSync(new URL('../../../modules/schema/proposals/B07.sql', import.meta.url), 'utf8');
  await getPool().query(proposal);
});

beforeEach(async () => {
  await getPool().query(TRUNCATE);
  now = new Date('2026-10-26T02:00:00Z');
  deliveries = [];
  const provider: OtpDelivery = { mode: 'FAKE', async send(input) { deliveries.push(input); return { reference: `fake-${input.challengeId}` }; } };
  identity = new IdentityService({ db: getPool(), provider, ...keys, clock });
  storage = createMemoryStorage();
  media = new MediaService({ db: getPool(), authenticate: token => identity.authenticate(token), storage, clock });
});

afterAll(closePool);

describe('B07-01 ownership boundaries', () => {
  it('lets the owning customer, owning-facility staff and operators read, and returns no data to everyone else', async () => {
    const facilityId = randomUUID();
    const otherFacilityId = randomUUID();
    const customerA = await signin(customerAPhone);
    const customerB = await signin(customerBPhone);
    await provisionStaff(facilityPhone, 'FACILITY', [facilityId]);
    await provisionStaff(otherFacilityPhone, 'FACILITY', [otherFacilityId]);
    await provisionStaff(riderPhone, 'RIDER');
    await provisionStaff(operatorPhone, 'OPERATOR');
    const facility = await signin(facilityPhone);
    const otherFacility = await signin(otherFacilityPhone);
    const rider = await signin(riderPhone);
    const operator = await signin(operatorPhone);
    const orderId = await seedOrder(customerA.actor.id, facilityId);

    const { created, reference } = await accepted(customerA.accessToken, { orderId });
    expect(reference).toMatchObject({ kind: 'PROOF_IMAGE', visibility: 'PRIVATE', ownerId: customerA.actor.id, status: 'AVAILABLE' });
    expect(reference.checksum).toMatch(/^[0-9a-f]{64}$/);

    const owner = await media.download(customerA.accessToken, created.uploadId, key());
    expect(storage.verifyDownloadUrl(owner.url, now)).toBe(true);

    await expect(media.download(customerB.accessToken, created.uploadId, key())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(media.download(rider.accessToken, created.uploadId, key())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(media.download(otherFacility.accessToken, created.uploadId, key())).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const atFacility = await media.download(facility.accessToken, created.uploadId, key());
    expect(storage.verifyDownloadUrl(atFacility.url, now)).toBe(true);
    await media.download(operator.accessToken, created.uploadId, key());

    const log = await accessLog(created.uploadId);
    expect(log.filter(row => row.outcome === 'ALLOWED')).toHaveLength(3);
    expect(log.filter(row => row.outcome === 'DENIED')).toHaveLength(3);
  });

  it('lets the owning customer read proof uploaded by facility staff', async () => {
    const facilityId = randomUUID();
    const customerA = await signin(customerAPhone);
    await provisionStaff(facilityPhone, 'FACILITY', [facilityId]);
    const facility = await signin(facilityPhone);
    const orderId = await seedOrder(customerA.actor.id, facilityId);

    const { created } = await accepted(facility.accessToken, { orderId, kind: 'VOICE_NOTE', mimeType: 'audio/webm', sizeBytes: 8 });
    const view = await media.download(customerA.accessToken, created.uploadId, key());
    expect(storage.verifyDownloadUrl(view.url, now)).toBe(true);

    const customerB = await signin(customerBPhone);
    await expect(media.download(customerB.accessToken, created.uploadId, key())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses an intent that names an order the actor cannot see', async () => {
    const customerA = await signin(customerAPhone);
    const customerB = await signin(customerBPhone);
    await provisionStaff(facilityPhone, 'FACILITY', [randomUUID()]);
    const facility = await signin(facilityPhone);
    const orderId = await seedOrder(customerA.actor.id, randomUUID());

    await expect(intent(customerB.accessToken, { orderId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(intent(facility.accessToken, { orderId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(intent(customerA.accessToken, { orderId })).resolves.toMatchObject({ maxBytes: 10_000_000 });
  });
});

describe('B07-02 upload validation', () => {
  it('rejects a disallowed MIME type, an oversized declaration and a catalog asset', async () => {
    const customer = await signin(customerAPhone);
    await expect(intent(customer.accessToken, { mimeType: 'application/x-msdownload' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(intent(customer.accessToken, { mimeType: 'application/pdf' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(intent(customer.accessToken, { sizeBytes: 10_000_001 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(intent(customer.accessToken, { kind: 'CATALOG_ASSET' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect((await getPool().query('SELECT count(*)::int AS n FROM media_objects')).rows[0].n).toBe(0);
  });

  it('never accepts an object whose stored size, MIME type or existence differs from the intent', async () => {
    const customer = await signin(customerAPhone);

    const wrongMime = await intent(customer.accessToken);
    upload(wrongMime, Buffer.from('evidence'), 'image/png');
    await expect(media.finalizeUpload(customer.accessToken, wrongMime.uploadId, key())).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    const wrongSize = await intent(customer.accessToken);
    upload(wrongSize, Buffer.from('ninebytes'), 'image/jpeg');
    await expect(media.finalizeUpload(customer.accessToken, wrongSize.uploadId, key())).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    const missing = await intent(customer.accessToken);
    await expect(media.finalizeUpload(customer.accessToken, missing.uploadId, key())).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    expect(await mediaRow(wrongMime.uploadId)).toMatchObject({ state: 'PENDING', size_bytes: null });
    expect(await mediaRow(wrongSize.uploadId)).toMatchObject({ state: 'PENDING' });
    expect(await mediaRow(missing.uploadId)).toMatchObject({ state: 'PENDING' });
    await expect(media.download(customer.accessToken, missing.uploadId, key())).rejects.toMatchObject({ code: 'MEDIA_NOT_READY' });
  });
});

describe('B07-03 private short-lived reads', () => {
  it('signs a download URL that expires and that the store will not serve after expiry', async () => {
    const customer = await signin(customerAPhone);
    const { created, reference } = await accepted(customer.accessToken);
    const view = await media.download(customer.accessToken, created.uploadId, key());

    expect(new Date(view.expiresAt).getTime()).toBe(now.getTime() + 5 * 60_000);
    expect(storage.verifyDownloadUrl(view.url, now)).toBe(true);
    nextTime(6 * 60_000);
    expect(storage.verifyDownloadUrl(view.url, now)).toBe(false);
    expect(new URL(view.url).searchParams.get('signature')).toMatch(/^[0-9a-f]{40}$/);
    const row = await mediaRow(created.uploadId);
    expect(reference.expiresAt).toBe(row.retention_until.toISOString());
  });

  it('refuses an object past its retention boundary even before the sweep runs', async () => {
    const customer = await signin(customerAPhone);
    const { created } = await accepted(customer.accessToken);
    nextTime(91 * 24 * 60 * 60_000);
    const renewed = await signin(customerAPhone);

    await expect(media.download(renewed.accessToken, created.uploadId, key())).rejects.toMatchObject({ code: 'RETENTION_EXPIRED' });
    expect((await accessLog(created.uploadId)).at(-1)).toMatchObject({ outcome: 'EXPIRED' });
    expect(await mediaRow(created.uploadId)).toMatchObject({ state: 'AVAILABLE' });
  });
});

describe('B07-04 idempotent uploads and retention deletion', () => {
  it('returns one intent for a replayed key and refuses the same key with a changed payload', async () => {
    const customer = await signin(customerAPhone);
    const uploadKey = key();
    const first = await intent(customer.accessToken, {}, uploadKey);
    const replay = await intent(customer.accessToken, {}, uploadKey);
    expect(replay.uploadId).toBe(first.uploadId);
    expect(replay.uploadUrl).toBe(first.uploadUrl);
    expect((await getPool().query('SELECT count(*)::int AS n FROM media_objects')).rows[0].n).toBe(1);

    await expect(intent(customer.accessToken, { purpose: 'A different purpose' }, uploadKey))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('finalizes exactly once, replays the same key and refuses a second actor or a second finalize', async () => {
    const customer = await signin(customerAPhone);
    const customerB = await signin(customerBPhone);
    const created = await intent(customer.accessToken);
    upload(created);

    await expect(media.finalizeUpload(customerB.accessToken, created.uploadId, key())).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const finalizeKey = key();
    const first = await media.finalizeUpload(customer.accessToken, created.uploadId, finalizeKey);
    const replay = await media.finalizeUpload(customer.accessToken, created.uploadId, finalizeKey);
    expect(replay).toEqual(first);
    await expect(media.finalizeUpload(customer.accessToken, created.uploadId, key())).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    const row = await mediaRow(created.uploadId);
    expect(row).toMatchObject({ state: 'AVAILABLE', size_bytes: '8' });
    expect(row.digest).toMatch(/^[0-9a-f]{64}$/);
    expect((await getPool().query("SELECT count(*)::int AS n FROM v2_audit WHERE action='MEDIA_UPLOAD_FINALIZED'")).rows[0].n).toBe(1);
  });

  it('deletes available, orphaned and failed objects past retention, removes bytes and audits each one', async () => {
    const customer = await signin(customerAPhone);
    const available = await accepted(customer.accessToken);
    const orphan = await intent(customer.accessToken);
    const failed = await intent(customer.accessToken);
    await getPool().query("UPDATE media_objects SET state='FAILED' WHERE id=$1", [failed.uploadId]);
    storage.upload(failed.uploadUrl, Buffer.from('evidence'), 'image/jpeg');
    expect(storage.objectCount()).toBe(2);

    expect(await media.expireMedia(now)).toBe(0);

    nextTime(16 * 60_000);
    expect(await media.expireMedia(now)).toBe(2);
    expect(await mediaRow(available.created.uploadId)).toMatchObject({ state: 'AVAILABLE' });
    expect(await mediaRow(orphan.uploadId)).toMatchObject({ state: 'DELETED' });
    expect(await mediaRow(failed.uploadId)).toMatchObject({ state: 'DELETED' });
    expect(storage.objectCount()).toBe(1);
    expect(await media.expireMedia(now)).toBe(0);
    expect((await getPool().query("SELECT count(*)::int AS n FROM v2_audit WHERE action='MEDIA_RETENTION_DELETED'")).rows[0].n).toBe(2);

    nextTime(91 * 24 * 60 * 60_000);
    expect(await media.expireMedia(now)).toBe(1);
    expect(await media.expireMedia(now)).toBe(0);
    expect(storage.objectCount()).toBe(0);
    expect((await getPool().query("SELECT count(*)::int AS n FROM v2_audit WHERE action='MEDIA_RETENTION_DELETED'")).rows[0].n).toBe(3);
    const renewed = await signin(customerAPhone);
    await expect(media.download(renewed.accessToken, available.created.uploadId, key())).rejects.toMatchObject({ code: 'RETENTION_EXPIRED' });
  });
});

describe('B07 routes over HTTP', () => {
  let app: NestExpressApplication;
  let base: string;
  beforeEach(async () => {
    app = await NestFactory.create<NestExpressApplication>(MediaModule.register(() => media), { logger: false });
    configureHttpBody(app);
    app.useGlobalFilters(new EnvelopeFilter());
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()) + '/v2';
  });
  afterEach(async () => { await app?.close(); });

  it('serves an intent, finalize and download without ever exposing public bytes', async () => {
    const customer = await signin(customerAPhone);
    const customerB = await signin(customerBPhone);

    const uploadUrl = `${base}/media/upload-intents`;
    const intentResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${customer.accessToken}`, 'idempotency-key': key(), 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'PROOF_IMAGE', mimeType: 'image/jpeg', sizeBytes: 8, purpose: 'Pickup condition evidence' }),
    });
    expect(intentResponse.status).toBe(200);
    const intentBody = v2.uploadIntentResultSchema.parse(await intentResponse.json());

    storage.upload(intentBody.uploadUrl, Buffer.from('evidence'), 'image/jpeg');
    const finalized = await fetch(`${base}/media/${intentBody.uploadId}/finalize`, {
      method: 'POST',
      headers: { authorization: `Bearer ${customer.accessToken}`, 'idempotency-key': key() },
    });
    expect(finalized.status).toBe(200);
    expect(v2.mediaReferenceSchema.parse(await finalized.json())).toMatchObject({ id: intentBody.uploadId, status: 'AVAILABLE' });

    const downloaded = await fetch(`${base}/media/${intentBody.uploadId}/download`, {
      method: 'POST',
      headers: { authorization: `Bearer ${customer.accessToken}`, 'idempotency-key': key() },
    });
    expect(downloaded.status).toBe(200);
    expect(storage.verifyDownloadUrl(v2.mediaDownloadSchema.parse(await downloaded.json()).url, now)).toBe(true);

    const stranger = await fetch(`${base}/media/${intentBody.uploadId}/download`, {
      method: 'POST',
      headers: { authorization: `Bearer ${customerB.accessToken}`, 'idempotency-key': key() },
    });
    expect(stranger.status).toBe(404);
    expect(v2.errorEnvelopeSchema.parse(await stranger.json()).code).toBe('NOT_FOUND');

    const anonymous = await fetch(`${base}/media/${intentBody.uploadId}/download`, { method: 'POST' });
    expect(anonymous.status).toBe(401);
    expect(v2.errorEnvelopeSchema.parse(await anonymous.json()).code).toBe('UNAUTHENTICATED');

    const missingKey = await fetch(`${base}/media/${intentBody.uploadId}/download`, {
      method: 'POST',
      headers: { authorization: `Bearer ${customer.accessToken}` },
    });
    expect(missingKey.status).toBe(400);
    expect(v2.errorEnvelopeSchema.parse(await missingKey.json()).code).toBe('INVALID_INPUT');

    // There is no GET object route; private bytes are never served directly.
    const direct = await fetch(`${base}/media/${intentBody.uploadId}`, {
      headers: { authorization: `Bearer ${customer.accessToken}` },
    });
    expect(direct.status).toBe(404);
  });
});
