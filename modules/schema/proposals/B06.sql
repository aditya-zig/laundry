-- B06 proposal: production-v2 logistics assignments, custody proof and tracking.
--
-- This file is a proposal for the coordinator to fold into a canonical
-- migration. It is applied by the B06 acceptance suite against the disposable
-- local database and is not part of the runtime migration sequence yet.
--
-- Every table references orders_v2_orders rather than a legacy v1 row. Nothing
-- here is seeded and no production dispatch configuration is referenced.

CREATE TABLE IF NOT EXISTS logistics_leg_attempts (
  id uuid PRIMARY KEY,
  leg_id uuid NOT NULL,
  order_id uuid NOT NULL REFERENCES orders_v2_orders(id) ON DELETE CASCADE,
  leg text NOT NULL CHECK (leg IN ('PICKUP','RETURN')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL CHECK (status IN (
    'REQUESTED','BOOKING_UNKNOWN','BOOKED','ASSIGNED','AT_PICKUP','IN_TRANSIT',
    'COMPLETED','FAILED','CANCEL_REQUESTED','CANCELLED'
  )),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  provider text,
  provider_reference text,
  assigned_to uuid,
  scheduled_window jsonb CHECK (scheduled_window IS NULL OR jsonb_typeof(scheduled_window) = 'object'),
  failure_reason text,
  failure_media_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(failure_media_ids) = 'array'),
  failure_captured_at timestamptz,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (order_id, leg, attempt_number)
);
-- One live attempt per order leg. Retrying a failed leg creates a new attempt,
-- it never reopens the failed row.
CREATE UNIQUE INDEX IF NOT EXISTS logistics_one_active_attempt
  ON logistics_leg_attempts (order_id, leg)
  WHERE status IN ('REQUESTED','BOOKING_UNKNOWN','BOOKED','ASSIGNED','AT_PICKUP','IN_TRANSIT','CANCEL_REQUESTED');
CREATE UNIQUE INDEX IF NOT EXISTS logistics_provider_reference
  ON logistics_leg_attempts (provider, provider_reference)
  WHERE provider IS NOT NULL AND provider_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS logistics_assignments (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders_v2_orders(id) ON DELETE CASCADE,
  leg_attempt_id uuid NOT NULL REFERENCES logistics_leg_attempts(id) ON DELETE CASCADE,
  leg text NOT NULL CHECK (leg IN ('PICKUP','RETURN')),
  rider_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  state text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','RELEASED','CANCELLED')),
  assigned_at timestamptz NOT NULL,
  accepted_at timestamptz,
  released_at timestamptz,
  cancelled_at timestamptz,
  reason text CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 2000),
  assigned_by uuid NOT NULL,
  -- Only a keyed digest is stored. The plaintext custody code exists once, in
  -- the response of the issuing process, and is never written or logged.
  code_digest text,
  code_expires_at timestamptz,
  code_consumed_at timestamptz,
  code_attempts integer NOT NULL DEFAULT 0 CHECK (code_attempts >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (released_at IS NULL OR released_at >= assigned_at),
  CHECK (state <> 'RELEASED' OR released_at IS NOT NULL),
  CHECK (state <> 'CANCELLED' OR cancelled_at IS NOT NULL)
);
-- The core custody invariant: one active assignment for one order leg. A
-- reassignment releases the previous row in the same transaction.
CREATE UNIQUE INDEX IF NOT EXISTS logistics_one_active_assignment
  ON logistics_assignments (order_id, leg)
  WHERE released_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS logistics_assignment_rider
  ON logistics_assignments (rider_id, assigned_at DESC)
  WHERE released_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS logistics_assignment_attempt
  ON logistics_assignments (leg_attempt_id, assigned_at DESC);

CREATE TABLE IF NOT EXISTS logistics_assignment_events (
  id uuid PRIMARY KEY,
  assignment_id uuid NOT NULL REFERENCES logistics_assignments(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders_v2_orders(id) ON DELETE CASCADE,
  leg_attempt_id uuid NOT NULL REFERENCES logistics_leg_attempts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('ASSIGNED','ACCEPTED','RELEASED','CANCELLED','HANDOVER','EXCEPTION')),
  rider_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  actor_role text NOT NULL,
  reason text,
  occurred_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS logistics_assignment_event_attempt
  ON logistics_assignment_events (leg_attempt_id, occurred_at);

CREATE TABLE IF NOT EXISTS logistics_handovers (
  id uuid PRIMARY KEY,
  action_id uuid NOT NULL UNIQUE,
  request_hash text NOT NULL,
  order_id uuid NOT NULL REFERENCES orders_v2_orders(id) ON DELETE CASCADE,
  leg_attempt_id uuid NOT NULL REFERENCES logistics_leg_attempts(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES logistics_assignments(id),
  leg text NOT NULL CHECK (leg IN ('PICKUP','RETURN')),
  custody_kind text NOT NULL CHECK (custody_kind IN ('PICKUP_COMPLETED','RETURN_COMPLETED')),
  method text NOT NULL CHECK (method IN ('CODE','PROVIDER_PROOF','OPERATOR_EXCEPTION')),
  -- Digest and expiry of the code that was verified, kept for audit. The code
  -- itself is never stored.
  code_digest text,
  code_expires_at timestamptz,
  photo_media_id uuid,
  captured_lat double precision CHECK (captured_lat IS NULL OR captured_lat BETWEEN -90 AND 90),
  captured_lng double precision CHECK (captured_lng IS NULL OR captured_lng BETWEEN -180 AND 180),
  container_ids jsonb NOT NULL CHECK (jsonb_typeof(container_ids) = 'array'),
  garment_count integer NOT NULL CHECK (garment_count >= 0),
  condition text NOT NULL CHECK (condition IN ('GOOD','DAMAGED','STAINTED','MISSING')),
  note text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000),
  actor_id uuid NOT NULL,
  actor_role text NOT NULL,
  captured_at timestamptz NOT NULL,
  accepted boolean NOT NULL,
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (leg_attempt_id)
);
CREATE INDEX IF NOT EXISTS logistics_handover_order ON logistics_handovers (order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS logistics_positions (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders_v2_orders(id) ON DELETE CASCADE,
  leg_attempt_id uuid NOT NULL REFERENCES logistics_leg_attempts(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES logistics_assignments(id) ON DELETE CASCADE,
  rider_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('DEVICE','PROVIDER')),
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy_meters double precision CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0),
  reported_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS logistics_position_attempt
  ON logistics_positions (leg_attempt_id, reported_at DESC);
CREATE INDEX IF NOT EXISTS logistics_position_order
  ON logistics_positions (order_id, reported_at DESC);

CREATE TABLE IF NOT EXISTS logistics_provider_events (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  provider_reference text NOT NULL,
  status text NOT NULL CHECK (status IN ('BOOKED','ASSIGNED','AT_PICKUP','IN_TRANSIT','COMPLETED','FAILED','CANCELLED')),
  proof_reference text,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  applied boolean NOT NULL,
  received_at timestamptz NOT NULL,
  UNIQUE (provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS logistics_provider_event_reference
  ON logistics_provider_events (provider, provider_reference, occurred_at DESC);
