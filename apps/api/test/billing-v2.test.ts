import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { v2 } from '@laundry/contracts';
import { BillingV2Module } from '../src/features/billing-v2/billing-v2.module';
import { createV2Client, V2ApiError } from '../../../packages/api-client/src/v2';
import { closePool, getPool, initializeDb } from '../../../modules/shared/src/db';
import { BillingService, FakePaymentProvider, createObligationForOrder } from '../../../modules/billing/src';
import { BillingFault } from '../../../modules/billing/src/v2-errors';

const customerToken = 'c'.repeat(43);
const otherToken = 'd'.repeat(43);
const operatorToken = 'o'.repeat(43);
const customerId = randomUUID();
const otherCustomerId = randomUUID();
const operatorId = randomUUID();
const secret = 'billing-test-secret-do-not-use';

const customerActor: v2.Actor = {
  id: customerId, role: 'CUSTOMER', facilityIds: [], scope: { facilityIds: [] },
};
const otherActor: v2.Actor = {
  id: otherCustomerId, role: 'CUSTOMER', facilityIds: [], scope: { facilityIds: [] },
};
const operatorActor: v2.Actor = {
  id: operatorId, role: 'OPERATOR', facilityIds: [], scope: { facilityIds: [] },
};

const actors: Record<string, v2.Actor> = {
  [customerToken]: customerActor,
  [otherToken]: otherActor,
  [operatorToken]: operatorActor,
};

const key = () => randomUUID();
let now: Date;
let billing: BillingService;

const clock = () => now;
const window = { start: '2026-10-27T03:30:00.000Z', end: '2026-10-27T04:30:00.000Z', timezone: 'Asia/Kolkata' };
const returnWindow = { start: '2026-10-29T03:30:00.000Z', end: '2026-10-29T04:30:00.000Z', timezone: 'Asia/Kolkata' };
const addressSnapshot = {
  label: 'Home', line1: '1 Synthetic Road', city: 'Bengaluru', postalCode: '560001',
  coordinates: { lat: 12.95, lng: 77.6 },
};

const TRUNCATE = `TRUNCATE billing_reconciliation_entries, billing_provider_events, billing_refunds,
  billing_receipts, billing_payment_attempts, billing_obligations,
  orders_v2_timeline, orders_v2_adjustments, orders_v2_orders, orders_v2_quotes,
  v2_command_results, v2_audit, v2_outbox, v2_inbox CASCADE`;

function sign(raw: Buffer): string {
  return createHmac('sha256', secret).update(raw).digest('hex');
}

function signedEvent(payload: v2.PaymentWebhook): { raw: Buffer; signature: string } {
  const raw = Buffer.from(JSON.stringify(payload));
  return { raw, signature: sign(raw) };
}

async function seedOrder(totalMinor: number, ownerId = customerId): Promise<string> {
  const quoteId = randomUUID();
  const orderId = randomUUID();
  const lines = JSON.stringify([{ label: 'Synthetic basket' }]);
  await getPool().query(
    `INSERT INTO orders_v2_quotes
      (id,version,customer_id,status,area_id,address_id,address_snapshot,lines,rate_cards,breakdown,
       total_minor,currency,provisional,pickup_window,return_window,hold_reference,hold_expires_at,
       catalog_version,expires_at,created_at)
     VALUES ($1,1,$2,'BOOKED',$3,$4,$5,$6,'[]'::jsonb,'[]'::jsonb,$7,'INR',false,$8,$9,NULL,NULL,1,$10,$10)`,
    [
      quoteId, ownerId, randomUUID(), randomUUID(), JSON.stringify(addressSnapshot), lines,
      totalMinor, JSON.stringify(window), JSON.stringify(returnWindow), now,
    ],
  );
  await getPool().query(
    `INSERT INTO orders_v2_orders
      (id,version,status,customer_id,facility_id,quote_id,area_id,address_snapshot,lines,rate_cards,
       containers,measured_lines,total_minor,currency,payment_model,pickup_window,return_window,hold_id,
       resume_status,quality_check_passed,created_at,updated_at)
     VALUES ($1,1,'RETURNING',$2,NULL,$3,$4,$5,$6,'[]'::jsonb,'[]'::jsonb,NULL,$7,'INR','DUE_AT_RETURN',$8,$9,NULL,NULL,false,$10,$10)`,
    [
      orderId, ownerId, quoteId, randomUUID(), JSON.stringify(addressSnapshot), lines,
      totalMinor, JSON.stringify(window), JSON.stringify(returnWindow), now,
    ],
  );
  return orderId;
}

async function seedBilling(totalMinor = 6000, ownerId = customerId): Promise<{ orderId: string; obligation: v2.Obligation }> {
  const orderId = await seedOrder(totalMinor, ownerId);
  const obligation = await createObligationForOrder(getPool(), { orderId, clock });
  return { orderId, obligation };
}

/** Start a gateway attempt and settle it with a signed provider event. */
async function gatewayCapture(obligation: v2.Obligation, amountMinor: number) {
  const reference = `pay_${randomUUID()}`;
  const attempt = await billing.recordAttempt({
    obligationId: obligation.id, method: 'GATEWAY', amountMinor, providerReference: reference,
  });
  const payload: v2.PaymentWebhook = {
    eventId: `evt_${randomUUID()}`, paymentId: attempt.id, outcome: 'SUCCEEDED',
    amountMinor, currency: 'INR', occurredAt: now.toISOString(), providerReference: reference,
  };
  const { raw, signature } = signedEvent(payload);
  await billing.processWebhook('fake', raw, signature);
  const receipt = (await getPool().query<{ id: string }>(
    'SELECT id FROM billing_receipts WHERE provider_event_id=$1', [payload.eventId],
  )).rows[0];
  return { attempt, receiptId: receipt.id, payload, reference };
}

async function currentObligation(obligationId: string): Promise<v2.Obligation> {
  const row = (await getPool().query(
    'SELECT * FROM billing_obligations WHERE id=$1', [obligationId],
  )).rows[0];
  return v2.obligationSchema.parse({
    id: row.id, orderId: row.order_id, status: row.status,
    amountDueMinor: Number(row.amount_due_minor), amountSettledMinor: Number(row.amount_settled_minor),
    currency: row.currency, paymentModel: row.payment_model, dueAt: row.due_at.toISOString(),
    ...(row.void_reason === null ? {} : { voidReason: row.void_reason }), version: row.version,
  });
}

async function count(sql: string, values: unknown[] = []): Promise<number> {
  return (await getPool().query<{ n: number }>(sql, values)).rows[0].n;
}

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/laundry_verify_')) {
    throw new Error('Disposable local PostgreSQL required');
  }
  await initializeDb();
  // Proposals are not part of the canonical migration sequence.
  const proposal = readFileSync(new URL('../../../modules/schema/proposals/B05.sql', import.meta.url), 'utf8');
  await getPool().query(proposal);
});

beforeEach(async () => {
  await getPool().query(TRUNCATE);
  now = new Date('2026-10-26T02:00:00Z');
  billing = new BillingService({
    db: getPool(),
    clock,
    provider: new FakePaymentProvider(),
    webhookSecrets: { fake: secret },
    authenticate: async token => {
      const actor = actors[token];
      if (!actor) throw new BillingFault('UNAUTHENTICATED', 'Sign in again to continue');
      return { actor };
    },
  });
});

afterAll(closePool);

describe('B05 obligations', () => {
  it('creates one due-at-return obligation for the order total and repeats idempotently', async () => {
    const orderId = await seedOrder(6000);
    const first = await createObligationForOrder(getPool(), { orderId, clock });
    const second = await createObligationForOrder(getPool(), { orderId, clock });

    expect(second.id).toBe(first.id);
    expect(first).toEqual({
      id: first.id,
      orderId,
      status: 'OPEN',
      amountDueMinor: 6000,
      amountSettledMinor: 0,
      currency: 'INR',
      paymentModel: 'DUE_AT_RETURN',
      dueAt: '2026-10-29T04:30:00.000Z',
      version: 1,
    });
    expect(await count('SELECT count(*)::int AS n FROM billing_obligations')).toBe(1);
    const listed = await billing.listObligations(customerToken);
    expect(listed.items.map(item => item.id)).toEqual([first.id]);
  });

  it('keeps customer reads inside the signed-in customer', async () => {
    const { orderId, obligation } = await seedBilling();
    await expect(billing.getObligationSummary(otherToken, obligation.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(billing.listOrderObligations(otherToken, orderId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(billing.listOrderReceipts(otherToken, orderId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(billing.listObligations(otherToken)).resolves.toMatchObject({ items: [] });
  });
});

describe('B05-03 manual confirmation', () => {
  it('audits a cash receipt, labels it manual and never calls it a gateway capture', async () => {
    const { orderId, obligation } = await seedBilling();
    const confirmKey = key();
    const input: v2.ManualPaymentConfirmation = {
      expectedVersion: 1, method: 'CASH', amountMinor: 6000, currency: 'INR',
      reason: 'Cash collected at the door',
    };

    const receipt = await billing.confirmManual(operatorToken, obligation.id, input, confirmKey);
    expect(receipt).toMatchObject({
      obligationId: obligation.id, amountMinor: 6000, currency: 'INR',
      method: 'CASH', confirmedVia: 'MANUAL_CASH', confirmedBy: operatorId,
    });
    expect(receipt.externalReference).toBeUndefined();

    const replay = await billing.confirmManual(operatorToken, obligation.id, input, confirmKey);
    expect(replay.id).toBe(receipt.id);
    expect(await count('SELECT count(*)::int AS n FROM billing_receipts')).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM billing_receipts WHERE confirmed_via='GATEWAY_CAPTURE'")).toBe(0);

    const audit = (await getPool().query<{ actor_id: string; action: string; reason: string }>(
      "SELECT actor_id, action, reason FROM v2_audit WHERE action='BILLING_MANUAL_CONFIRMED'",
    )).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: operatorId, action: 'BILLING_MANUAL_CONFIRMED', reason: 'Cash collected at the door' });

    const summary = await billing.getObligationSummary(customerToken, obligation.id);
    expect(summary).toMatchObject({ obligationStatus: 'SETTLED', amountSettledMinor: 6000, orderId });
    expect(summary.receipts.map(item => item.id)).toEqual([receipt.id]);

    const settled = await currentObligation(obligation.id);
    await expect(billing.confirmManual(operatorToken, obligation.id, {
      expectedVersion: settled.version, method: 'UPI', amountMinor: 1, currency: 'INR',
      externalReference: 'upi-1', reason: 'Extra rupee',
    }, key())).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    await expect(billing.confirmManual(customerToken, obligation.id, {
      expectedVersion: settled.version, method: 'CASH', amountMinor: 1, currency: 'INR', reason: 'Not staff',
    }, key())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses a stale obligation version instead of double counting', async () => {
    const { obligation } = await seedBilling();
    await billing.confirmManual(operatorToken, obligation.id, {
      expectedVersion: 1, method: 'UPI', amountMinor: 2000, currency: 'INR',
      externalReference: 'upi-9', reason: 'Part payment',
    }, key());
    await expect(billing.confirmManual(operatorToken, obligation.id, {
      expectedVersion: 1, method: 'UPI', amountMinor: 2000, currency: 'INR',
      externalReference: 'upi-10', reason: 'Part payment retry',
    }, key())).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    const obligationNow = await currentObligation(obligation.id);
    expect(obligationNow).toMatchObject({ status: 'PARTIALLY_SETTLED', amountSettledMinor: 2000 });
  });

  it('records one manual receipt per external reference even under a new idempotency key', async () => {
    const { obligation } = await seedBilling();
    await billing.confirmManual(operatorToken, obligation.id, {
      expectedVersion: 1, method: 'UPI', amountMinor: 2000, currency: 'INR',
      externalReference: 'upi-same-txn', reason: 'First confirmation',
    }, key());
    await expect(billing.confirmManual(operatorToken, obligation.id, {
      expectedVersion: 2, method: 'UPI', amountMinor: 2000, currency: 'INR',
      externalReference: 'upi-same-txn', reason: 'Second staff member reuses the transaction reference',
    }, key())).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await count('SELECT count(*)::int AS n FROM billing_receipts')).toBe(1);
    expect((await currentObligation(obligation.id)).amountSettledMinor).toBe(2000);
  });
});

describe('B05-01 duplicate provider events', () => {
  it('moves the ledger once for a repeated event, and again after the cache is emptied', async () => {
    const { orderId, obligation } = await seedBilling();
    const reference = `pay_${randomUUID()}`;
    const attempt = await billing.recordAttempt({ obligationId: obligation.id, method: 'GATEWAY', amountMinor: 6000, providerReference: reference });
    const payload: v2.PaymentWebhook = {
      eventId: 'evt_duplicate', paymentId: attempt.id, outcome: 'SUCCEEDED', amountMinor: 6000,
      currency: 'INR', occurredAt: now.toISOString(), providerReference: reference,
    };
    const { raw, signature } = signedEvent(payload);

    expect(await billing.processWebhook('fake', raw, signature)).toEqual({ accepted: true, duplicate: false });
    expect(await billing.processWebhook('fake', raw, signature)).toEqual({ accepted: true, duplicate: true });

    // The provider event log has no TTL. Emptying the command cache (which a
    // webhook never uses) cannot reopen the door.
    await getPool().query('DELETE FROM v2_command_results');
    expect(await billing.processWebhook('fake', raw, signature)).toEqual({ accepted: true, duplicate: true });

    expect(await count('SELECT count(*)::int AS n FROM billing_receipts')).toBe(1);
    const settled = await currentObligation(obligation.id);
    expect(settled).toMatchObject({ status: 'SETTLED', amountSettledMinor: 6000 });

    // A new event id for the same capture reference is accepted but records no
    // second money movement.
    const replayPayload = { ...payload, eventId: 'evt_duplicate_second' };
    const second = signedEvent(replayPayload);
    expect(await billing.processWebhook('fake', second.raw, second.signature)).toEqual({ accepted: true, duplicate: false });
    expect(await count('SELECT count(*)::int AS n FROM billing_receipts')).toBe(1);
    const event = (await getPool().query<{ duplicate_reference: boolean; applied: boolean }>(
      'SELECT duplicate_reference, applied FROM billing_provider_events WHERE event_id=$1', ['evt_duplicate_second'],
    )).rows[0];
    expect(event).toMatchObject({ duplicate_reference: true, applied: false });

    const reconciliation = await billing.reconcile(operatorToken, '2026-10', key());
    // The replay is the same money, not a second entry and not an unmatched one.
    expect(reconciliation).toMatchObject({ capturedMinor: 6000, unmatchedCount: 0, differenceMinor: 0 });
    expect(reconciliation.entries).toHaveLength(1);
    expect(reconciliation.entries[0]).toMatchObject({ matched: true, externalReference: reference });
    void orderId;
  });

  it('refuses a reused event id with different content and an unsigned body', async () => {
    const { obligation } = await seedBilling();
    const attempt = await billing.recordAttempt({ obligationId: obligation.id, method: 'GATEWAY', amountMinor: 1000, providerReference: 'pay_conflict' });
    const payload: v2.PaymentWebhook = {
      eventId: 'evt_conflict', paymentId: attempt.id, outcome: 'FAILED', amountMinor: 1000,
      currency: 'INR', occurredAt: now.toISOString(), providerReference: 'pay_conflict',
    };
    const first = signedEvent(payload);
    await billing.processWebhook('fake', first.raw, first.signature);
    const changed = signedEvent({ ...payload, outcome: 'SUCCEEDED' });
    await expect(billing.processWebhook('fake', changed.raw, changed.signature)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(billing.processWebhook('fake', changed.raw, 'deadbeef')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(billing.processWebhook('unknown', changed.raw, changed.signature)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(await count('SELECT count(*)::int AS n FROM billing_receipts')).toBe(0);
  });
});

describe('B05-01 durable idempotency beyond the result cache', () => {
  it('replays a manual confirmation with the same key after the command cache is emptied', async () => {
    const { obligation } = await seedBilling();
    const input: v2.ManualPaymentConfirmation = {
      expectedVersion: 1, method: 'UPI', amountMinor: 2000, currency: 'INR',
      externalReference: 'upi-cache-replay', reason: 'Part payment',
    };
    const confirmKey = key();
    const first = await billing.confirmManual(operatorToken, obligation.id, input, confirmKey);
    expect(await count('SELECT count(*)::int AS n FROM v2_command_results')).toBe(1);

    await getPool().query('DELETE FROM v2_command_results');
    expect(await billing.confirmManual(operatorToken, obligation.id, input, confirmKey)).toMatchObject({ id: first.id });
    expect(await count('SELECT count(*)::int AS n FROM billing_receipts')).toBe(1);
    expect((await currentObligation(obligation.id)).amountSettledMinor).toBe(2000);

    await getPool().query('DELETE FROM v2_command_results');
    await expect(billing.confirmManual(operatorToken, obligation.id, {
      ...input, amountMinor: 4000, reason: 'Different intent under the same key',
    }, confirmKey)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(await count('SELECT count(*)::int AS n FROM billing_receipts')).toBe(1);
    expect((await currentObligation(obligation.id)).amountSettledMinor).toBe(2000);
  });

  it('replays a refund request with the same key after the command cache is emptied', async () => {
    const { orderId, obligation } = await seedBilling();
    const captured = await gatewayCapture(obligation, 6000);
    const version = (await currentObligation(obligation.id)).version;
    const request: v2.RefundRequest = {
      expectedVersion: version, orderId, paymentId: captured.receiptId, obligationId: obligation.id,
      amountMinor: 2000, currency: 'INR', reason: 'Damaged shirt',
    };
    const refundKey = key();
    const first = await billing.requestRefund(operatorToken, request, refundKey);
    expect(await count('SELECT count(*)::int AS n FROM v2_command_results')).toBe(1);

    await getPool().query('DELETE FROM v2_command_results');
    expect(await billing.requestRefund(operatorToken, request, refundKey)).toMatchObject({ id: first.id });
    expect(await count('SELECT count(*)::int AS n FROM billing_refunds')).toBe(1);

    await getPool().query('DELETE FROM v2_command_results');
    await expect(billing.requestRefund(operatorToken, {
      ...request, amountMinor: 4000, reason: 'Different refund intent under the same key',
    }, refundKey)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(await count('SELECT count(*)::int AS n FROM billing_refunds')).toBe(1);

    // 6000 captured - two 2000 reservations leaves exactly 2000 refundable.
    await billing.requestRefund(operatorToken, { ...request, reason: 'Second claim' }, key());
    await expect(billing.requestRefund(operatorToken, {
      ...request, amountMinor: 2001, reason: 'Over the reserved funds',
    }, key())).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('B05-02 late capture', () => {
  it('reconciles a capture that arrives after the attempt timed out', async () => {
    const { orderId, obligation } = await seedBilling();
    const reference = `pay_${randomUUID()}`;
    const attempt = await billing.recordAttempt({ obligationId: obligation.id, method: 'GATEWAY', amountMinor: 6000, providerReference: reference });
    const timedOut = await billing.resolveAttempt(attempt.id, 'EXPIRED');
    expect(timedOut).toMatchObject({ status: 'EXPIRED' });

    const payload: v2.PaymentWebhook = {
      eventId: `evt_${randomUUID()}`, paymentId: attempt.id, outcome: 'SUCCEEDED', amountMinor: 6000,
      currency: 'INR', occurredAt: now.toISOString(), providerReference: reference,
    };
    const { raw, signature } = signedEvent(payload);
    expect(await billing.processWebhook('fake', raw, signature)).toEqual({ accepted: true, duplicate: false });

    const attempts = await billing.listOrderAttempts(customerToken, orderId);
    expect(attempts.items[0]).toMatchObject({ status: 'SUCCEEDED', providerReference: reference });
    const settled = await currentObligation(obligation.id);
    expect(settled).toMatchObject({ status: 'SETTLED', amountSettledMinor: 6000 });

    const reconciliation = await billing.reconcile(operatorToken, '2026-10', key());
    expect(reconciliation).toMatchObject({
      periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z',
      capturedMinor: 6000, refundedMinor: 0, manualMinor: 0, unmatchedCount: 0, differenceMinor: 0,
    });
    expect(reconciliation.entries).toHaveLength(1);
    expect(reconciliation.entries[0]).toMatchObject({ kind: 'CAPTURE', amountMinor: 6000, matched: true, externalReference: reference });
  });

  it('ignores a late pending event after the attempt succeeded and keeps the event log entry', async () => {
    const { orderId, obligation } = await seedBilling();
    const captured = await gatewayCapture(obligation, 6000);
    const payload: v2.PaymentWebhook = {
      eventId: `evt_pending_${randomUUID()}`, paymentId: captured.attempt.id, outcome: 'PENDING',
      amountMinor: 6000, currency: 'INR', occurredAt: now.toISOString(), providerReference: captured.reference,
    };
    const { raw, signature } = signedEvent(payload);
    expect(await billing.processWebhook('fake', raw, signature)).toEqual({ accepted: true, duplicate: false });

    expect((await billing.listOrderAttempts(customerToken, orderId)).items[0]).toMatchObject({ status: 'SUCCEEDED' });
    expect((await currentObligation(obligation.id)).amountSettledMinor).toBe(6000);
    expect(await count('SELECT count(*)::int AS n FROM billing_receipts')).toBe(1);
    const event = (await getPool().query<{ applied: boolean; duplicate_reference: boolean; note: string | null }>(
      'SELECT applied, duplicate_reference, note FROM billing_provider_events WHERE event_id=$1', [payload.eventId],
    )).rows[0];
    expect(event.applied).toBe(false);
    expect(event.note).toBeTruthy();
    const reconciliation = await billing.reconcile(operatorToken, '2026-10', key());
    expect(reconciliation).toMatchObject({ capturedMinor: 6000, unmatchedCount: 0, differenceMinor: 0 });
  });

  it('records an unknown provider reference without inventing money', async () => {
    const payload: v2.PaymentWebhook = {
      eventId: 'evt_orphan', paymentId: randomUUID(), outcome: 'SUCCEEDED', amountMinor: 4500,
      currency: 'INR', occurredAt: now.toISOString(), providerReference: 'pay_orphan',
    };
    const { raw, signature } = signedEvent(payload);
    expect(await billing.processWebhook('fake', raw, signature)).toEqual({ accepted: true, duplicate: false });

    expect(await count('SELECT count(*)::int AS n FROM billing_receipts')).toBe(0);
    const reconciliation = await billing.reconcile(operatorToken, '2026-10', key());
    expect(reconciliation).toMatchObject({ capturedMinor: 0, unmatchedCount: 1, differenceMinor: 4500 });
    expect(reconciliation.entries[0]).toMatchObject({ matched: false, externalReference: 'pay_orphan' });

    // Repeating reconciliation with a new key recomputes, never appends.
    const again = await billing.reconcile(operatorToken, '2026-10', key());
    expect(again.entries).toHaveLength(1);
    expect(await count('SELECT count(*)::int AS n FROM billing_reconciliation_entries')).toBe(1);
  });
});

describe('B05-04 refunds', () => {
  it('never refunds past the captured balance, including reserved requests', async () => {
    const { orderId, obligation } = await seedBilling();
    const captured = await gatewayCapture(obligation, 6000);
    const version = (await currentObligation(obligation.id)).version;

    const refund = await billing.requestRefund(operatorToken, {
      expectedVersion: version, orderId, paymentId: captured.receiptId, obligationId: obligation.id,
      amountMinor: 4000, currency: 'INR', reason: 'Two shirts damaged',
    }, key());
    expect(refund).toMatchObject({ status: 'REQUESTED', amountMinor: 4000, orderId, paymentId: captured.receiptId });

    const submitted = await billing.submitRefund(refund.id);
    expect(submitted).toMatchObject({ status: 'SUCCEEDED', externalReference: `refund:${refund.id}` });
    expect(submitted.resolvedAt).toBe(now.toISOString());

    // Retrying the same refund row reuses its stable reference.
    const retried = await billing.submitRefund(refund.id);
    expect(retried).toMatchObject({ status: 'SUCCEEDED', externalReference: `refund:${refund.id}` });
    expect(await count('SELECT count(*)::int AS n FROM billing_refunds')).toBe(1);

    await expect(billing.requestRefund(operatorToken, {
      expectedVersion: version, orderId, paymentId: captured.receiptId, obligationId: obligation.id,
      amountMinor: 3000, currency: 'INR', reason: 'Second claim',
    }, key())).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    const pendingKey = key();
    const reserved = await billing.requestRefund(operatorToken, {
      expectedVersion: version, orderId, paymentId: captured.receiptId, obligationId: obligation.id,
      amountMinor: 2000, currency: 'INR', reason: 'Pending claim',
    }, pendingKey);
    await expect(billing.requestRefund(operatorToken, {
      expectedVersion: version, orderId, paymentId: captured.receiptId, obligationId: obligation.id,
      amountMinor: 1, currency: 'INR', reason: 'One rupee over',
    }, key())).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    // The same key replays the same intent; a new key cannot reserve the same
    // funds twice.
    const replay = await billing.requestRefund(operatorToken, {
      expectedVersion: version, orderId, paymentId: captured.receiptId, obligationId: obligation.id,
      amountMinor: 2000, currency: 'INR', reason: 'Pending claim',
    }, pendingKey);
    expect(replay.id).toBe(reserved.id);
    await expect(billing.requestRefund(operatorToken, {
      expectedVersion: version, orderId, paymentId: captured.receiptId, obligationId: obligation.id,
      amountMinor: 2000, currency: 'INR', reason: 'Pending claim',
    }, key())).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('refuses a refund against a manual receipt and an unknown receipt', async () => {
    const { orderId, obligation } = await seedBilling();
    const manual = await billing.confirmManual(operatorToken, obligation.id, {
      expectedVersion: 1, method: 'CASH', amountMinor: 6000, currency: 'INR', reason: 'Cash',
    }, key());
    const version = (await currentObligation(obligation.id)).version;
    await expect(billing.requestRefund(operatorToken, {
      expectedVersion: version, orderId, paymentId: manual.id, obligationId: obligation.id,
      amountMinor: 1000, currency: 'INR', reason: 'Cash refund',
    }, key())).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(billing.requestRefund(operatorToken, {
      expectedVersion: version, orderId, paymentId: randomUUID(), obligationId: obligation.id,
      amountMinor: 1000, currency: 'INR', reason: 'Unknown receipt',
    }, key())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('B05-05 return payment gate', () => {
  it('keeps an unpaid return unresolved and never fabricates a receipt', async () => {
    const { orderId } = await seedBilling();
    const gate = await billing.returnGate(orderId);
    expect(gate).toEqual({ settled: false, amountRemainingMinor: 6000 });

    let code: string | undefined;
    try {
      v2.guardOrderCommand(
        { status: 'RETURNING', version: 4 },
        { type: 'COMPLETE_RETURN', expectedVersion: 4 },
        { leg: 'RETURN', custodyAccepted: true, paymentSettled: gate.settled, amountRemainingMinor: gate.amountRemainingMinor },
      );
    } catch (error) {
      code = (error as v2.TransitionError).code;
    }
    expect(code).toBe('PAYMENT_PENDING');
    expect(await count('SELECT count(*)::int AS n FROM billing_receipts')).toBe(0);
  });

  it('voids an audited zero-due obligation and creates no receipt', async () => {
    const orderId = await seedOrder(0);
    const obligation = await createObligationForOrder(getPool(), { orderId, clock });
    expect(obligation).toMatchObject({ status: 'OPEN', amountDueMinor: 0, amountSettledMinor: 0 });

    // A zero due amount is not evidence on its own; the guard wants an audited
    // resolution before money can be declared resolved.
    expect(await billing.returnGate(orderId)).toEqual({ settled: false, amountRemainingMinor: 0 });

    const resolved = await billing.voidZeroDue({
      obligationId: obligation.id,
      resolution: { auditId: obligation.id, reason: 'Agreed zero-due return at the door' },
      actor: operatorActor,
    });
    expect(resolved).toMatchObject({
      status: 'VOID', amountDueMinor: 0, amountSettledMinor: 0, voidReason: 'Agreed zero-due return at the door',
    });

    const gate = await billing.returnGate(orderId);
    expect(gate.settled).toBe(true);
    expect(gate.amountRemainingMinor).toBe(0);
    expect(gate.zeroDueResolution).toEqual({ auditId: obligation.id, reason: 'Agreed zero-due return at the door' });
    expect(v2.guardOrderCommand(
      { status: 'RETURNING', version: 1 },
      { type: 'COMPLETE_RETURN', expectedVersion: 1 },
      { leg: 'RETURN', custodyAccepted: true, paymentSettled: gate.settled, amountRemainingMinor: 0, zeroDueResolution: gate.zeroDueResolution },
    ).status).toBe('DELIVERED');
    expect(await count('SELECT count(*)::int AS n FROM billing_receipts')).toBe(0);

    const { obligation: unpaid } = await seedBilling();
    await expect(billing.voidZeroDue({
      obligationId: unpaid.id,
      resolution: { auditId: unpaid.id, reason: 'Trying to void real money' },
      actor: operatorActor,
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('B05 routes over HTTP', () => {
  let app: NestExpressApplication;
  let base: string;

  beforeEach(async () => {
    app = await NestFactory.create<NestExpressApplication>(BillingV2Module.register(() => billing), { logger: false, rawBody: true });
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()) + '/v2';
  });
  afterEach(async () => { await app?.close(); });

  it('serves the customer reads and operator writes with contract envelopes', async () => {
    const { orderId, obligation } = await seedBilling();
    const captured = await gatewayCapture(obligation, 6000);
    let bearer = customerToken;
    const client = createV2Client({ baseUrl: base, getToken: () => bearer });

    expect((await client.listOrderObligations(orderId)).items.map(item => item.id)).toEqual([obligation.id]);
    expect((await client.listObligations()).items.map(item => item.id)).toEqual([obligation.id]);
    const summary = await client.getObligation(obligation.id);
    expect(summary).toMatchObject({ orderId, obligationStatus: 'SETTLED', amountSettledMinor: 6000 });
    expect((await client.listOrderPaymentAttempts(orderId)).items).toHaveLength(1);
    expect((await client.listOrderReceipts(orderId)).items.map(item => item.id)).toEqual([captured.receiptId]);
    expect((await client.listReceipts(obligation.id)).items.map(item => item.id)).toEqual([captured.receiptId]);
    expect((await client.listOrderRefunds(orderId)).items).toHaveLength(0);
    expect((await client.listRefunds()).items).toHaveLength(0);

    bearer = operatorToken;
    const refund = await client.createRefund({
      expectedVersion: 2, orderId, paymentId: captured.receiptId, obligationId: obligation.id,
      amountMinor: 1000, currency: 'INR', reason: 'Late return',
    }, { idempotencyKey: key() });
    expect(refund).toMatchObject({ status: 'REQUESTED', amountMinor: 1000, paymentId: captured.receiptId });
    bearer = customerToken;
    expect((await client.listRefunds()).items.map(item => item.id)).toEqual([refund.id]);

    bearer = operatorToken;
    const reconciliation = await client.reconciliation('2026-10', { idempotencyKey: key() });
    expect(reconciliation).toMatchObject({ capturedMinor: 6000, refundedMinor: 0, unmatchedCount: 0 });

    // A second obligation for a manual receipt, confirmed over the ops route.
    const manual = await seedBilling(2000);
    const manualVersion = (await currentObligation(manual.obligation.id)).version;
    const receipt = await client.confirmManualPayment(manual.obligation.id, {
      expectedVersion: manualVersion, method: 'UPI', amountMinor: 2000, currency: 'INR',
      externalReference: 'upi-http-1', reason: 'UPI transfer confirmed by staff',
    }, { idempotencyKey: key() });
    expect(receipt).toMatchObject({ confirmedVia: 'MANUAL_UPI', method: 'UPI', confirmedBy: operatorId });
    expect(await count("SELECT count(*)::int AS n FROM billing_receipts WHERE confirmed_via='GATEWAY_CAPTURE' AND order_id=$1", [manual.orderId])).toBe(0);
  });

  it('separates roles, ownership and the signed provider route', async () => {
    const { orderId, obligation } = await seedBilling();
    const other = await seedBilling(1000, otherCustomerId);
    const client = createV2Client({ baseUrl: base, getToken: () => customerToken });

    const anonymous = await fetch(base + '/billing/obligations');
    expect(anonymous.status).toBe(401);
    expect(v2.errorEnvelopeSchema.parse(await anonymous.json()).code).toBe('UNAUTHENTICATED');

    const forbidden = await fetch(base + '/ops/billing/reconciliation', {
      method: 'POST',
      headers: { authorization: `Bearer ${customerToken}`, 'content-type': 'application/json', 'idempotency-key': key() },
      body: JSON.stringify({ period: '2026-10' }),
    });
    expect(forbidden.status).toBe(403);
    expect(v2.errorEnvelopeSchema.parse(await forbidden.json()).code).toBe('FORBIDDEN');

    const otherClient = createV2Client({ baseUrl: base, getToken: () => otherToken });
    await expect(otherClient.getObligation(obligation.id)).rejects.toBeInstanceOf(V2ApiError);
    await expect(otherClient.getObligation(obligation.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(otherClient.listOrderObligations(orderId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(otherClient.listOrderReceipts(other.orderId)).resolves.toMatchObject({ items: [] });

    const attempt = await billing.recordAttempt({ obligationId: obligation.id, method: 'GATEWAY', amountMinor: 500, providerReference: 'pay_http' });
    const payload: v2.PaymentWebhook = {
      eventId: 'evt_http', paymentId: attempt.id, outcome: 'SUCCEEDED', amountMinor: 500,
      currency: 'INR', occurredAt: now.toISOString(), providerReference: 'pay_http',
    };
    const raw = JSON.stringify(payload);
    const unsigned = await fetch(base + '/webhooks/payments/fake', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: raw,
    });
    expect(unsigned.status).toBe(401);

    const wrong = await fetch(base + '/webhooks/payments/fake', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-provider-signature': 'deadbeef' },
      body: raw,
    });
    expect(wrong.status).toBe(401);

    const signed = await fetch(base + '/webhooks/payments/fake', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-provider-signature': sign(Buffer.from(raw)) },
      body: raw,
    });
    expect(signed.status).toBe(200);
    expect(v2.webhookResultSchema.parse(await signed.json())).toEqual({ accepted: true, duplicate: false });
    expect(await count('SELECT count(*)::int AS n FROM billing_receipts WHERE order_id=$1', [orderId])).toBe(1);
    void client;
  });
});
