-- Production-v2 catalog and immutable rate cards. No row is seeded here:
-- services, garments and rates stay absent and therefore unorderable until an
-- operator provisions and approves them. Historical demo catalog rows in the
-- v1 tables are not promoted.
CREATE TABLE IF NOT EXISTS catalog_services (
  id uuid PRIMARY KEY,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  code text NOT NULL UNIQUE CHECK (code IN ('WASH_FOLD','WASH_PRESS','PRESS_ONLY','DRY_CLEAN')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description text NOT NULL CHECK (char_length(description) <= 4000),
  image_url text NOT NULL CHECK (image_url ~ '^https://'),
  billing_unit text NOT NULL CHECK (billing_unit IN ('KG','PIECE','BOTH')),
  turnaround_hours integer NOT NULL CHECK (turnaround_hours BETWEEN 1 AND 720),
  features jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(features) = 'array'),
  care_exclusions jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(care_exclusions) = 'array'),
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS catalog_garments (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  eligible_service_codes jsonb NOT NULL CHECK (jsonb_typeof(eligible_service_codes) = 'array' AND jsonb_array_length(eligible_service_codes) > 0),
  price_minor integer CHECK (price_minor IS NULL OR price_minor >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS catalog_garment_eligible ON catalog_garments USING gin (eligible_service_codes);
-- Rate cards are immutable commercial documents. Approval and activation only
-- stamp timestamps; component values are never updated in place, so a published
-- quote keeps the exact version it priced against.
CREATE TABLE IF NOT EXISTS catalog_rate_cards (
  id uuid PRIMARY KEY,
  version integer NOT NULL UNIQUE CHECK (version > 0),
  service_codes jsonb NOT NULL CHECK (jsonb_typeof(service_codes) = 'array' AND jsonb_array_length(service_codes) > 0),
  components jsonb NOT NULL CHECK (jsonb_typeof(components) = 'array' AND jsonb_array_length(components) > 0),
  weight_increment_grams integer CHECK (weight_increment_grams IS NULL OR weight_increment_grams > 0),
  minimum_billable_grams integer CHECK (minimum_billable_grams IS NULL OR minimum_billable_grams > 0),
  rounding text NOT NULL CHECK (rounding IN ('NONE','CEIL','FLOOR')),
  effective_from timestamptz NOT NULL,
  approved_at timestamptz,
  activated_at timestamptz,
  synthetic boolean NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK (activated_at IS NULL OR approved_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS catalog_rate_card_active ON catalog_rate_cards (version DESC) WHERE activated_at IS NOT NULL;
