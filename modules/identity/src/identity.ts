import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { v2 } from '@laundry/contracts';
import { IdentityFault } from './errors';

export interface OtpDelivery {
  readonly mode: 'FAKE' | 'LIVE';
  send(input: { phone: string; code: string; challengeId: string }): Promise<{ reference: string }>;
}
export interface IdentityOptions {
  db: Pool;
  provider: OtpDelivery;
  hashKey: string;
  encryptionKey: string;
  clock?: () => Date;
  maxOtpPerHour?: number;
}
type Failure = { ok: false; code: v2.ErrorCode; message: string; currentVersion?: number };
type Outcome<T> = { ok: true; value: T; sessionId?: string } | Failure;
const success = <T>(value: T): Outcome<T> => ({ ok: true, value });
const denied = (code: v2.ErrorCode, message: string): Failure => ({ ok: false, code, message });
const invalidSession = () => new IdentityFault('UNAUTHENTICATED', 'Sign in again to continue');
const validToken = (token: string) => typeof token === 'string' && token.length === 43 && /^[A-Za-z0-9_-]{43}$/.test(token);
const ACCESS_MS = 15 * 60_000, REFRESH_MS = 7 * 24 * 60 * 60_000;
interface SessionRecord {
  id: string; family_id: string; profile_id: string; issuer_mode: string;
  access_expires_at: Date; refresh_expires_at: Date; rotated_at: Date | null;
  revoked_at: Date | null; active: boolean;
}

export class IdentityService {
  private readonly hashKey: Buffer;
  private readonly encryptionKey: Buffer;
  private readonly clock: () => Date;
  private readonly maxOtpPerHour: number;
  constructor(private readonly options: IdentityOptions) {
    for (const value of [options.hashKey, options.encryptionKey]) {
      if (!/^[a-f0-9]{64}$/i.test(value) || /^([a-f0-9])\1{63}$/i.test(value)) throw new Error('Identity requires independent random 32-byte keys');
    }
    if (process.env.NODE_ENV === 'production' && options.provider.mode !== 'LIVE') throw new Error('Fake identity delivery is forbidden in production');
    this.hashKey = Buffer.from(options.hashKey, 'hex');
    this.encryptionKey = Buffer.from(options.encryptionKey, 'hex');
    if (timingSafeEqual(this.hashKey, this.encryptionKey)) throw new Error('Identity hashing and encryption keys must differ');
    this.clock = options.clock ?? (() => new Date());
    if (process.env.NODE_ENV === 'production' && options.maxOtpPerHour === undefined) throw new Error('Production identity requires an explicit delivery quota');
    this.maxOtpPerHour = options.maxOtpPerHour ?? 100;
    if (!Number.isSafeInteger(this.maxOtpPerHour) || this.maxOtpPerHour < 1 || this.maxOtpPerHour > 100_000) throw new Error('Identity delivery quota must be a bounded positive integer');
  }
  private hash(domain: string, value: string): string {
    return createHmac('sha256', this.hashKey).update(domain).update('\0').update(value).digest('hex');
  }
  private seal(value: unknown, aad: string): string {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    cipher.setAAD(Buffer.from(aad));
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return [iv, body, cipher.getAuthTag()].map(part => part.toString('base64url')).join('.');
  }
  private unseal<T>(sealed: string, aad: string): Outcome<T> {
    try {
      const [iv, body, tag] = sealed.split('.').map(value => Buffer.from(value, 'base64url'));
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
      decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(tag);
      return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8'));
    } catch { throw new IdentityFault('PROVIDER_UNAVAILABLE', 'Identity recovery data is unavailable'); }
  }
  private async tx<T>(work: (tx: PoolClient) => Promise<T>): Promise<T> {
    const tx = await this.options.db.connect();
    let discard = false;
    try {
      await tx.query('BEGIN');
      const value = await work(tx);
      await tx.query('COMMIT');
      return value;
    } catch (error) {
      try { await tx.query('ROLLBACK'); } catch { discard = true; }
      throw error;
    } finally { tx.release(discard); }
  }
  private async lock(tx: PoolClient, scope: string) {
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [scope]);
  }
  private async rate(tx: PoolClient, scope: string, limit: number): Promise<boolean> {
    const now = this.clock();
    const start = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
    const result = await tx.query(`INSERT INTO identity_rate_buckets (key_hash,bucket_start,attempts) VALUES ($1,$2,1)
      ON CONFLICT (key_hash,bucket_start) DO UPDATE SET attempts=identity_rate_buckets.attempts+1
      WHERE identity_rate_buckets.attempts<$3 RETURNING attempts`, [this.hash('rate', scope), start, limit]);
    return result.rowCount === 1;
  }
  private async audit(tx: PoolClient, action: string, profileId?: string, resourceId?: string) {
    await tx.query('INSERT INTO identity_audit (id,profile_id,action,resource_id,created_at) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), profileId ?? null, action, resourceId ?? null, this.clock()]);
  }
  private actor(profileId: string): v2.Actor {
    // No invitation or claimed body role can promote a phone signup to staff.
    return { id: profileId, role: 'CUSTOMER', facilityIds: [], scope: { facilityIds: [] } };
  }
  private current(record: SessionRecord | undefined, refresh = false): record is SessionRecord {
    return !!record && record.active && record.issuer_mode === this.options.provider.mode &&
      !(process.env.NODE_ENV === 'production' && record.issuer_mode !== 'LIVE') &&
      !record.revoked_at && !record.rotated_at &&
      (refresh ? record.refresh_expires_at : record.access_expires_at).getTime() > this.clock().getTime();
  }
  private async sessionRecord(tx: Pool | PoolClient, kind: 'access' | 'refresh', token: string, lock = false): Promise<SessionRecord | undefined> {
    if (!validToken(token)) return undefined;
    const result = await tx.query<SessionRecord>(`SELECT s.*,f.profile_id,f.issuer_mode,f.revoked_at,p.active
      FROM identity_sessions s JOIN identity_session_families f ON f.id=s.family_id
      JOIN identity_profiles p ON p.id=f.profile_id WHERE s.${kind}_hash=$1${lock ? ' FOR UPDATE OF f FOR SHARE OF p' : ''}`, [this.hash(kind, token)]);
    return result.rows[0];
  }
  private async authenticated(tx: Pool | PoolClient, token: string, lock = false) {
    const row = await this.sessionRecord(tx, 'access', token, lock);
    if (!this.current(row)) throw invalidSession();
    return { sessionId: row.id, actor: this.actor(row.profile_id), familyId: row.family_id };
  }
  async authenticate(token: string): Promise<{ sessionId: string; actor: v2.Actor }> {
    const { sessionId, actor } = await this.authenticated(this.options.db, token);
    return { sessionId, actor };
  }
  private async command<T>(scope: string, key: string, intent: unknown, work: (tx: PoolClient) => Promise<Outcome<T>>, authorize?: (tx: PoolClient) => Promise<unknown>, replayGuard?: (tx: PoolClient, value: T) => Promise<unknown>): Promise<T> {
    v2.idempotencyKeySchema.parse(key);
    const keyHash = this.hash('command-key', key), intentHash = this.hash('intent', JSON.stringify(intent));
    const aad = `${scope}:${keyHash}:${intentHash}`;
    const result = await this.tx(async tx => {
      await this.lock(tx, `${scope}:${keyHash}`);
      if (authorize) await authorize(tx);
      const previous = (await tx.query('SELECT * FROM identity_command_results WHERE scope=$1 AND key_hash=$2', [scope, keyHash])).rows[0];
      if (previous) {
        if (previous.intent_hash !== intentHash) throw new IdentityFault('IDEMPOTENCY_CONFLICT', 'This key belongs to a different request');
        if (previous.expires_at.getTime() <= this.clock().getTime()) throw invalidSession();
        if (previous.session_id) {
          const row = (await tx.query<SessionRecord>(`SELECT s.*,f.profile_id,f.issuer_mode,f.revoked_at,p.active FROM identity_sessions s
            JOIN identity_session_families f ON f.id=s.family_id JOIN identity_profiles p ON p.id=f.profile_id WHERE s.id=$1 FOR UPDATE OF f FOR SHARE OF p`, [previous.session_id])).rows[0];
          if (!this.current(row)) throw invalidSession();
        }
        const value = this.unseal<T>(previous.sealed_result, aad);
        if (value.ok && replayGuard) await replayGuard(tx, value.value);
        return value;
      }
      const outcome = await work(tx);
      await tx.query(`INSERT INTO identity_command_results (scope,key_hash,intent_hash,sealed_result,session_id,created_at,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [scope, keyHash, intentHash, this.seal(outcome, aad), outcome.ok ? outcome.sessionId ?? null : null, this.clock(), new Date(this.clock().getTime() + REFRESH_MS)]);
      return outcome;
    });
    if (!result.ok) throw new IdentityFault(result.code, result.message, result.currentVersion);
    return result.value;
  }
  private challenge(row: { id: string; expires_at: Date }): v2.OtpChallenge {
    return { challengeId: row.id, expiresAt: row.expires_at.toISOString(), retryAfterSeconds: 60 };
  }
  async requestOtp(input: v2.OtpRequest, key: string, peer: string): Promise<v2.OtpChallenge> {
    if (process.env.NODE_ENV === 'production' && this.options.provider.mode !== 'LIVE') throw new IdentityFault('PROVIDER_UNAVAILABLE', 'Live identity delivery is required');
    const parsed = v2.otpRequestSchema.parse(input);
    v2.idempotencyKeySchema.parse(key);
    const peerHash = this.hash('peer', peer), requestScope = this.hash('otp-request-scope', parsed.phone);
    const keyHash = this.hash('request-key', key), intentHash = this.hash('request-intent', `${this.options.provider.mode}:${parsed.phone}`);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const prepared = await this.tx(async tx => {
      await this.lock(tx, `otp-request:${requestScope}:${keyHash}`);
      const existing = (await tx.query('SELECT * FROM identity_otp_challenges WHERE request_scope=$1 AND key_hash=$2', [requestScope, keyHash])).rows[0];
      if (existing) {
        if (existing.intent_hash !== intentHash) throw new IdentityFault('IDEMPOTENCY_CONFLICT', 'This key belongs to a different request');
        return { row: existing, fresh: false };
      }
      await this.lock(tx, `otp-phone:${this.hash('phone', parsed.phone)}`);
      const last = (await tx.query('SELECT created_at FROM identity_otp_challenges WHERE phone=$1 ORDER BY created_at DESC LIMIT 1', [parsed.phone])).rows[0];
      if (last && this.clock().getTime() - last.created_at.getTime() < 60_000) throw new IdentityFault('RATE_LIMITED', 'Wait before requesting another code');
      if (!await this.rate(tx, 'otp-global', this.maxOtpPerHour) || !await this.rate(tx, `otp-phone:${parsed.phone}`, 5) || !await this.rate(tx, `otp-peer:${peerHash}`, 30)) throw new IdentityFault('RATE_LIMITED', 'Too many sign-in requests');
      const id = randomUUID(), now = this.clock();
      await tx.query("UPDATE identity_otp_challenges SET status='SUPERSEDED' WHERE phone=$1 AND status IN ('SENDING','ACCEPTED')", [parsed.phone]);
      const row = (await tx.query(`INSERT INTO identity_otp_challenges (id,phone,peer_hash,request_scope,key_hash,intent_hash,code_hash,issuer_mode,status,created_at,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'SENDING',$9,$10) RETURNING *`, [id, parsed.phone, peerHash, requestScope, keyHash, intentHash, this.hash('otp', `${id}:${code}`), this.options.provider.mode, now, new Date(now.getTime() + 300_000)])).rows[0];
      return { row, fresh: true };
    });
    if (!prepared.fresh) {
      if (prepared.row.status === 'FAILED') throw new IdentityFault('PROVIDER_UNAVAILABLE', 'Code delivery could not be confirmed');
      if (['SENDING', 'UNKNOWN'].includes(prepared.row.status)) throw new IdentityFault('PROVIDER_OUTCOME_UNKNOWN', 'Code delivery is being reconciled');
      return this.challenge(prepared.row);
    }
    // Provider I/O happens after the transaction commits. A crashed/unknown
    // send is never repeated merely because the client retries its key.
    try {
      const delivery = await this.options.provider.send({ phone: parsed.phone, code, challengeId: prepared.row.id });
      if (!delivery.reference || delivery.reference.length > 200) throw new Error('Invalid delivery reference');
      await this.options.db.query("UPDATE identity_otp_challenges SET status='ACCEPTED',provider_reference=$2 WHERE id=$1 AND status='SENDING'", [prepared.row.id, delivery.reference]);
      return this.challenge(prepared.row);
    } catch (error) {
      const knownFailure = error instanceof IdentityFault && error.code === 'PROVIDER_UNAVAILABLE';
      await this.options.db.query("UPDATE identity_otp_challenges SET status=$2 WHERE id=$1 AND status='SENDING'", [prepared.row.id, knownFailure ? 'FAILED' : 'UNKNOWN']);
      throw new IdentityFault(knownFailure ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_OUTCOME_UNKNOWN', 'Code delivery could not be confirmed');
    }
  }
  private async issueSession(tx: PoolClient, profileId: string, familyId?: string): Promise<v2.Session> {
    const now = this.clock(), id = randomUUID();
    const family = familyId ?? randomUUID();
    if (!familyId) await tx.query('INSERT INTO identity_session_families (id,profile_id,issuer_mode,created_at) VALUES ($1,$2,$3,$4)', [family, profileId, this.options.provider.mode, now]);
    const accessToken = randomBytes(32).toString('base64url'), refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + ACCESS_MS);
    await tx.query(`INSERT INTO identity_sessions (id,family_id,access_hash,refresh_hash,created_at,access_expires_at,refresh_expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, family, this.hash('access', accessToken), this.hash('refresh', refreshToken), now, expiresAt, new Date(now.getTime() + REFRESH_MS)]);
    return v2.sessionSchema.parse({ sessionId: id, accessToken, refreshToken, expiresAt: expiresAt.toISOString(), actor: this.actor(profileId) });
  }
  async verifyOtp(input: v2.OtpVerify, key: string, peer: string): Promise<v2.Session> {
    const parsed = v2.otpVerifySchema.parse(input);
    return this.command(`verify:${parsed.challengeId}`, key, parsed, async tx => {
      if (!await this.rate(tx, `verify-peer:${this.hash('peer', peer)}`, 100)) return denied('RATE_LIMITED', 'Too many verification attempts');
      const challenge = (await tx.query('SELECT * FROM identity_otp_challenges WHERE id=$1 FOR UPDATE', [parsed.challengeId])).rows[0];
      if (!challenge || challenge.issuer_mode !== this.options.provider.mode || (process.env.NODE_ENV === 'production' && challenge.issuer_mode !== 'LIVE') || challenge.status !== 'ACCEPTED' || challenge.attempts >= 5 || challenge.expires_at.getTime() <= this.clock().getTime()) return denied('UNAUTHENTICATED', 'Code is invalid or expired');
      await tx.query('UPDATE identity_otp_challenges SET attempts=attempts+1 WHERE id=$1', [challenge.id]);
      if (!timingSafeEqual(Buffer.from(challenge.code_hash, 'hex'), Buffer.from(this.hash('otp', `${challenge.id}:${parsed.code}`), 'hex'))) return denied('UNAUTHENTICATED', 'Code is invalid or expired');
      const profile = (await tx.query(`INSERT INTO identity_profiles (id,phone,created_at) VALUES ($1,$2,$3)
        ON CONFLICT (phone) DO UPDATE SET phone=EXCLUDED.phone RETURNING id,active`, [randomUUID(), challenge.phone, this.clock()])).rows[0];
      if (!profile.active) return denied('UNAUTHENTICATED', 'Sign in is unavailable');
      await tx.query("UPDATE identity_otp_challenges SET status='USED' WHERE id=$1", [challenge.id]);
      const session = await this.issueSession(tx, profile.id);
      await this.audit(tx, 'SESSION_CREATED', profile.id, session.sessionId);
      return { ok: true, value: session, sessionId: session.sessionId };
    });
  }
  async refresh(input: v2.SessionRefresh, key: string, peer: string): Promise<v2.Session> {
    const parsed = v2.sessionRefreshSchema.parse(input);
    if (!validToken(parsed.refreshToken)) throw invalidSession();
    const lookup = await this.sessionRecord(this.options.db, 'refresh', parsed.refreshToken);
    if (!lookup) throw invalidSession();
    return this.command(`refresh:${lookup.id}`, key, parsed, async tx => {
      if (!await this.rate(tx, `refresh-peer:${this.hash('peer', peer)}`, 100)) return denied('RATE_LIMITED', 'Too many refresh attempts');
      await tx.query('SELECT id FROM identity_session_families WHERE id=$1 FOR UPDATE', [lookup.family_id]);
      const row = await this.sessionRecord(tx, 'refresh', parsed.refreshToken);
      if (!row || row.revoked_at || !row.active || row.issuer_mode !== this.options.provider.mode) return denied('UNAUTHENTICATED', 'Sign in again to continue');
      if (row.rotated_at) {
        await tx.query("UPDATE identity_session_families SET revoked_at=$2,revoke_reason='REFRESH_REPLAY' WHERE id=$1", [row.family_id, this.clock()]);
        await this.audit(tx, 'REFRESH_REPLAY_REVOKED', row.profile_id, row.family_id);
        return denied('UNAUTHENTICATED', 'Sign in again to continue');
      }
      if (!this.current(row, true)) return denied('UNAUTHENTICATED', 'Sign in again to continue');
      await tx.query('UPDATE identity_sessions SET rotated_at=$2 WHERE id=$1', [row.id, this.clock()]);
      const session = await this.issueSession(tx, row.profile_id, row.family_id);
      await this.audit(tx, 'SESSION_ROTATED', row.profile_id, session.sessionId);
      return { ok: true, value: session, sessionId: session.sessionId };
    });
  }
  async logout(token: string, key: string): Promise<v2.LogoutResult> {
    const row = await this.sessionRecord(this.options.db, 'access', token);
    if (!row || row.issuer_mode !== this.options.provider.mode) throw invalidSession();
    return this.command(`logout:${row.id}`, key, {}, async tx => {
      await tx.query("UPDATE identity_session_families SET revoked_at=COALESCE(revoked_at,$2),revoke_reason=COALESCE(revoke_reason,'LOGOUT') WHERE id=$1", [row.family_id, this.clock()]);
      await this.audit(tx, 'LOGOUT', row.profile_id, row.family_id);
      return success({ revoked: true });
    });
  }
  async revoke(token: string, sessionId: string, key: string): Promise<v2.SessionRevocation> {
    const current = await this.authenticate(token);
    v2.idSchema.parse(sessionId);
    return this.command(`revoke:${current.actor.id}`, key, { sessionId }, async tx => {
      const row = (await tx.query(`SELECT f.id FROM identity_sessions s JOIN identity_session_families f ON f.id=s.family_id
        WHERE s.id=$1 AND f.profile_id=$2`, [sessionId, current.actor.id])).rows[0];
      if (!row) return denied('NOT_FOUND', 'Session not found');
      await tx.query("UPDATE identity_session_families SET revoked_at=COALESCE(revoked_at,$2),revoke_reason=COALESCE(revoke_reason,'OWNER_REVOKED') WHERE id=$1", [row.id, this.clock()]);
      await this.audit(tx, 'SESSION_REVOKED', current.actor.id, sessionId);
      return success({ sessionId, revoked: true });
    }, async tx => { await this.lock(tx, `revoke-owner:${current.actor.id}`); return this.authenticated(tx, token, true); });
  }
  private async assertOwnedAddress(tx: PoolClient, id: string, ownerId: string) {
    if (!(await tx.query('SELECT id FROM identity_addresses WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL', [id, ownerId])).rowCount) throw new IdentityFault('NOT_FOUND', 'Address not found');
  }
  private address(row: { id: string; owner_id: string; version: number; address: unknown }): v2.Address {
    return v2.addressSchema.parse({ ...v2.addressInputSchema.parse(row.address), id: row.id, ownerId: row.owner_id, version: row.version });
  }
  async createAddress(token: string, input: v2.AddressInput, key: string): Promise<v2.Address> {
    const current = await this.authenticate(token), parsed = v2.addressInputSchema.parse(input);
    return this.command(`address-create:${current.actor.id}`, key, parsed, async tx => {
      const count = (await tx.query('SELECT count(*)::int AS n FROM identity_addresses WHERE owner_id=$1 AND deleted_at IS NULL', [current.actor.id])).rows[0].n;
      if (count >= 100) return denied('INVALID_INPUT', 'Remove an unused address before adding another');
      const row = (await tx.query(`INSERT INTO identity_addresses (id,owner_id,address,created_at,updated_at) VALUES ($1,$2,$3,$4,$4) RETURNING *`, [randomUUID(), current.actor.id, JSON.stringify(parsed), this.clock()])).rows[0];
      await this.audit(tx, 'ADDRESS_CREATED', current.actor.id, row.id);
      return success(this.address(row));
    }, async tx => { await this.lock(tx, `addresses-owner:${current.actor.id}`); return this.authenticated(tx, token, true); }, (tx, value) => this.assertOwnedAddress(tx, value.id, current.actor.id));
  }
  async listAddresses(token: string): Promise<v2.Address[]> {
    return this.tx(async tx => {
      const current = await this.authenticated(tx, token, true);
      const rows = (await tx.query('SELECT * FROM identity_addresses WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY id LIMIT 100', [current.actor.id])).rows;
      return rows.map(row => this.address(row));
    });
  }
  async updateAddress(token: string, id: string, input: v2.AddressUpdate, key: string): Promise<v2.Address> {
    const current = await this.authenticate(token), parsed = v2.addressUpdateSchema.parse(input);
    v2.idSchema.parse(id);
    return this.command(`address-update:${current.actor.id}`, key, { id, ...parsed }, async tx => {
      const row = (await tx.query('SELECT * FROM identity_addresses WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE', [id, current.actor.id])).rows[0];
      if (!row) return denied('NOT_FOUND', 'Address not found');
      if (row.version !== parsed.expectedVersion) return { ...denied('VERSION_CONFLICT', 'Address changed; refresh before editing'), currentVersion: row.version };
      const result = (await tx.query('UPDATE identity_addresses SET address=$2,version=version+1,updated_at=$3 WHERE id=$1 RETURNING *', [id, JSON.stringify({ label: parsed.label, line1: parsed.line1, city: parsed.city, postalCode: parsed.postalCode, coordinates: parsed.coordinates }), this.clock()])).rows[0];
      await this.audit(tx, 'ADDRESS_UPDATED', current.actor.id, id);
      return success(this.address(result));
    }, tx => this.authenticated(tx, token, true), (tx, value) => this.assertOwnedAddress(tx, value.id, current.actor.id));
  }
  async deleteAddress(token: string, id: string, version: number, key: string): Promise<v2.DeleteResult> {
    const current = await this.authenticate(token);
    v2.idSchema.parse(id); v2.expectedVersionSchema.parse(version);
    return this.command(`address-delete:${current.actor.id}`, key, { id, version }, async tx => {
      const row = (await tx.query('SELECT * FROM identity_addresses WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE', [id, current.actor.id])).rows[0];
      if (!row) return denied('NOT_FOUND', 'Address not found');
      if (row.version !== version) return { ...denied('VERSION_CONFLICT', 'Address changed; refresh before deleting'), currentVersion: row.version };
      await tx.query('UPDATE identity_addresses SET deleted_at=$2,updated_at=$2,version=version+1 WHERE id=$1', [id, this.clock()]);
      await this.audit(tx, 'ADDRESS_DELETED', current.actor.id, id);
      return success({ id, deleted: true });
    }, tx => this.authenticated(tx, token, true));
  }
}
