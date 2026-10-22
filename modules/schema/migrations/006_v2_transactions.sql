-- Separate v2 infrastructure. Does not reinterpret or rewrite v1 business facts.
CREATE TABLE IF NOT EXISTS v2_command_results (
  actor_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response JSONB NOT NULL,
  trace_id UUID NOT NULL,
  committed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (actor_id, idempotency_key)
);
-- Durable identities have no response-cache TTL. A future cache can reference
-- these rows but cannot delete booking/payment/provider uniqueness with its TTL.
CREATE TABLE IF NOT EXISTS v2_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL,
  actor_role TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_value JSONB NOT NULL,
  after_value JSONB NOT NULL,
  trace_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_v2_audit_aggregate ON v2_audit(aggregate_id, occurred_at);
CREATE TABLE IF NOT EXISTS v2_outbox (
  event_id UUID PRIMARY KEY,
  aggregate_id UUID NOT NULL,
  aggregate_version INTEGER NOT NULL CHECK (aggregate_version > 0),
  event_type TEXT NOT NULL,
  envelope JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  dispatched_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);
CREATE INDEX IF NOT EXISTS idx_v2_outbox_due ON v2_outbox(due_at) WHERE dispatched_at IS NULL;
CREATE TABLE IF NOT EXISTS v2_inbox (
  consumer TEXT NOT NULL,
  event_id UUID NOT NULL,
  event_hash TEXT NOT NULL,
  handled_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (consumer, event_id)
);
