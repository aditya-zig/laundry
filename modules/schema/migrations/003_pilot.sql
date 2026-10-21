CREATE TABLE IF NOT EXISTS pilot_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_start TIMESTAMPTZ NOT NULL UNIQUE,
  pickup_end TIMESTAMPTZ NOT NULL,
  return_start TIMESTAMPTZ NOT NULL,
  return_end TIMESTAMPTZ NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0 AND reserved <= capacity)
);
CREATE TABLE IF NOT EXISTS pilot_orders (
  id UUID PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES users(id),
  rider_id UUID REFERENCES users(id),
  slot_id UUID NOT NULL REFERENCES pilot_slots(id),
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pilot_orders_customer ON pilot_orders(customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS pilot_orders_rider ON pilot_orders(rider_id,created_at DESC);
CREATE TABLE IF NOT EXISTS pilot_events (
  id BIGSERIAL PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES pilot_orders(id),
  actor_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  label TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pilot_receipts (
  order_id UUID PRIMARY KEY REFERENCES pilot_orders(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  method TEXT NOT NULL CHECK (method IN ('CASH','UPI')),
  reference TEXT NOT NULL,
  actor_id UUID NOT NULL REFERENCES users(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pilot_handover_attempts (
  order_id UUID NOT NULL REFERENCES pilot_orders(id),
  leg TEXT NOT NULL CHECK (leg IN ('PICKUP','RETURN')),
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (order_id,leg)
);
