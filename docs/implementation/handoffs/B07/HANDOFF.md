# B07 private evidence uploads, media access and retention

Baseline `08ec897` on `work/production-direct-20261022`. Implemented against the
frozen v2 contract. `packages/contracts`, canonical migrations and the app
composition root were not edited.

## What is implemented

`modules/schema/proposals/B07.sql` adds `media_objects` and `media_access_log`.
The proposal is applied by the acceptance test after `initializeDb` and is not a
canonical migration yet. `media_objects` holds the actor, role, kind, purpose,
MIME type, declared and stored size, SHA-256 digest, storage key, state,
retention boundary, deletion time and optional order, incident and facility
references. The storage key is unique. `media_access_log` is append only and
records actor, role, outcome, reason and time for every download decision.

`modules/media/src/storage.ts` defines `StoragePort` and
`createMemoryStorage()`, a deterministic in-memory fake. It mints signed upload
and download URLs, records bytes and their digest, reports size and MIME, and
removes objects. `modules/media/src/v2.ts` is `MediaService`. The clock and the
storage adapter are injected, and every mutating command runs through
`createPostgresCommandExecutor`.

Routes, all `POST`:

- `/v2/media/upload-intents` binds an intent to the signed-in actor, a MIME
  type from the per-kind allow list, a declared size within the 10,000,000 byte
  cap, a purpose and an optional order or incident. The order must already be
  visible to the actor. The result carries a 15 minute upload target.
- `/v2/media/{mediaId}/finalize` locks the intent, requires the same actor,
  recomputes the storage key from the intent binding, reads the stored object
  metadata and requires the stored size and MIME type to equal the declaration,
  with a 64 hex character digest. It moves `PENDING` to `AVAILABLE` once and
  sets the retention boundary.
- `/v2/media/{mediaId}/download` re-reads the object and its order, then allows
  the uploader, the owning customer, staff at the owning facility, or an
  operator or admin. Everyone else, including riders, gets `NOT_FOUND`. An
  available object past retention is `RETENTION_EXPIRED`. A successful call
  writes an `ALLOWED` row and returns a 5 minute signed URL.

`expireMedia(now)` sweeps `PENDING`, `AVAILABLE` and `FAILED` rows past
retention in batches with `FOR UPDATE SKIP LOCKED`, removes each object from
the store, marks the row `DELETED` and writes one `v2_audit` row per object under
a fixed system actor. A second run returns zero.

Retention is 90 days for proof images and voice notes, 180 days for customer
attachments. An intent that is never finalized keeps the 15 minute upload
window as its retention boundary, so orphaned intents are swept on the same
path.

## Deliberate limits

- There is no real object store, no S3, GCS or Cloudinary SDK, and no
  credentials. `StoragePort` is the integration point and the fake is the only
  implementation.
- There is no virus or content scanning. Finalize verifies metadata, not
  payload safety.
- There is no CDN and no public bucket. Catalog assets are refused by the intent
  route and remain a separate published surface.
- `expireMedia` is a callable sweep, not a scheduled worker. No live worker or
  cron invokes it.
- Incident ownership cannot be checked because the incident table belongs to
  B08. Incident-only media is readable by its uploader and by operators until
  B08 lands.
- A rider upload is refused. Custody proof for riders stays with B06.
- A replay of the same download key returns the stored URL until it expires.
  A client that needs a fresh URL uses a new idempotency key.
- Finalize by a different actor returns `FORBIDDEN`, which confirms that an id
  exists. Upload ids are random UUIDs and the issue names this case explicitly.
- A failed finalize leaves the intent `PENDING`; the retention sweep removes
  the object later. `FAILED` is reserved for a future scanner or adapter that
  rejects content.

## Scenario status

- `B07-01`: covered. The owning customer, facility staff at the owning facility
  and an operator read proof uploaded by the customer. An unrelated customer, a
  rider and staff at another facility get `NOT_FOUND` and no URL. The reverse
  case also passes: facility staff upload proof and the owning customer reads
  it.
- `B07-02`: covered. Disallowed MIME, an oversized declaration and a catalog
  asset are refused at intent. A stored object with the wrong MIME, the wrong
  size or no object at all cannot become `AVAILABLE`.
- `B07-03`: covered. The download URL is signed, expires after 5 minutes and
  the store refuses it after expiry. An object past retention is refused even
  before the sweep. There is no route that serves object bytes.
- `B07-04`: covered. A replayed intent key returns one row and a changed payload
  conflicts. Finalize is exactly once, replay returns the same reference and a
  second finalize is refused. The sweep deletes available, orphaned and failed
  objects, removes the bytes, writes one audit row each and repeats as a no-op.

## Verification

- Scoped typecheck of `modules/media/src/**` and
  `apps/api/src/features/media/**` against the built contracts: exit 0.
- `pnpm --filter @laundry/api exec vitest run media-v2` on isolated PostgreSQL:
  exit 0, 1 file, 11 tests passed.
- `pnpm --filter @laundry/api typecheck`: exit 2. The failure is outside this
  task in `modules/conversations/src/v2.ts` and `modules/logistics/src/v2.ts`,
  which reference `OptOutResult` and `WebhookResult`. Neither type is exported
  by `packages/contracts`. Parallel work changed which outside module failed
  first between runs; the media files were clean each time.
- `pnpm --filter @laundry/api test media-v2`: exit 2 at `pnpm build`, on the
  same missing contract types. That script runs the whole build before vitest,
  so the media suite could not run through it. The direct vitest command above
  is the observed result.

## Contract mismatches

- `UploadIntent` has no digest field. Finalize cannot compare a client-declared
  digest. It compares stored size and MIME type, requires a 64 hex character
  SHA-256 from the store, records it as `checksum` and binds the storage key to
  a digest of the intent fields.
- The finalize route names its path parameter `mediaId`, while the operation
  consumes an upload id. In this design the intent and the media object share
  one id, so the value is the same.
- `WebhookResult` and `OptOutResult` are referenced by the route registry, the
  wire map and other modules, but the contracts package exports only the schema
  values, not these type names. The repo-wide API build fails on that gap. It is
  not a B07 change.

Production uploads remain disabled.
