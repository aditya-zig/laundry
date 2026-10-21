-- Laundry migration 002: durable outbox lease + honest notification ledger.
-- Idempotent: safe to run on existing dev databases.
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS leased_until TIMESTAMPTZ;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS last_error TEXT;
CREATE INDEX IF NOT EXISTS idx_outbox_claim ON outbox(dispatched, attempts, leased_until, occurred_at);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID REFERENCES conversation_drafts(id),
  recipient TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent','simulated','not-configured','failed')),
  provider_message_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notification_deliveries(recipient, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_drafts_conversation_key ON conversation_drafts(conversation_key, state, expires_at);
