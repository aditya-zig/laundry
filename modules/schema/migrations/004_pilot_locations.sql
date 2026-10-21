-- Reported positions from the delivery partner. The latest point is kept per
-- order for the map; the trail keeps every report with its provenance so a
-- drawn path can be checked against what was actually reported.
CREATE TABLE IF NOT EXISTS pilot_locations (
  order_id UUID PRIMARY KEY REFERENCES pilot_orders(id),
  lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  captured_at TIMESTAMPTZ NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL CHECK (source IN ('BROWSER_GEOLOCATION','MANUAL')),
  actor_id UUID NOT NULL REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS pilot_location_reports (
  id BIGSERIAL PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES pilot_orders(id),
  lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  captured_at TIMESTAMPTZ NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL CHECK (source IN ('BROWSER_GEOLOCATION','MANUAL')),
  actor_id UUID NOT NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS pilot_location_reports_order ON pilot_location_reports(order_id, id DESC);
