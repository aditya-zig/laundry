-- B08 proposal. Private test database only until the coordinator merges this
-- into the canonical migration sequence. Support incidents and reviews live in
-- their own tables because neither may rewrite an order. An incident is
-- evidence of a complaint, and a review is evidence of customer judgement;
-- both keep the order row untouched.
CREATE TABLE IF NOT EXISTS support_v2_incidents (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders_v2_orders(id),
  customer_id uuid NOT NULL REFERENCES identity_profiles(id),
  status text NOT NULL CHECK (status IN ('OPEN','AWAITING_CUSTOMER','AWAITING_FACILITY','RESOLVED','REJECTED')),
  category text NOT NULL CHECK (category IN ('DAMAGED','MISSING','LATE','QUALITY','BILLING','OTHER')),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 2000),
  detail text CHECK (detail IS NULL OR char_length(detail) BETWEEN 1 AND 2000),
  media_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(media_ids) = 'array'),
  resolution_outcome text CHECK (resolution_outcome IN ('REPROCESS','REFUND','REPLACE','REWORK','NO_ACTION')),
  refund_amount_minor bigint CHECK (refund_amount_minor IS NULL OR refund_amount_minor >= 0),
  resolution text CHECK (resolution IS NULL OR char_length(resolution) BETWEEN 1 AND 2000),
  resolved_by uuid REFERENCES identity_staff(id),
  resolved_at timestamptz,
  -- No foreign key here: the rewash row points back at this incident, so a
  -- forward reference would need a deferrable constraint. The unique index
  -- below keeps the link one to one.
  rewash_request_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (updated_at >= created_at),
  -- A closed incident is only closed because a named person recorded why.
  CHECK ((status IN ('RESOLVED','REJECTED')) = (resolved_at IS NOT NULL)),
  CHECK ((status IN ('RESOLVED','REJECTED')) = (resolution IS NOT NULL)),
  CHECK ((status IN ('RESOLVED','REJECTED')) = (resolution_outcome IS NOT NULL)),
  CHECK ((status IN ('RESOLVED','REJECTED')) = (resolved_by IS NOT NULL)),
  CHECK (resolution_outcome <> 'REFUND' OR refund_amount_minor IS NOT NULL),
  CHECK (resolution_outcome IS NULL OR resolution_outcome = 'REFUND' OR refund_amount_minor IS NULL)
);
CREATE INDEX IF NOT EXISTS support_v2_incident_customer ON support_v2_incidents (customer_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS support_v2_incident_order ON support_v2_incidents (order_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS support_v2_incident_rewash_link
  ON support_v2_incidents (rewash_request_id) WHERE rewash_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS support_v2_incident_messages (
  id uuid PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES support_v2_incidents(id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq > 0),
  author_role text NOT NULL CHECK (author_role IN ('CUSTOMER','OPERATOR','SUPPORT','SYSTEM')),
  -- A customer id from identity_profiles or a staff id from identity_staff,
  -- depending on author_role, so no single table can own this key.
  author_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  media_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(media_ids) = 'array'),
  created_at timestamptz NOT NULL,
  UNIQUE (incident_id, seq)
);
CREATE INDEX IF NOT EXISTS support_v2_incident_message_incident ON support_v2_incident_messages (incident_id, seq);

CREATE TABLE IF NOT EXISTS support_v2_rewashes (
  id uuid PRIMARY KEY,
  incident_id uuid NOT NULL UNIQUE REFERENCES support_v2_incidents(id),
  order_id uuid NOT NULL REFERENCES orders_v2_orders(id),
  status text NOT NULL CHECK (status IN ('REQUESTED','APPROVED','IN_PROGRESS','COMPLETED','DECLINED')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  -- Completion is its own later event. A requested rewash has no finish time,
  -- and a completed one cannot lose it.
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS support_v2_rewash_order ON support_v2_rewashes (order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reviews_v2 (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders_v2_orders(id),
  customer_id uuid NOT NULL REFERENCES identity_profiles(id),
  overall smallint NOT NULL CHECK (overall BETWEEN 1 AND 5),
  service_score smallint CHECK (service_score IS NULL OR service_score BETWEEN 1 AND 5),
  delivery_score smallint CHECK (delivery_score IS NULL OR delivery_score BETWEEN 1 AND 5),
  comment text CHECK (comment IS NULL OR char_length(comment) <= 5000),
  media_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(media_ids) = 'array'),
  publish_consent boolean NOT NULL,
  publication text NOT NULL CHECK (publication IN ('PENDING','PUBLISHED','REJECTED')),
  moderation_reason text CHECK (moderation_reason IS NULL OR char_length(moderation_reason) BETWEEN 1 AND 2000),
  moderated_by uuid REFERENCES identity_staff(id),
  moderated_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (updated_at >= created_at),
  -- Publication is impossible without explicit consent and a named decision.
  CHECK (publication <> 'PUBLISHED' OR publish_consent),
  CHECK ((publication = 'PENDING') = (moderated_by IS NULL)),
  CHECK ((publication = 'PENDING') = (moderated_at IS NULL)),
  CHECK ((publication = 'PENDING') = (moderation_reason IS NULL)),
  -- One customer reviews one order once.
  UNIQUE (order_id, customer_id)
);
CREATE INDEX IF NOT EXISTS reviews_v2_publication ON reviews_v2 (publication, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS reviews_v2_customer ON reviews_v2 (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reviews_v2_moderation_events (
  id uuid PRIMARY KEY,
  review_id uuid NOT NULL REFERENCES reviews_v2(id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq > 0),
  decision text NOT NULL CHECK (decision IN ('PUBLISH','REJECT','HIDE')),
  from_publication text NOT NULL CHECK (from_publication IN ('PENDING','PUBLISHED','REJECTED')),
  to_publication text NOT NULL CHECK (to_publication IN ('PENDING','PUBLISHED','REJECTED')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 2000),
  moderated_by uuid NOT NULL REFERENCES identity_staff(id),
  moderated_at timestamptz NOT NULL,
  UNIQUE (review_id, seq)
);
CREATE INDEX IF NOT EXISTS reviews_v2_moderation_review ON reviews_v2_moderation_events (review_id, seq);
