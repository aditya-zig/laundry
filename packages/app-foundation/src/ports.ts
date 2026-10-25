/** Platform storage is injected. The browser defaults are memory-only and make
 * no durability/keychain claim. A native host must supply verified secure IO. */
export class StorageError extends Error {
  override readonly cause: unknown;
  constructor(message: string, cause?: unknown) { super(message); this.name = 'StorageError'; this.cause = cause; }
}
export interface SecureTokenStore {
  read(): Promise<string | null>;
  write(token: string | null): Promise<void>;
}
export interface QueuedMutationRecord {
  idempotencyKey: string;
  routeId: string;
  params: Record<string, string>;
  bodyJson: string | null;
  actorId: string | null;
  /** Canonical role/facility scope at confirmation; missing legacy scope is
   * quarantined, never inferred from a later login. */
  identityKey?: string;
  createdAt: string;
}
export interface PendingMutationStore {
  list(): Promise<QueuedMutationRecord[]>;
  add(record: QueuedMutationRecord): Promise<void>;
  remove(idempotencyKey: string): Promise<void>;
  clear(): Promise<void>;
}
async function stored<T>(operation: string, work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) { throw error instanceof StorageError ? error : new StorageError(`Secure persistence failed during ${operation}.`, error); }
}
export function asSecureTokenStore(raw: SecureTokenStore): SecureTokenStore {
  return { read: () => stored('reading refresh credentials', () => raw.read()),
    write: token => stored('writing refresh credentials', () => raw.write(token)) };
}
export function asPendingMutationStore(raw: PendingMutationStore): PendingMutationStore {
  return { list: () => stored('listing pending commands', () => raw.list()),
    add: record => stored('persisting a pending command', () => raw.add(record)),
    remove: key => stored('retiring a pending command', () => raw.remove(key)),
    clear: () => stored('clearing pending commands', () => raw.clear()) };
}
export function createMemorySecureTokenStore(): SecureTokenStore {
  let value: string | null = null;
  return { async read() { return value; }, async write(next) { value = next; } };
}
export function createMemoryPendingMutationStore(): PendingMutationStore {
  const queue = new Map<string, QueuedMutationRecord>();
  return { async list() { return structuredClone([...queue.values()]); },
    async add(record) {
      const previous = queue.get(record.idempotencyKey);
      if (previous && JSON.stringify(previous) !== JSON.stringify(record)) throw new StorageError('A pending key cannot be replaced with different intent');
      queue.set(record.idempotencyKey, structuredClone(record));
    },
    async remove(key) { queue.delete(key); }, async clear() { queue.clear(); },
  };
}
