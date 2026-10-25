-- B05 proposal: due-at-return billing.
--
-- Not applied by initializeDb. Proposals live outside the canonical migration
-- sequence until the coordinator promotes them, so the B05 acceptance suite
-- reads and applies this file itself after initializeDb.
--
-- Money is integer INR minor units. Every amount is non-negative and an
-- obligation can never settle past its due amount. Receipts are append only:
-- a wrong receipt is corrected with a refund, never an UPDATE.

CREATE TABLE IF NOT EXISTS billing_obligations (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders_v2_orders(id),
  status text NOT NULL CHECK (status IN ('OPEN','PARTIALLY_SETTLED','SETTLED','VOID')),
  amount_due_minor bigint NOT NULL CONSTRAINT billing_obligations_due_nonnegative CHECK (amount_due_minor >= 0),
  amount_settled_minor bigint NOT NULL DEFAULT 0 CONSTRAINT billing_obligations_settled_nonnegative CHECK (amount_settled_minor >= 0),
  currency text NOT NULL CHECK (currency = 'INR'),
  payment_model text NOT NULL CHECK (payment_model IN ('DUE_AT_RETURN','PREPAID_V1')),
  due_at timestamptz NOT NULL,
  void_reason text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT billing_obligations_settled_within_due CHECK (amount_settled_minor <= amount_due_minor),
  CONSTRAINT billing_obligations_settled_status CHECK (status <> 'SETTLED' OR amount_settled_minor = amount_due_minor),
  CONSTRAINT billing_obligations_open_status CHECK (status <> 'OPEN' OR amount_settled_minor = 0),
  CONSTRAINT billing_obligations_partial_status CHECK (status <> 'PARTIALLY_SETTLED' OR (amount_settled_minor > 0 AND amount_settled_minor < amount_due_minor)),
  CONSTRAINT billing_obligations_void_status CHECK (status <> 'VOID' OR (void_reason IS NOT NULL AND amount_settled_minor = amount_due_minor)),
  CONSTRAINT billing_obligations_void_reason_scope CHECK (status = 'VOID' OR void_reason IS NULL)
);
-- One live obligation per order. A void obligation is history and may be
-- replaced, which is why the uniqueness predicate excludes it.
CREATE UNIQUE INDEX IF NOT EXISTS billing_obligations_one_live_per_order
  ON billing_obligations (order_id) WHERE status <> 'VOID';
CREATE INDEX IF NOT EXISTS billing_obligations_order ON billing_obligations (order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_payment_attempts (
  id uuid PRIMARY KEY,
  obligation_id uuid NOT NULL REFERENCES billing_obligations(id),
  status text NOT NULL CHECK (status IN ('CREATED','PENDING','SUCCEEDED','FAILED','EXPIRED','OUTCOME_UNKNOWN')),
  method text NOT NULL CHECK (method IN ('CASH','UPI','CARD','WALLET','GATEWAY')),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  provider_reference text,
  external_event_id text,
  started_at timestamptz NOT NULL,
  resolved_at timestamptz,
  failure_reason text,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  CONSTRAINT billing_attempts_terminal_resolved CHECK (status NOT IN ('SUCCEEDED','FAILED','EXPIRED') OR resolved_at IS NOT NULL),
  CONSTRAINT billing_attempts_unknown_is_not_failure CHECK (status <> 'OUTCOME_UNKNOWN' OR failure_reason IS NULL)
);
CREATE INDEX IF NOT EXISTS billing_attempts_obligation ON billing_payment_attempts (obligation_id, started_at DESC);
-- A stable provider reference identifies one charge. A retry reuses it and can
-- never introduce a second money movement for the same reference.
CREATE UNIQUE INDEX IF NOT EXISTS billing_attempts_provider_reference
  ON billing_payment_attempts (provider_reference) WHERE provider_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS billing_receipts (
  id uuid PRIMARY KEY,
  obligation_id uuid NOT NULL REFERENCES billing_obligations(id),
  order_id uuid NOT NULL REFERENCES orders_v2_orders(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency = 'INR'),
  method text NOT NULL CHECK (method IN ('CASH','UPI','CARD','WALLET','GATEWAY')),
  confirmed_by uuid,
  confirmed_via text NOT NULL CHECK (confirmed_via IN ('MANUAL_CASH','MANUAL_UPI','GATEWAY_CAPTURE')),
  external_reference text,
  provider text,
  provider_event_id text,
  issued_at timestamptz NOT NULL,
  CONSTRAINT billing_receipts_gateway_reference CHECK (confirmed_via <> 'GATEWAY_CAPTURE' OR (external_reference IS NOT NULL AND confirmed_by IS NULL)),
  CONSTRAINT billing_receipts_manual_actor CHECK (confirmed_via = 'GATEWAY_CAPTURE' OR confirmed_by IS NOT NULL),
  CONSTRAINT billing_receipts_manual_cash_method CHECK (confirmed_via <> 'MANUAL_CASH' OR method = 'CASH'),
  CONSTRAINT billing_receipts_manual_upi_method CHECK (confirmed_via <> 'MANUAL_UPI' OR method = 'UPI'),
  CONSTRAINT billing_receipts_gateway_method CHECK (confirmed_via <> 'GATEWAY_CAPTURE' OR method = 'GATEWAY'),
  CONSTRAINT billing_receipts_gateway_provider CHECK (confirmed_via <> 'GATEWAY_CAPTURE' OR provider IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS billing_receipts_obligation ON billing_receipts (obligation_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS billing_receipts_order ON billing_receipts (order_id, issued_at DESC);
-- One gateway capture per external reference, and one receipt per provider
-- event even if the same reference is replayed under a new event id.
CREATE UNIQUE INDEX IF NOT EXISTS billing_receipts_gateway_reference
  ON billing_receipts (provider, external_reference) WHERE confirmed_via = 'GATEWAY_CAPTURE';
CREATE UNIQUE INDEX IF NOT EXISTS billing_receipts_provider_event
  ON billing_receipts (provider, provider_event_id) WHERE provider_event_id IS NOT NULL;

-- Receipts are immutable. Corrections are refunds, not edits.
CREATE OR REPLACE FUNCTION billing_receipts_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'billing receipts are immutable; record a refund instead';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS billing_receipts_append_only ON billing_receipts;
CREATE TRIGGER billing_receipts_append_only
  BEFORE UPDATE OR DELETE ON billing_receipts
  FOR EACH ROW EXECUTE FUNCTION billing_receipts_append_only();

CREATE TABLE IF NOT EXISTS billing_refunds (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders_v2_orders(id),
  receipt_id uuid NOT NULL REFERENCES billing_receipts(id),
  obligation_id uuid REFERENCES billing_obligations(id),
  status text NOT NULL CHECK (status IN ('REQUESTED','PROCESSING','SUCCEEDED','FAILED','OUTCOME_UNKNOWN')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency = 'INR'),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 2000),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL,
  resolved_at timestamptz,
  external_reference text,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  CONSTRAINT billing_refunds_resolved_status CHECK (status NOT IN ('SUCCEEDED','FAILED') OR resolved_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS billing_refunds_order ON billing_refunds (order_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS billing_refunds_receipt ON billing_refunds (receipt_id, requested_at DESC);
-- A refund keeps one stable provider reference across retries.
CREATE UNIQUE INDEX IF NOT EXISTS billing_refunds_external_reference
  ON billing_refunds (external_reference) WHERE external_reference IS NOT NULL;

-- Durable provider event log. `initializeDb` never applies this proposal and
-- the command-result cache can be pruned later; this table is the replay
-- defence, so a provider resend after any cache expiry still changes the
-- ledger at most once.
CREATE TABLE IF NOT EXISTS billing_provider_events (
  id uuid PRIMARY KEY,
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 40),
  event_id text NOT NULL CHECK (char_length(event_id) BETWEEN 1 AND 200),
  payment_id uuid,
  provider_reference text NOT NULL CHECK (char_length(provider_reference) BETWEEN 1 AND 200),
  outcome text NOT NULL CHECK (outcome IN ('SUCCEEDED','FAILED','EXPIRED','PENDING')),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency text NOT NULL CHECK (currency = 'INR'),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  payload_hash text NOT NULL,
  applied boolean NOT NULL DEFAULT false,
  duplicate_reference boolean NOT NULL DEFAULT false,
  note text,
  UNIQUE (provider, event_id)
);
CREATE INDEX IF NOT EXISTS billing_provider_events_period ON billing_provider_events (received_at);
CREATE INDEX IF NOT EXISTS billing_provider_events_reference ON billing_provider_events (provider, provider_reference);

CREATE TABLE IF NOT EXISTS billing_reconciliation_entries (
  id uuid PRIMARY KEY,
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  kind text NOT NULL CHECK (kind IN ('CAPTURE','REFUND','MANUAL','CHARGEBACK')),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency text NOT NULL CHECK (currency = 'INR'),
  external_reference text NOT NULL CHECK (char_length(external_reference) BETWEEN 1 AND 200),
  provider text NOT NULL,
  provider_event_id text,
  recorded_at timestamptz NOT NULL,
  matched boolean NOT NULL,
  UNIQUE (period, provider, external_reference, kind)
);
CREATE INDEX IF NOT EXISTS billing_reconciliation_entries_period ON billing_reconciliation_entries (period, recorded_at);
