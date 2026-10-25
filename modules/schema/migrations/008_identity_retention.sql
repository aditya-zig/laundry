-- Expired secret/PII data can be erased while idempotency tombstones persist.
-- Near an absolute family deadline both token expiries can coincide.
-- PostgreSQL names the cross-column inline check from 007 as check1.
ALTER TABLE identity_sessions DROP CONSTRAINT IF EXISTS identity_sessions_check1;
ALTER TABLE identity_sessions DROP CONSTRAINT IF EXISTS identity_sessions_refresh_expires_at_check;
ALTER TABLE identity_sessions ADD CONSTRAINT identity_sessions_refresh_expires_at_check CHECK (refresh_expires_at >= access_expires_at);
ALTER TABLE identity_otp_challenges ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE identity_otp_challenges ALTER COLUMN code_hash DROP NOT NULL;
ALTER TABLE identity_command_results ALTER COLUMN sealed_result DROP NOT NULL;
ALTER TABLE identity_otp_challenges ADD COLUMN IF NOT EXISTS redacted_at timestamptz;
ALTER TABLE identity_command_results ADD COLUMN IF NOT EXISTS redacted_at timestamptz;
ALTER TABLE identity_session_families ADD COLUMN IF NOT EXISTS absolute_expires_at timestamptz;
UPDATE identity_session_families SET absolute_expires_at=created_at+interval '30 days' WHERE absolute_expires_at IS NULL;
ALTER TABLE identity_session_families ALTER COLUMN absolute_expires_at SET NOT NULL;
CREATE INDEX IF NOT EXISTS identity_challenge_retention ON identity_otp_challenges(expires_at,id) WHERE redacted_at IS NULL;
CREATE INDEX IF NOT EXISTS identity_command_retention ON identity_command_results(expires_at,scope,key_hash) WHERE redacted_at IS NULL;
CREATE INDEX IF NOT EXISTS identity_family_retention ON identity_session_families(absolute_expires_at,id) WHERE revoked_at IS NULL;
