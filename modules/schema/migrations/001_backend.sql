-- Laundry backend migration 001. Normalized Postgres tables with real
-- transactional guarantees. All money is integer minor INR.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('customer','rider','facility','operator','admin')),
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otp_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  consumed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  line1 TEXT NOT NULL,
  city TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_addresses_owner ON addresses(owner_id);

CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT NOT NULL,
  price_minor INT NOT NULL,
  price_unit TEXT NOT NULL,
  turnaround_hours INT NOT NULL,
  features JSONB NOT NULL DEFAULT '[]',
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS garment_types (
  id UUID PRIMARY KEY,
  service_id UUID NOT NULL REFERENCES services(id),
  name TEXT NOT NULL,
  price_minor INT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (version)
);

CREATE TABLE IF NOT EXISTS capacity_buckets (
  bucket_key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  capacity_total INT NOT NULL DEFAULT 2,
  reserved INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS capacity_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_key TEXT NOT NULL REFERENCES capacity_buckets(bucket_key),
  quote_id UUID,
  expires_at TIMESTAMPTZ NOT NULL,
  released BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INT NOT NULL DEFAULT 1,
  customer_id UUID NOT NULL REFERENCES users(id),
  address_id UUID NOT NULL,
  lines JSONB NOT NULL,
  breakdown JSONB NOT NULL,
  total_minor INT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  provisional BOOLEAN NOT NULL DEFAULT FALSE,
  pickup_window JSONB NOT NULL,
  promised_return JSONB NOT NULL,
  rate_card_id UUID,
  rate_card_version INT NOT NULL DEFAULT 1,
  hold_id UUID REFERENCES capacity_holds(id),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  actor_id UUID NOT NULL,
  request_hash TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INT NOT NULL DEFAULT 1,
  customer_id UUID NOT NULL REFERENCES users(id),
  facility_id UUID,
  quote_id UUID UNIQUE REFERENCES quotes(id),
  status TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT',
  lines JSONB NOT NULL,
  total_minor INT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  pickup_window JSONB NOT NULL,
  promised_return JSONB NOT NULL,
  address_snapshot JSONB NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'CREATED',
  adjustment JSONB,
  pickup_otp TEXT,
  return_otp TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS order_timeline (
  id BIGSERIAL PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  label TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_timeline_order ON order_timeline(order_id, id);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  quote_id UUID NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'INITIAL',
  amount_minor INT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'PENDING',
  provider TEXT NOT NULL DEFAULT 'demo',
  provider_ref TEXT UNIQUE,
  payment_url TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);

CREATE TABLE IF NOT EXISTS refund_obligations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  amount_minor INT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  payment_id UUID REFERENCES payments(id),
  obligation_id UUID REFERENCES refund_obligations(id),
  amount_minor INT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'REQUESTED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  leg TEXT NOT NULL CHECK (leg IN ('PICKUP','RETURN')),
  status TEXT NOT NULL DEFAULT 'BOOKED',
  version INT NOT NULL DEFAULT 1,
  provider TEXT NOT NULL DEFAULT 'manual',
  dispatch_mode TEXT NOT NULL DEFAULT 'MANUAL',
  capabilities JSONB NOT NULL DEFAULT '["OTP_HANDOVER"]',
  assigned_to UUID REFERENCES users(id),
  time_window JSONB NOT NULL,
  address TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  bag_ids JSONB NOT NULL DEFAULT '[]',
  attempt INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, leg, attempt)
);
CREATE INDEX IF NOT EXISTS idx_jobs_assignee ON delivery_jobs(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_jobs_order ON delivery_jobs(order_id);

CREATE TABLE IF NOT EXISTS handover_actions (
  action_id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES delivery_jobs(id),
  method TEXT NOT NULL,
  proof_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, action_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id),
  customer_id UUID NOT NULL REFERENCES users(id),
  overall INT NOT NULL CHECK (overall BETWEEN 1 AND 5),
  service_score INT CHECK (service_score BETWEEN 1 AND 5),
  delivery_score INT CHECK (delivery_score BETWEEN 1 AND 5),
  comment TEXT,
  media_ids JSONB NOT NULL DEFAULT '[]',
  consent BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'PENDING_MODERATION',
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES users(id),
  conversation_key TEXT NOT NULL DEFAULT 'demo',
  revision INT NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'COLLECTING',
  fields JSONB NOT NULL DEFAULT '{}',
  quote_id UUID REFERENCES quotes(id),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '24 hours',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_message_id TEXT UNIQUE,
  draft_id UUID REFERENCES conversation_drafts(id),
  sender TEXT NOT NULL,
  text TEXT,
  transcript JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched BOOLEAN NOT NULL DEFAULT FALSE,
  attempts INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox(dispatched, occurred_at);

CREATE TABLE IF NOT EXISTS inbox (
  event_id TEXT PRIMARY KEY,
  handled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id),
  customer_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'OPEN',
  messages JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
