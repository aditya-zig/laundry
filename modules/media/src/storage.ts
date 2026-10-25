import { createHash, createHmac } from 'node:crypto';

/**
 * Private object storage boundary.
 *
 * The service only knows how to mint scoped targets and read back the metadata
 * the store recorded. A production adapter (S3, GCS, a private bucket behind a
 * signed URL service) implements this interface; `createMemoryStorage` is the
 * deterministic fake the tests use. No network call lives in this module.
 */
export interface StorageTarget {
  url: string;
  expiresAt: Date;
}

export interface ObjectStat {
  sizeBytes: number;
  mimeType: string;
  sha256: string;
}

export interface StoragePort {
  createUploadTarget(input: { key: string; mimeType: string; sizeBytes: number; expiresAt: Date }): Promise<StorageTarget>;
  createDownloadUrl(input: { key: string; expiresAt: Date }): Promise<StorageTarget>;
  stat(key: string): Promise<ObjectStat | null>;
  remove(key: string): Promise<boolean>;
}

interface StoredObject {
  bytes: Buffer;
  mimeType: string;
}

export interface MemoryStorage extends StoragePort {
  /** Simulate the client uploading bytes to the target it was given. */
  upload(url: string, body: Buffer | string, mimeType: string): void;
  has(key: string): boolean;
  objectCount(): number;
  /** True only for a download URL that is signed, unexpired and still stored. */
  verifyDownloadUrl(url: string, at: Date): boolean;
  keyFromUrl(url: string): string;
}

// A fixed, non-secret signing key makes the fake deterministic. A real adapter
// would use a provider-managed signing key that never enters this repository.
const FAKE_SIGNING_KEY = 'laundry-memory-storage-fake-v1';
const HOST = 'https://media.laundry.invalid';

function signature(scope: 'upload' | 'download', key: string, expiresAt: Date): string {
  return createHmac('sha256', FAKE_SIGNING_KEY)
    .update(`${scope}\n${key}\n${expiresAt.toISOString()}`)
    .digest('hex')
    .slice(0, 40);
}

function target(scope: 'upload' | 'download', key: string, expiresAt: Date): StorageTarget {
  const url = `${HOST}/${scope}/${encodeURIComponent(key)}?expires=${encodeURIComponent(expiresAt.toISOString())}&signature=${signature(scope, key, expiresAt)}`;
  return { url, expiresAt: new Date(expiresAt.getTime()) };
}

export function createMemoryStorage(): MemoryStorage {
  const objects = new Map<string, StoredObject>();

  function parse(url: string): { scope: string; key: string; expiresAt: Date; signature: string } | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.origin !== new URL(HOST).origin) return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length !== 2) return null;
    const expiresAt = new Date(parsed.searchParams.get('expires') ?? '');
    if (Number.isNaN(expiresAt.getTime())) return null;
    return {
      scope: segments[0],
      key: decodeURIComponent(segments[1]),
      expiresAt,
      signature: parsed.searchParams.get('signature') ?? '',
    };
  }

  return {
    async createUploadTarget(input) {
      return target('upload', input.key, input.expiresAt);
    },
    async createDownloadUrl(input) {
      return target('download', input.key, input.expiresAt);
    },
    async stat(key) {
      const object = objects.get(key);
      if (!object) return null;
      return {
        sizeBytes: object.bytes.length,
        mimeType: object.mimeType,
        sha256: createHash('sha256').update(object.bytes).digest('hex'),
      };
    },
    async remove(key) {
      return objects.delete(key);
    },
    upload(url, body, mimeType) {
      const parsed = parse(url);
      if (!parsed || parsed.scope !== 'upload') throw new Error('Upload target is not valid');
      if (parsed.signature !== signature('upload', parsed.key, parsed.expiresAt)) {
        throw new Error('Upload target signature does not match');
      }
      objects.set(parsed.key, { bytes: Buffer.isBuffer(body) ? body : Buffer.from(body), mimeType });
    },
    has(key) {
      return objects.has(key);
    },
    objectCount() {
      return objects.size;
    },
    verifyDownloadUrl(url, at) {
      const parsed = parse(url);
      if (!parsed || parsed.scope !== 'download') return false;
      if (parsed.signature !== signature('download', parsed.key, parsed.expiresAt)) return false;
      if (parsed.expiresAt.getTime() <= at.getTime()) return false;
      return objects.has(parsed.key);
    },
    keyFromUrl(url) {
      const parsed = parse(url);
      if (!parsed) throw new Error('Storage URL is not valid');
      return parsed.key;
    },
  };
}
