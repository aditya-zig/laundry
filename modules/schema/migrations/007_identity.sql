-- Separate production-v2 identity. Historical demo users/sessions are not promoted.
CREATE TABLE IF NOT EXISTS identity_profiles (
  id uuid PRIMARY KEY,
  phone text NOT NULL UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS identity_otp_challenges (
  id uuid PRIMARY KEY,
  phone text NOT NULL,
  peer_hash text NOT NULL,
  request_scope text NOT NULL,
  key_hash text NOT NULL,
  intent_hash text NOT NULL,
  code_hash text NOT NULL,
  issuer_mode text NOT NULL CHECK (issuer_mode IN ('FAKE','LIVE')),
  status text NOT NULL CHECK (status IN ('SENDING','ACCEPTED','FAILED','UNKNOWN','USED','SUPERSEDED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  provider_reference text,
  UNIQUE (request_scope,key_hash)
);
CREATE INDEX IF NOT EXISTS identity_challenge_phone_time ON identity_otp_challenges (phone,created_at DESC);
CREATE TABLE IF NOT EXISTS identity_rate_buckets (
  key_hash text NOT NULL,
  bucket_start timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  PRIMARY KEY (key_hash,bucket_start)
);
CREATE TABLE IF NOT EXISTS identity_session_families (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES identity_profiles(id),
  issuer_mode text NOT NULL CHECK (issuer_mode IN ('FAKE','LIVE')),
  created_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text
);
CREATE TABLE IF NOT EXISTS identity_sessions (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES identity_session_families(id),
  access_hash text NOT NULL UNIQUE,
  refresh_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  access_expires_at timestamptz NOT NULL CHECK (access_expires_at > created_at),
  refresh_expires_at timestamptz NOT NULL CHECK (refresh_expires_at > access_expires_at),
  rotated_at timestamptz
);
CREATE INDEX IF NOT EXISTS identity_sessions_family ON identity_sessions(family_id);
CREATE TABLE IF NOT EXISTS identity_command_results (
  scope text NOT NULL,
  key_hash text NOT NULL,
  intent_hash text NOT NULL,
  sealed_result text NOT NULL,
  session_id uuid REFERENCES identity_sessions(id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope,key_hash)
);
CREATE TABLE IF NOT EXISTS identity_addresses (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES identity_profiles(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  address jsonb NOT NULL CHECK (jsonb_typeof(address) = 'object'),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS identity_address_owner ON identity_addresses(owner_id,id) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS identity_audit (
  id uuid PRIMARY KEY,
  profile_id uuid REFERENCES identity_profiles(id),
  action text NOT NULL,
  resource_id uuid,
  created_at timestamptz NOT NULL
);
-- Audit deliberately contains no OTP, token, phone, address or request body.
