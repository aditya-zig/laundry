-- 0001-foundation: A0-owned identity, address, idempotency, outbox, audit base.
-- Module tables (catalog, orders, billing, logistics, conversations) arrive as
-- A0-integrated proposals. Additive changes only; never delete live rows here.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL CHECK (role IN ('customer','rider','facility','operator','admin','system')),
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id UUID NOT NULL REFERENCES identities(id),
  token_hash TEXT NOT NULL UNIQUE,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auth_sessions_identity ON auth_sessions(identity_id);

CREATE TABLE addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES identities(id),
  version INT NOT NULL DEFAULT 1,
  label TEXT NOT NULL,
  line1 TEXT NOT NULL,
  city TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_addresses_owner ON addresses(owner_id);

CREATE TABLE media_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES identities(id),
  bucket TEXT NOT NULL,
  mime TEXT NOT NULL,
  byte_size INT NOT NULL CHECK (byte_size > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Same actor/key/payload replays; same key/different payload conflicts (409).
CREATE TABLE idempotency_records (
  actor_id UUID NOT NULL,
  idem_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, idem_key)
);

-- Transactional outbox: business row + outbox row commit together.
CREATE TABLE outbox (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  schema_version INT NOT NULL DEFAULT 1,
  aggregate_id UUID NOT NULL,
  aggregate_version INT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  trace_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  due_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_at TIMESTAMPTZ
);
CREATE INDEX idx_outbox_due ON outbox(due_at) WHERE dispatched_at IS NULL;

CREATE TABLE inbox (
  event_id UUID PRIMARY KEY,
  consumer TEXT NOT NULL,
  handled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id UUID,
  prev_value JSONB,
  new_value JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
