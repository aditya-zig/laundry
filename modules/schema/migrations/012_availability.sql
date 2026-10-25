-- Production-v2 service areas, capacity buckets and expiring holds. No area,
-- postal code or bucket is seeded: without approved operating hours, capacity
-- and a service area mapping the product publishes no slot at all.
CREATE TABLE IF NOT EXISTS availability_areas (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  timezone text NOT NULL CHECK (char_length(timezone) BETWEEN 1 AND 64),
  polygon jsonb NOT NULL CHECK (jsonb_typeof(polygon) = 'array' AND jsonb_array_length(polygon) >= 3),
  hours jsonb NOT NULL CHECK (jsonb_typeof(hours) = 'array'),
  slot_minutes integer NOT NULL CHECK (slot_minutes BETWEEN 15 AND 1440),
  pickup_lead_minutes integer NOT NULL CHECK (pickup_lead_minutes BETWEEN 0 AND 10080),
  booking_horizon_days integer NOT NULL CHECK (booking_horizon_days BETWEEN 1 AND 90),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS availability_area_postal_codes (
  postal_code text PRIMARY KEY CHECK (postal_code ~ '^[1-9][0-9]{5}$'),
  area_id uuid NOT NULL REFERENCES availability_areas(id)
);
CREATE INDEX IF NOT EXISTS availability_postal_area ON availability_area_postal_codes (area_id);
CREATE TABLE IF NOT EXISTS availability_buckets (
  id uuid PRIMARY KEY,
  facility_id uuid NOT NULL,
  area_id uuid NOT NULL REFERENCES availability_areas(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  timezone text NOT NULL CHECK (char_length(timezone) BETWEEN 1 AND 64),
  capacity integer NOT NULL CHECK (capacity >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (area_id, facility_id, starts_at, ends_at),
  CHECK (reserved <= capacity)
);
CREATE INDEX IF NOT EXISTS availability_bucket_window ON availability_buckets (area_id, starts_at, ends_at);
-- A hold is the only thing that can turn into a reservation. Releasing or
-- expiring it returns capacity exactly once, which the row status records.
CREATE TABLE IF NOT EXISTS availability_holds (
  id uuid PRIMARY KEY,
  bucket_id uuid NOT NULL REFERENCES availability_buckets(id),
  order_id uuid,
  status text NOT NULL CHECK (status IN ('HELD','RESERVED','RELEASED','EXPIRED')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  settled_at timestamptz,
  CHECK (status IN ('HELD','RESERVED') OR settled_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS availability_hold_expiry ON availability_holds (expires_at) WHERE status = 'HELD';
CREATE UNIQUE INDEX IF NOT EXISTS availability_hold_order
  ON availability_holds (order_id) WHERE order_id IS NOT NULL AND status = 'RESERVED';
