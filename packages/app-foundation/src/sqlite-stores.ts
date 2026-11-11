import { StorageError, asPendingMutationStore, asSecureTokenStore, type QueuedMutationRecord, type SecureTokenStore } from './ports.js';

/** Native bootstrap must verify SQLCipher/key availability before exposing this
 * connection. Ordinary SQLite is useful for semantics tests, not encryption proof. */
export interface SessionDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: string[]): Promise<unknown>;
  getFirstAsync(sql: string, ...params: string[]): Promise<unknown>;
  getAllAsync(sql: string, ...params: string[]): Promise<unknown[]>;
}
function storedValue(row: unknown): string {
  if (!row || typeof row !== 'object' || !('value' in row) || typeof row.value !== 'string') {
    throw new StorageError('The persisted session journal contains an invalid row');
  }
  return row.value;
}
function isRecord(value: unknown): value is QueuedMutationRecord {
  if (!value || typeof value !== 'object') return false;
  return 'idempotencyKey' in value && typeof value.idempotencyKey === 'string' && value.idempotencyKey.length > 0 &&
    'routeId' in value && typeof value.routeId === 'string' && value.routeId.length > 0 &&
    'params' in value && value.params !== null && typeof value.params === 'object' && !Array.isArray(value.params) &&
    Object.values(value.params).every(item => typeof item === 'string') &&
    'actorId' in value && (value.actorId === null || typeof value.actorId === 'string') &&
    (!('identityKey' in value) || typeof value.identityKey === 'string') &&
    'bodyJson' in value && (value.bodyJson === null || typeof value.bodyJson === 'string') &&
    'createdAt' in value && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt));
}
function decode(value: string): QueuedMutationRecord {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) throw new Error('Invalid command record');
    if (parsed.bodyJson !== null) JSON.parse(parsed.bodyJson);
    return parsed;
  } catch { throw new StorageError('The pending command journal is corrupt; reconcile it without replacing its keys'); }
}
export interface NativeSessionDatabase extends SessionDatabase { closeAsync(): Promise<void>; }
/** The host provides OS key storage and the Expo SQLite connection, never an
 * encryption implementation. SQLCipher must be present before any data schema. */
export async function openNativeSqliteSessionStores(options: {
  deviceKey: SecureTokenStore;
  databaseExists(): Promise<boolean>;
  newDatabaseKey(): Promise<string>;
  openDatabase(): Promise<NativeSessionDatabase>;
}) {
  let db: NativeSessionDatabase | undefined;
  try {
    let key = await options.deviceKey.read();
    const exists = await options.databaseExists();
    if (!key && exists) {
      throw new StorageError('The existing encrypted journal has no device key; reconcile or restore it before continuing');
    }
    if (key && !/^[a-f0-9]{64}$/.test(key)) throw new StorageError('The native journal device key is invalid');
    if (key && !exists) throw new StorageError('The retained device key has no journal; restore or reconcile it before continuing');
    db = await options.openDatabase();
    const version = await db.getFirstAsync('PRAGMA cipher_version');
    if (!version || typeof version !== 'object' || !('cipher_version' in version) ||
      typeof version.cipher_version !== 'string' || !version.cipher_version.trim()) {
      throw new StorageError('This runtime has no SQLCipher; use a custom native build, not memory or plaintext storage');
    }
    if (!key) {
      key = await options.newDatabaseKey();
      if (!/^[a-f0-9]{64}$/.test(key)) throw new StorageError('A secure native journal key could not be generated');
      await options.deviceKey.write(key);
      if (await options.deviceKey.read() !== key) throw new StorageError('The native journal key was not securely persisted');
    }
    // SQLCipher's raw-key syntax; strict hex validation above is mandatory.
    await db.execAsync(`PRAGMA key = "x'${key}'";`);
    await db.execAsync('PRAGMA synchronous = FULL; PRAGMA secure_delete = ON;');
    return await createSqliteSessionStores(db);
  } catch (error) {
    await db?.closeAsync().catch(() => undefined);
    throw error instanceof StorageError ? error : new StorageError('Native encrypted session storage could not be opened', error);
  }
}
export async function createSqliteSessionStores(db: SessionDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS session_credentials (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pending_commands (idempotency_key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  `);
  return {
    refreshTokenStore: asSecureTokenStore({
      async read() {
        const row = await db.getFirstAsync('SELECT value FROM session_credentials WHERE id = 1');
        return row === null ? null : storedValue(row);
      },
      async write(value) {
        if (value === null) { await db.runAsync('DELETE FROM session_credentials WHERE id = 1'); return; }
        await db.runAsync('INSERT INTO session_credentials(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', value);
      },
    }),
    pendingMutationStore: asPendingMutationStore({
      async list() {
        const rows = await db.getAllAsync('SELECT idempotency_key,value FROM pending_commands ORDER BY rowid');
        return rows.map(row => {
          const record = decode(storedValue(row));
          if (!row || typeof row !== 'object' || !('idempotency_key' in row) || row.idempotency_key !== record.idempotencyKey) {
            throw new StorageError('The pending journal key does not match its retained intent');
          }
          return record;
        });
      },
      async add(record) {
        const encoded = JSON.stringify(record);
        decode(encoded);
        // A single insert is atomic even across connections. Never upsert a
        // command: a retained key must continue to name precisely one intent.
        await db.runAsync('INSERT OR IGNORE INTO pending_commands(idempotency_key,value) VALUES(?,?)', record.idempotencyKey, encoded);
        const persisted = await db.getFirstAsync('SELECT value FROM pending_commands WHERE idempotency_key = ?', record.idempotencyKey);
        if (persisted === null || storedValue(persisted) !== encoded) {
          throw new StorageError('A pending key cannot be replaced with different intent');
        }
      },
      async remove(key) { await db.runAsync('DELETE FROM pending_commands WHERE idempotency_key = ?', key); },
      async clear() { await db.runAsync('DELETE FROM pending_commands'); },
    }),
  };
}
