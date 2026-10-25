import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes, randomUUID } from 'node:crypto';
import { v2 } from '@laundry/contracts';
import { CatalogModule } from '../src/features/catalog/catalog.module';
import { configureHttpBody } from '../src/http-body';
import { EnvelopeFilter } from '../src/filters/http-exception.filter';
import { createV2Client } from '../../../packages/api-client/src/v2';
import { closePool, getPool, initializeDb } from '../../../modules/shared/src/db';
import { CatalogService } from '../../../modules/catalog/src';
import { IdentityService, type OtpDelivery } from '../../../modules/identity/src';

const operatorPhone = '+919000050001';
const customerPhone = '+919000050002';
const keys = { hashKey: randomBytes(32).toString('hex'), encryptionKey: randomBytes(32).toString('hex') };
const key = () => randomUUID();
let now: Date;
let identity: IdentityService;
let catalog: CatalogService;
let deliveries: { phone: string; code: string; challengeId: string }[];
const clock = () => now;
const TRUNCATE = `TRUNCATE catalog_services, catalog_garments, catalog_rate_cards,
  v2_command_results, v2_audit, v2_outbox, v2_inbox,
  identity_profiles, identity_otp_challenges, identity_rate_buckets, identity_session_families,
  identity_sessions, identity_command_results, identity_addresses, identity_audit,
  identity_staff, identity_staff_facilities, identity_staff_invitations, identity_staff_mfa,
  identity_staff_mfa_enrollments, identity_whatsapp_links CASCADE`;

function nextTime(ms: number) { now = new Date(now.getTime() + ms); }

async function provisionStaff(phone: string, role = 'OPERATOR') {
  await getPool().query('INSERT INTO identity_staff (id,phone,role,created_at) VALUES ($1,$2,$3,$4)', [randomUUID(), phone, role, now]);
}

async function signin(phone: string) {
  const challenge = await identity.requestOtp({ phone }, key(), 'test-peer');
  const delivery = deliveries.find(item => item.challengeId === challenge.challengeId)!;
  return identity.verifyOtp({ challengeId: challenge.challengeId, code: delivery.code }, key(), 'test-peer');
}

interface ServiceOverrides {
  code?: v2.ServiceCode;
  name?: string;
  billingUnit?: v2.Service['billingUnit'];
  active?: boolean;
}

async function insertService(overrides: ServiceOverrides = {}) {
  const id = randomUUID();
  await getPool().query(`INSERT INTO catalog_services
    (id,version,code,name,description,image_url,billing_unit,turnaround_hours,features,care_exclusions,active,created_at,updated_at)
    VALUES ($1,1,$2,$3,$4,$5,$6,$7,'["Synthetic feature"]','["Synthetic exclusion"]',$8,$9,$9)`, [
    id,
    overrides.code ?? 'WASH_FOLD',
    overrides.name ?? 'Synthetic wash and fold',
    'Synthetic service description',
    'https://assets.example.test/service.png',
    overrides.billingUnit ?? 'KG',
    48,
    overrides.active ?? true,
    now,
  ]);
  return id;
}

async function insertGarment(overrides: { eligible?: v2.ServiceCode[]; active?: boolean; priceMinor?: number } = {}) {
  const id = randomUUID();
  await getPool().query(`INSERT INTO catalog_garments (id,name,eligible_service_codes,price_minor,active,created_at)
    VALUES ($1,$2,$3,$4,$5,$6)`, [
    id,
    'Synthetic shirt',
    JSON.stringify(overrides.eligible ?? ['WASH_FOLD', 'WASH_PRESS']),
    overrides.priceMinor ?? null,
    overrides.active ?? true,
    now,
  ]);
  return id;
}

function rateInput(overrides: Partial<v2.RateCardInput> = {}): v2.RateCardInput {
  return {
    serviceCodes: ['WASH_FOLD'],
    components: [{ label: 'Synthetic per kg', kind: 'PER_KG', amountMinor: 4000, synthetic: true }],
    weightIncrementGrams: 500,
    minimumBillableGrams: 1000,
    rounding: 'CEIL',
    effectiveFrom: '2026-10-01T00:00:00.000Z',
    synthetic: true,
    ...overrides,
  };
}

async function approvedCard(token: string, overrides: Partial<v2.RateCardInput> = {}) {
  const draft = await catalog.createRateCard(token, rateInput(overrides), key());
  await catalog.approveRateCard(token, draft.id, { expectedVersion: draft.version, reason: 'Synthetic approval' }, key());
  return catalog.activateRateCard(token, draft.id, { expectedVersion: draft.version, reason: 'Synthetic activation' }, key());
}

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/laundry_verify_')) {
    throw new Error('Disposable local PostgreSQL required');
  }
  await initializeDb();
});
beforeEach(async () => {
  await getPool().query(TRUNCATE);
  now = new Date('2026-10-25T06:00:00Z');
  deliveries = [];
  const provider: OtpDelivery = { mode: 'FAKE', async send(input) { deliveries.push(input); return { reference: `fake-${input.challengeId}` }; } };
  identity = new IdentityService({ db: getPool(), provider, ...keys, clock });
  catalog = new CatalogService({ db: getPool(), authenticate: token => identity.authenticate(token), clock });
});
afterAll(closePool);

describe('B02 public catalog reads', () => {
  it('publishes only active services and active garments eligible for them', async () => {
    const wash = await insertService();
    const retired = await insertService({ code: 'DRY_CLEAN', name: 'Synthetic dry clean', active: false });
    const shirt = await insertGarment();
    await insertGarment({ eligible: ['DRY_CLEAN'], active: false });

    const listed = await catalog.listServices();
    expect(listed.map(service => service.id)).toEqual([wash]);
    expect(listed[0].garments.map(item => item.id)).toEqual([shirt]);
    expect(listed[0]).toMatchObject({ version: 1, billingUnit: 'KG', turnaroundHours: 48, active: true });

    await expect(catalog.getService(retired)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await provisionStaff(operatorPhone);
    const operator = await signin(operatorPhone);
    await expect(catalog.getService(retired, operator.accessToken)).resolves.toMatchObject({ id: retired, active: false });
    await expect(catalog.getService(retired, 'not-a-real-token')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await catalog.listGarmentEligibility()).map(item => item.id)).toEqual([shirt]);
  });

  it('serves only approved, activated and already effective rate cards', async () => {
    const wash = await insertService();
    await provisionStaff(operatorPhone);
    const operator = await signin(operatorPhone);

    expect(await catalog.effectiveRates('WASH_FOLD')).toEqual([]);
    const first = await catalog.createRateCard(operator.accessToken, rateInput(), key());
    expect(first).toMatchObject({ version: 1, synthetic: true });
    expect(first.approvedAt).toBeUndefined();
    expect(await catalog.effectiveRates('WASH_FOLD')).toEqual([]);

    await catalog.approveRateCard(operator.accessToken, first.id, { expectedVersion: 1, reason: 'Approved synthetic rate' }, key());
    expect(await catalog.effectiveRates('WASH_FOLD')).toEqual([]);
    await catalog.activateRateCard(operator.accessToken, first.id, { expectedVersion: 1, reason: 'Activated synthetic rate' }, key());
    expect(await catalog.effectiveRates('WASH_FOLD')).toEqual([{
      serviceCode: 'WASH_FOLD',
      billingUnit: 'KG',
      unitPriceMinor: 4000,
      unitLabel: 'per kg',
      weightIncrementGrams: 500,
      minimumBillableGrams: 1000,
      rateCardVersion: 1,
      synthetic: true,
    }]);

    const future = await catalog.createRateCard(operator.accessToken, rateInput({
      effectiveFrom: '2026-11-01T00:00:00.000Z',
      components: [{ label: 'Future per kg', kind: 'PER_KG', amountMinor: 5000, synthetic: true }],
    }), key());
    await catalog.approveRateCard(operator.accessToken, future.id, { expectedVersion: future.version, reason: 'Approved future rate' }, key());
    await catalog.activateRateCard(operator.accessToken, future.id, { expectedVersion: future.version, reason: 'Activated future rate' }, key());
    expect((await catalog.effectiveRates('WASH_FOLD'))[0].rateCardVersion).toBe(1);

    nextTime(10 * 24 * 60 * 60_000);
    expect(await catalog.effectiveRates('WASH_FOLD')).toMatchObject([{ unitPriceMinor: 5000, rateCardVersion: 2 }]);

    await getPool().query('UPDATE catalog_services SET active=false WHERE id=$1', [wash]);
    await expect(catalog.effectiveRates('WASH_FOLD')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await catalog.effectiveRates()).toEqual([]);
  });
});

describe('B02 operator catalog administration', () => {
  it('bumps one version, replays one idempotent update and refuses stale writes', async () => {
    const serviceId = await insertService();
    await provisionStaff(operatorPhone);
    const operator = await signin(operatorPhone);
    const customer = await signin(customerPhone);

    await expect(catalog.updateService(customer.accessToken, serviceId, { expectedVersion: 1, reason: 'Not allowed', name: 'Nope' }, key()))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(catalog.updateService(operator.accessToken, serviceId, { expectedVersion: 1, reason: 'Not editable here', garments: [] }, key()))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });

    const updateKey = key();
    const input: v2.ServiceUpdate = { expectedVersion: 1, reason: 'Correct synthetic display name', name: 'Synthetic wash and fold v2' };
    const updated = await catalog.updateService(operator.accessToken, serviceId, input, updateKey);
    expect(updated).toMatchObject({ version: 2, name: 'Synthetic wash and fold v2', active: true });
    await expect(catalog.updateService(operator.accessToken, serviceId, input, updateKey)).resolves.toEqual(updated);
    await expect(catalog.updateService(operator.accessToken, serviceId, { ...input, name: 'Different intent' }, updateKey))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const audits = await getPool().query("SELECT actor_id, action, reason FROM v2_audit WHERE action='CATALOG_SERVICE_UPDATED'");
    expect(audits.rows).toEqual([{ actor_id: operator.actor.id, action: 'CATALOG_SERVICE_UPDATED', reason: 'Correct synthetic display name' }]);

    await expect(catalog.updateService(operator.accessToken, serviceId, { expectedVersion: 1, reason: 'Stale write', name: 'Stale name' }, key()))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 2 });

    const retired = await catalog.updateService(operator.accessToken, serviceId, { expectedVersion: 2, reason: 'Temporarily retire', active: false }, key());
    expect(retired.active).toBe(false);
    expect(await catalog.listServices()).toEqual([]);
    await expect(catalog.getService(serviceId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('approves and activates exactly once and refuses out-of-order lifecycle calls', async () => {
    await insertService();
    await provisionStaff(operatorPhone);
    const operator = await signin(operatorPhone);
    const draft = await catalog.createRateCard(operator.accessToken, rateInput(), key());

    await expect(catalog.activateRateCard(operator.accessToken, draft.id, { expectedVersion: 1, reason: 'Too early' }, key()))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await expect(catalog.approveRateCard(operator.accessToken, draft.id, { expectedVersion: 7, reason: 'Wrong version' }, key()))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 1 });

    const approved = await catalog.approveRateCard(operator.accessToken, draft.id, { expectedVersion: 1, reason: 'Approved' }, key());
    expect(approved.approvedAt).toBe(now.toISOString());
    expect(approved.version).toBe(1);
    expect(approved.activatedAt).toBeUndefined();
    await expect(catalog.approveRateCard(operator.accessToken, draft.id, { expectedVersion: 1, reason: 'Approve again' }, key()))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' });

    const activated = await catalog.activateRateCard(operator.accessToken, draft.id, { expectedVersion: 1, reason: 'Live' }, key());
    expect(activated.activatedAt).toBe(now.toISOString());
    await expect(catalog.activateRateCard(operator.accessToken, draft.id, { expectedVersion: 1, reason: 'Activate again' }, key()))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' });

    const actions = (await getPool().query("SELECT action FROM v2_audit WHERE aggregate_id=$1 ORDER BY occurred_at", [draft.id])).rows.map(row => row.action);
    expect(actions).toEqual(['RATE_CARD_DRAFTED', 'RATE_CARD_APPROVED', 'RATE_CARD_ACTIVATED']);
    expect((await getPool().query('SELECT * FROM v2_command_results')).rowCount).toBe(3);
  });

  it('refuses rate cards that cannot be priced deterministically', async () => {
    await insertService();
    await provisionStaff(operatorPhone);
    const operator = await signin(operatorPhone);
    const base = rateInput();
    await expect(catalog.createRateCard(operator.accessToken, {
      ...base, components: [{ label: 'Mystery', kind: 'INCREMENT', amountMinor: 100, synthetic: true }],
    }, key())).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(catalog.createRateCard(operator.accessToken, {
      ...base,
      components: [
        { label: 'A', kind: 'PER_KG', amountMinor: 1000, synthetic: true },
        { label: 'B', kind: 'PER_KG', amountMinor: 2000, synthetic: true },
      ],
    }, key())).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(catalog.createRateCard(operator.accessToken, { ...base, weightIncrementGrams: undefined }, key()))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(catalog.createRateCard(operator.accessToken, {
      ...base, components: [{ label: 'Negative', kind: 'PER_KG', amountMinor: -1, synthetic: true }],
    }, key())).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect((await getPool().query('SELECT * FROM catalog_rate_cards')).rowCount).toBe(0);
  });
});

describe('B02 catalog through the real SDK over HTTP', () => {
  let app: NestExpressApplication;
  let base: string;
  beforeEach(async () => {
    app = await NestFactory.create<NestExpressApplication>(CatalogModule.register(() => catalog), { logger: false });
    configureHttpBody(app);
    app.useGlobalFilters(new EnvelopeFilter());
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()) + '/v2';
  });
  afterEach(async () => { await app?.close(); });

  it('serves public reads and scoped operator writes with contract envelopes', async () => {
    const serviceId = await insertService();
    await provisionStaff(operatorPhone);
    const operator = await signin(operatorPhone);
    let bearer: string | undefined;
    const client = createV2Client({ baseUrl: base, getToken: () => bearer });

    expect((await client.listServices()).map(service => service.id)).toEqual([serviceId]);
    expect(await client.getService(serviceId)).toMatchObject({ id: serviceId, version: 1 });
    expect(await client.getEffectiveRates({ serviceCode: 'WASH_FOLD' })).toEqual([]);

    const missingFilter = await fetch(base + '/catalog/rates/effective');
    expect(missingFilter.status).toBe(400);
    expect(v2.errorEnvelopeSchema.parse(await missingFilter.json()).code).toBe('INVALID_INPUT');

    const anonymous = await fetch(base + `/ops/catalog/services/${serviceId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', 'idempotency-key': key() },
      body: JSON.stringify({ expectedVersion: 1, reason: 'Anonymous write', name: 'Nope' }),
    });
    expect(anonymous.status).toBe(401);
    expect(v2.errorEnvelopeSchema.parse(await anonymous.json()).code).toBe('UNAUTHENTICATED');

    bearer = operator.accessToken;
    const draft = await client.createRateCard(rateInput());
    await client.approveRateCard(draft.id, { expectedVersion: 1, reason: 'Approved over HTTP' });
    await client.activateRateCard(draft.id, { expectedVersion: 1, reason: 'Activated over HTTP' });
    expect(await client.getEffectiveRates({ serviceCode: 'WASH_FOLD' })).toMatchObject([{ unitPriceMinor: 4000, rateCardVersion: 1 }]);

    const updated = await client.updateService(serviceId, { expectedVersion: 1, reason: 'Rename over HTTP', name: 'Synthetic renamed' });
    expect(updated.version).toBe(2);
    const stale = await fetch(base + `/ops/catalog/services/${serviceId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}`, 'idempotency-key': key() },
      body: JSON.stringify({ expectedVersion: 1, reason: 'Stale over HTTP', name: 'Stale' }),
    });
    expect(stale.status).toBe(409);
    expect(stale.headers.get('cache-control')).toBe('no-store');
    expect(v2.errorEnvelopeSchema.parse(await stale.json())).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 2 });
  });
});
