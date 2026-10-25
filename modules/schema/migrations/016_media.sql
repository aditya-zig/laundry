-- B07 proposal only. This file is applied by the media acceptance test after
-- initializeDb and is not yet a canonical migration. Coordinator integration
-- turns it into the next numbered migration.
--
-- Private evidence objects. An intent and the object it becomes share one row:
-- state PENDING is an intent, AVAILABLE is accepted evidence, DELETED has been
-- removed by the retention sweep. Catalog assets are not stored here because
-- their public variants are published separately.
CREATE TABLE IF NOT EXISTS media_objects (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  actor_role text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('PROOF_IMAGE','VOICE_NOTE','CUSTOMER_ATTACHMENT')),
  purpose text NOT NULL CHECK (char_length(purpose) BETWEEN 1 AND 200),
  mime_type text NOT NULL CHECK (char_length(mime_type) BETWEEN 1 AND 120),
  declared_size_bytes bigint NOT NULL CHECK (declared_size_bytes > 0 AND declared_size_bytes <= 10000000),
  size_bytes bigint CHECK (size_bytes IS NULL OR (size_bytes > 0 AND size_bytes <= 10000000)),
  digest text CHECK (digest IS NULL OR digest ~ '^[0-9a-f]{64}$'),
  storage_key text NOT NULL,
  upload_expires_at timestamptz NOT NULL,
  order_id uuid,
  incident_id uuid,
  facility_id uuid,
  state text NOT NULL CHECK (state IN ('PENDING','AVAILABLE','FAILED','DELETED')),
  retention_until timestamptz NOT NULL,
  finalized_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL,
  CONSTRAINT media_object_storage_key_unique UNIQUE (storage_key),
  CONSTRAINT media_object_retention_after_creation CHECK (retention_until > created_at),
  CONSTRAINT media_object_finalized_fields CHECK (
    state <> 'AVAILABLE' OR (size_bytes IS NOT NULL AND digest IS NOT NULL AND finalized_at IS NOT NULL)
  ),
  CONSTRAINT media_object_deleted_at CHECK (state <> 'DELETED' OR deleted_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS media_object_actor ON media_objects (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS media_object_order ON media_objects (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_object_incident ON media_objects (incident_id) WHERE incident_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_object_retention ON media_objects (retention_until) WHERE state <> 'DELETED';

-- Append-only record of every download decision. Denials are written on their
-- own connection so a rejected command still leaves a trace after rollback.
CREATE TABLE IF NOT EXISTS media_access_log (
  id uuid PRIMARY KEY,
  media_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  actor_role text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('ALLOWED','DENIED','NOT_FOUND','EXPIRED')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  occurred_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS media_access_log_media ON media_access_log (media_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS media_access_log_actor ON media_access_log (actor_id, occurred_at DESC);
