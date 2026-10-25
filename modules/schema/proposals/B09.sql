-- B09 conversation persistence. A proposal, not a canonical migration: the
-- coordinator owns modules/schema/migrations. Tables are prefixed v2 and never
-- alter the v1 demo tables conversation_drafts and conversation_messages from
-- 001_backend.sql, which keep their append-only demo shape.
--
-- Every row is written inside the command transaction. A provider event id is
-- unique, so a replayed webhook cannot create a second message or draft. A
-- draft stores the exact basket snapshot it was quoted from; confirmation only
-- succeeds while the live quote still matches that snapshot.
CREATE TABLE IF NOT EXISTS conversation_v2_threads (
  id uuid PRIMARY KEY,
  phone text NOT NULL UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  profile_id uuid REFERENCES identity_profiles(id),
  state text NOT NULL CHECK (state IN ('AUTOMATED','HUMAN_HANDOFF','OPTED_OUT')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS conversation_v2_thread_profile ON conversation_v2_threads (profile_id);

CREATE TABLE IF NOT EXISTS conversation_v2_drafts (
  id uuid PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES conversation_v2_threads(id),
  customer_id uuid REFERENCES identity_profiles(id),
  revision integer NOT NULL CHECK (revision >= 0),
  state text NOT NULL CHECK (state IN ('COLLECTING','QUOTED','CONFIRMED','BOOKING_CREATED','EXPIRED','HUMAN_HANDOFF')),
  fields jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(fields) = 'object'),
  missing_fields jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(missing_fields) = 'array'),
  snapshot jsonb CHECK (snapshot IS NULL OR jsonb_typeof(snapshot) = 'object'),
  confirmation_token text CHECK (confirmation_token IS NULL OR confirmation_token ~ '^[a-f0-9]{16}$'),
  quote_id uuid,
  quote_version integer CHECK (quote_version IS NULL OR quote_version > 0),
  booking_id uuid,
  booking jsonb CHECK (booking IS NULL OR jsonb_typeof(booking) = 'object'),
  handoff_to uuid,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (state <> 'HUMAN_HANDOFF' OR handoff_to IS NOT NULL),
  CHECK (quote_id IS NULL OR quote_version IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS conversation_v2_draft_thread ON conversation_v2_drafts (thread_id, updated_at DESC);
-- One order per draft, enforced by the database rather than by handler order.
CREATE UNIQUE INDEX IF NOT EXISTS conversation_v2_draft_booking
  ON conversation_v2_drafts (booking_id) WHERE booking_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS conversation_v2_messages (
  id uuid PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES conversation_v2_threads(id),
  provider_message_id text UNIQUE,
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 32),
  direction text NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
  draft_id uuid REFERENCES conversation_v2_drafts(id),
  body text,
  audio_media_id uuid,
  transcript jsonb,
  reply_text text,
  delivery text CHECK (delivery IN ('SENT','SIMULATED','BLOCKED_OPT_OUT','BLOCKED_HANDOFF','FAILED')),
  received_at timestamptz NOT NULL,
  retention_expires_at timestamptz,
  created_at timestamptz NOT NULL,
  CHECK (provider_message_id IS NOT NULL OR direction = 'OUTBOUND')
);
CREATE INDEX IF NOT EXISTS conversation_v2_message_thread ON conversation_v2_messages (thread_id, received_at DESC);
CREATE INDEX IF NOT EXISTS conversation_v2_message_retention ON conversation_v2_messages (retention_expires_at)
  WHERE audio_media_id IS NOT NULL;

-- Evidence that the customer quoted this revision's token on the channel. One
-- row per revision: a new revision needs a new exact confirmation.
CREATE TABLE IF NOT EXISTS conversation_v2_confirmations (
  id uuid PRIMARY KEY,
  draft_id uuid NOT NULL REFERENCES conversation_v2_drafts(id),
  revision integer NOT NULL CHECK (revision >= 0),
  quote_id uuid NOT NULL,
  quote_version integer NOT NULL CHECK (quote_version > 0),
  token text NOT NULL,
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  snapshot_hash text NOT NULL,
  provider_message_id text,
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  quoted_at timestamptz NOT NULL,
  UNIQUE (draft_id, revision)
);

CREATE TABLE IF NOT EXISTS conversation_v2_handoffs (
  id uuid PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES conversation_v2_threads(id),
  draft_id uuid NOT NULL REFERENCES conversation_v2_drafts(id),
  assigned_to uuid NOT NULL,
  actor_id uuid NOT NULL,
  actor_role text NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 2000),
  assigned_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS conversation_v2_handoff_draft ON conversation_v2_handoffs (draft_id, assigned_at DESC);

CREATE TABLE IF NOT EXISTS conversation_v2_optouts (
  phone text PRIMARY KEY CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  channel text NOT NULL DEFAULT 'WHATSAPP' CHECK (channel = 'WHATSAPP'),
  source text NOT NULL CHECK (source IN ('CUSTOMER_ROUTE','INBOUND_MESSAGE','OPERATOR')),
  actor_id uuid,
  opted_out_at timestamptz NOT NULL
);
