-- B10 proposal. Not a canonical migration; the coordinator applies it after
-- review. v2_outbox already carries the event identity, due time and attempt
-- counter, and v2_inbox already carries per-consumer dedupe. What it does not
-- carry is a worker lease, a version for replay conflict detection, a terminal
-- dead-letter record or an audit of privacy sweeps, so those are added here.

-- One row per event that has ever been claimed. The outbox row stays the
-- source of truth for the event itself; this table never rewrites it.
CREATE TABLE IF NOT EXISTS job_runs (
  event_id uuid PRIMARY KEY REFERENCES v2_outbox(event_id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_consumer text,
  last_success_at timestamptz,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS job_runs_lease ON job_runs(lease_expires_at) WHERE lease_expires_at IS NOT NULL;

-- A dead letter is terminal until an operator replays it. The partial unique
-- index keeps at most one open record per event even if two workers fail it.
CREATE TABLE IF NOT EXISTS job_dead_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES v2_outbox(event_id) ON DELETE CASCADE,
  consumer text NOT NULL,
  event_type text NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  reason_code text NOT NULL,
  reason text NOT NULL,
  job_version integer NOT NULL CHECK (job_version > 0),
  dead_lettered_at timestamptz NOT NULL,
  replayed_at timestamptz,
  replay_count integer NOT NULL DEFAULT 0 CHECK (replay_count >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS job_dead_letter_open ON job_dead_letters(job_id) WHERE replayed_at IS NULL;
CREATE INDEX IF NOT EXISTS job_dead_letter_page ON job_dead_letters(dead_lettered_at DESC, id DESC) WHERE replayed_at IS NULL;

-- Bounded counts only. No phone, address, media key or payload copy.
CREATE TABLE IF NOT EXISTS job_privacy_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sweep text NOT NULL CHECK (sweep IN ('OTP_CHALLENGES','SESSION_FAMILIES','WHATSAPP_LINKS','MEDIA_RETENTION')),
  status text NOT NULL CHECK (status IN ('COMPLETED','SKIPPED')),
  detail text,
  rows_deleted integer NOT NULL DEFAULT 0 CHECK (rows_deleted >= 0),
  rows_redacted integer NOT NULL DEFAULT 0 CHECK (rows_redacted >= 0),
  rows_refused integer NOT NULL DEFAULT 0 CHECK (rows_refused >= 0),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS job_privacy_runs_sweep ON job_privacy_runs(sweep, finished_at DESC);
