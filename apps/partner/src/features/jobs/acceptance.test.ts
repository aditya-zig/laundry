import { describe, expect, it } from 'vitest';
import { UnknownOutcomeError } from '@laundry/api-client';
import type { QueuedMutationRecord } from '@laundry/app-foundation';
import type { v2 } from '@laundry/contracts';
import { AssignmentAcceptance } from './acceptance';

const foreignId = '99999999-9999-4999-8999-999999999999';
const rider: v2.Actor = { id: '11111111-1111-4111-8111-111111111111', role: 'RIDER', facilityIds: [], scope: { facilityIds: [] } };
const job: v2.RiderJob = {
  id: '22222222-2222-4222-8222-222222222222', orderId: '33333333-3333-4333-8333-333333333333',
  leg: 'RETURN', status: 'ASSIGNED', version: 3, assignedTo: rider.id, assignmentActive: true,
  customerName: 'Synthetic customer', addressLine1: 'Synthetic fixture address', addressCity: 'Bengaluru', addressPostalCode: '560001',
  window: { start: '2026-10-26T09:00:00.000Z', end: '2026-10-26T10:00:00.000Z', timezone: 'Asia/Kolkata' },
  containerIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'], containerCount: 1,
};
const assignment: v2.Assignment = {
  id: '44444444-4444-4444-8444-444444444444', legAttemptId: job.id, riderId: rider.id, version: 1,
  assignedAt: '2026-10-26T05:00:00.000Z', acceptedAt: '2026-10-26T06:00:00.000Z',
};
function harness() {
  let actor: v2.Actor | null = rider;
  let records: QueuedMutationRecord[] = [];
  const calls: unknown[][] = [];
  let send = async () => assignment;
  const api = {
    actor: () => actor,
    queuedMutations: async () => records,
    async acceptAssignment(...args: [string, number, string?]) { calls.push(args); return send(); },
  };
  const retained: QueuedMutationRecord = { routeId: 'logistics.rider.accept', params: { jobId: job.id }, bodyJson: JSON.stringify({ expectedVersion: 2 }), idempotencyKey: 'synthetic-retained-key', actorId: rider.id, identityKey: '', createdAt: '2026-10-26T06:00:00.000Z' };
  return { api, calls, retained, setActor: (value: v2.Actor | null) => { actor = value; }, setRecords: (value: QueuedMutationRecord[]) => { records = value; }, setSend: (value: typeof send) => { send = value; } };
}
describe('assignment acknowledgement is separate from physical custody', () => {
  it('cannot submit before journal inspection, then confirms only the active rider assignment', async () => {
    const h = harness(), c = new AssignmentAcceptance(h.api, job);
    await c.confirm(); expect(h.calls).toEqual([]);
    await c.checkQueue(); await c.confirm();
    expect(h.calls).toEqual([[job.id, 3, undefined]]);
    expect(c.state.phase).toBe('confirmed');
    await c.confirm(); expect(h.calls).toHaveLength(1);
  });
  it('reconciles the original retained version/key before allowing a new current-version acknowledgement', async () => {
    const h = harness(); h.setRecords([h.retained]);
    const c = new AssignmentAcceptance(h.api, job);
    await c.checkQueue(); expect(c.state.phase).toBe('pending');
    await c.confirm(); expect(c.state.phase).toBe('ready');
    expect(h.calls).toEqual([[job.id, 2, h.retained.idempotencyKey]]);
    await c.confirm(); expect(c.state.phase).toBe('confirmed');
    expect(h.calls[1]).toEqual([job.id, 3, undefined]);
  });
  it('never mints a replacement after an unknown reply whose retained key is missing', async () => {
    const h = harness(); h.setSend(async () => { throw new UnknownOutcomeError('Reply lost'); });
    const c = new AssignmentAcceptance(h.api, job);
    await c.checkQueue(); await c.confirm(); expect(c.state.phase).toBe('blocked');
    await c.checkQueue(); await c.confirm(); expect(h.calls).toHaveLength(1);
  });
  it('does not enable custody from a foreign assignment reply', async () => {
    const h = harness(); h.setSend(async () => ({ ...assignment, riderId: foreignId }));
    const c = new AssignmentAcceptance(h.api, job);
    await c.checkQueue(); await c.confirm(); expect(c.state.phase).toBe('blocked');
  });
  it('quarantines foreign actor records and late replies after a role change', async () => {
    const h = harness(); h.setRecords([{ ...h.retained, actorId: foreignId }]);
    h.setSend(async () => { h.setActor({ ...rider, role: 'OPERATOR' }); return assignment; });
    const c = new AssignmentAcceptance(h.api, job);
    await c.checkQueue(); expect(c.state.phase).toBe('ready');
    await c.confirm(); expect(c.state.phase).not.toBe('confirmed');
  });
});
