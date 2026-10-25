-- Production-v2 quotes and orders. Prices are snapshotted at quote time, so a
-- later rate-card revision cannot reprice an existing quote or order.
CREATE TABLE IF NOT EXISTS orders_v2_quotes (
  id uuid PRIMARY KEY,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  customer_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN','BOOKED','EXPIRED')),
  area_id uuid NOT NULL,
  address_id uuid NOT NULL,
  address_snapshot jsonb NOT NULL CHECK (jsonb_typeof(address_snapshot) = 'object'),
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) >= 1),
  rate_cards jsonb NOT NULL CHECK (jsonb_typeof(rate_cards) = 'array'),
  breakdown jsonb NOT NULL CHECK (jsonb_typeof(breakdown) = 'array'),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  currency text NOT NULL CHECK (currency = 'INR'),
  provisional boolean NOT NULL,
  pickup_window jsonb NOT NULL CHECK (jsonb_typeof(pickup_window) = 'object'),
  return_window jsonb NOT NULL CHECK (jsonb_typeof(return_window) = 'object'),
  hold_reference uuid REFERENCES availability_holds(id),
  hold_expires_at timestamptz,
  catalog_version integer NOT NULL CHECK (catalog_version > 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_v2_quote_customer ON orders_v2_quotes (customer_id, created_at DESC);
CREATE TABLE IF NOT EXISTS orders_v2_orders (
  id uuid PRIMARY KEY,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('CONFIRMED','PICKUP_PENDING','AT_FACILITY','IN_CARE','QUALITY_CHECK','READY_FOR_RETURN','RETURNING','DELIVERED','AWAITING_ADJUSTMENT','ON_HOLD','CANCEL_REQUESTED','RESOLUTION_REQUIRED','CANCELLED')),
  customer_id uuid NOT NULL,
  facility_id uuid,
  quote_id uuid NOT NULL REFERENCES orders_v2_quotes(id),
  area_id uuid NOT NULL,
  address_snapshot jsonb NOT NULL CHECK (jsonb_typeof(address_snapshot) = 'object'),
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) >= 1),
  rate_cards jsonb NOT NULL CHECK (jsonb_typeof(rate_cards) = 'array'),
  containers jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(containers) = 'array'),
  measured_lines jsonb CHECK (measured_lines IS NULL OR jsonb_typeof(measured_lines) = 'array'),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  currency text NOT NULL CHECK (currency = 'INR'),
  payment_model text NOT NULL CHECK (payment_model IN ('DUE_AT_RETURN','PREPAID_V1')),
  pickup_window jsonb NOT NULL CHECK (jsonb_typeof(pickup_window) = 'object'),
  return_window jsonb NOT NULL CHECK (jsonb_typeof(return_window) = 'object'),
  hold_id uuid REFERENCES availability_holds(id),
  resume_status text CHECK (resume_status IS NULL OR resume_status IN ('CONFIRMED','PICKUP_PENDING','AT_FACILITY','IN_CARE','QUALITY_CHECK','READY_FOR_RETURN','RETURNING','AWAITING_ADJUSTMENT')),
  quality_check_passed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
-- Both list routes sort on (updated_at DESC, id DESC), and the queue also
-- filters by status or by the staff member's facility.
CREATE INDEX IF NOT EXISTS orders_v2_order_customer ON orders_v2_orders (customer_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS orders_v2_order_queue ON orders_v2_orders (updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS orders_v2_order_queue_status ON orders_v2_orders (status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS orders_v2_order_facility ON orders_v2_orders (facility_id, updated_at DESC, id DESC) WHERE facility_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS orders_v2_timeline (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders_v2_orders(id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq > 0),
  status text NOT NULL CHECK (status IN ('CONFIRMED','PICKUP_PENDING','AT_FACILITY','IN_CARE','QUALITY_CHECK','READY_FOR_RETURN','RETURNING','DELIVERED','AWAITING_ADJUSTMENT','ON_HOLD','CANCEL_REQUESTED','RESOLUTION_REQUIRED','CANCELLED')),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  actor_role text CHECK (actor_role IS NULL OR actor_role IN ('CUSTOMER','RIDER','FACILITY','OPERATOR','SUPPORT','ADMIN')),
  reason text,
  occurred_at timestamptz NOT NULL,
  UNIQUE (order_id, seq)
);
-- One proposed adjustment at a time; history keeps decided rows.
CREATE TABLE IF NOT EXISTS orders_v2_adjustments (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders_v2_orders(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 2000),
  previous_total_minor bigint NOT NULL CHECK (previous_total_minor >= 0),
  new_total_minor bigint NOT NULL CHECK (new_total_minor >= 0),
  delta_minor bigint NOT NULL CHECK (delta_minor > 0),
  state text NOT NULL CHECK (state IN ('PROPOSED','ACCEPTED','DECLINED','EXPIRED','ESCALATED')),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL,
  CHECK (new_total_minor = previous_total_minor + delta_minor),
  CHECK (state = 'PROPOSED' OR decided_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS orders_v2_adjustment_open
  ON orders_v2_adjustments (order_id) WHERE state = 'PROPOSED';
