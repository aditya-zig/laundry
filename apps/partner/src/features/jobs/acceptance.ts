import { v2 } from '@laundry/contracts';
import { isMutationOutcomePending, type QueuedMutationRecord } from '@laundry/app-foundation';
import type { PartnerApi } from '../session/partner-api';

type AcceptanceApi = Pick<PartnerApi, 'actor' | 'queuedMutations' | 'acceptAssignment'>;
export type AcceptanceState = { phase: 'checking' | 'ready' | 'busy' | 'pending' | 'confirmed' | 'blocked' | 'rejected'; message?: string };
type Intent = { expectedVersion: number; key: string };

// Acknowledgement is separate from custody. No local flag claims a bag transfer.
export class AssignmentAcceptance {
  state: AcceptanceState = { phase: 'checking' };
  private pending: Intent | null = null;
  private disposed = false;
  private uncertain = false;
  private checking = false;
  private readonly actorId: string | undefined;
  private readonly identity: string;
  constructor(private api: AcceptanceApi, private job: v2.RiderJob, private changed: (state: AcceptanceState) => void = () => {}) {
    this.actorId = api.actor()?.id;
    this.identity = JSON.stringify(api.actor());
  }
  dispose() { this.disposed = true; }
  private active() { return !this.disposed && this.actorId !== undefined && this.api.actor()?.role === 'RIDER' && JSON.stringify(this.api.actor()) === this.identity; }
  private set(state: AcceptanceState) { if (this.active()) { this.state = state; this.changed(state); } }
  private retained(records: QueuedMutationRecord[]): Intent | null {
    const matching = records.filter(r => r.actorId === this.actorId && r.routeId === 'logistics.rider.accept' && r.params.jobId === this.job.id);
    if (matching.length) this.uncertain = true;
    if (matching.length > 1) throw new Error('Multiple acceptance intents require reconciliation');
    if (!matching.length) return null;
    const record = matching[0];
    const body = v2.versionedCommandSchema.parse(JSON.parse(record.bodyJson ?? 'null'));
    return { expectedVersion: body.expectedVersion, key: record.idempotencyKey };
  }
  async checkQueue() {
    if (!this.active() || this.checking || this.state.phase === 'busy' || this.state.phase === 'confirmed') return;
    this.checking = true;
    this.set({ phase: 'checking' });
    try {
      this.pending = this.retained(await this.api.queuedMutations());
      if (this.uncertain && !this.pending) throw new Error('The unresolved acceptance key is missing');
      this.set({ phase: this.pending ? 'pending' : 'ready', ...(this.pending ? { message: 'Acceptance is unconfirmed. Retry only the retained task/version/key.' } : {}) });
    } catch {
      this.set({ phase: 'blocked', message: 'The acceptance journal cannot be read safely. Check it again or ask dispatch; do not create another request.' });
    } finally {
      this.checking = false;
    }
  }
  async confirm() {
    if (!this.active() || !['ready', 'pending', 'rejected'].includes(this.state.phase)) return;
    const intent = this.pending;
    const version = intent?.expectedVersion ?? this.job.version;
    this.set({ phase: 'busy' });
    try {
      const assignment = await this.api.acceptAssignment(this.job.id, version, intent?.key);
      if (!this.active()) return;
      if (assignment.legAttemptId !== this.job.id || assignment.riderId !== this.actorId || !assignment.acceptedAt || assignment.releasedAt) {
        this.uncertain = true;
        this.set({ phase: 'blocked', message: 'The reply did not confirm this active rider assignment. Refresh the task or contact dispatch; custody is not enabled.' });
        return;
      }
      this.pending = null;
      this.uncertain = false;
      this.set(version === this.job.version
        ? { phase: 'confirmed', message: 'Assignment acknowledged online. No custody transfer has been recorded.' }
        : { phase: 'ready', message: 'The earlier acknowledgement was reconciled. Confirm the current task version before recording custody.' });
    } catch (error) {
      if (!this.active()) return;
      if (!isMutationOutcomePending(error)) {
        this.pending = null;
        this.uncertain = false;
        this.set({ phase: 'rejected', message: 'Acceptance was rejected. Refresh the assignment before trying again; no custody transfer was recorded.' });
        return;
      }
      this.uncertain = true;
      try {
        this.pending = this.retained(await this.api.queuedMutations());
        if (!this.pending) throw new Error('Retained command missing');
        this.set({ phase: 'pending', message: 'Acceptance outcome unknown. Retry the exact retained request, not a replacement.' });
      } catch {
        this.set({ phase: 'blocked', message: 'Acceptance outcome unknown and its retained key cannot be recovered. Contact dispatch; do not create a replacement request.' });
      }
    }
  }
}
