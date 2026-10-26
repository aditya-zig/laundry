-- Better Auth 1.7.13 + phone-number/bearer plugins. Additive: do not migrate
-- legacy demo identities or change ownership of existing orders/addresses.
-- Applied by the migration job, never by auth request handlers.
CREATE TABLE IF NOT EXISTS laundry_auth_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  image text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "phoneNumber" text UNIQUE,
  "phoneNumberVerified" boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS laundry_auth_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "expiresAt" timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "ipAddress" text,
  "userAgent" text,
  "userId" uuid NOT NULL REFERENCES laundry_auth_user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS laundry_auth_session_user_id_idx ON laundry_auth_session ("userId");
CREATE TABLE IF NOT EXISTS laundry_auth_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" uuid NOT NULL REFERENCES laundry_auth_user(id) ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope text,
  password text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("providerId", "accountId")
);
CREATE INDEX IF NOT EXISTS laundry_auth_account_user_id_idx ON laundry_auth_account ("userId");
CREATE TABLE IF NOT EXISTS laundry_auth_verification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  value text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS laundry_auth_verification_identifier_idx ON laundry_auth_verification (identifier);
-- Keep the binding after framework logout/deletion, so a missing framework
-- session invalidates derived v2 credentials instead of making them unbound.
CREATE TABLE IF NOT EXISTS identity_external_sessions (
  family_id uuid PRIMARY KEY REFERENCES identity_session_families(id) ON DELETE CASCADE,
  auth_session_id uuid NOT NULL,
  auth_user_id uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS identity_external_sessions_auth_session_idx ON identity_external_sessions (auth_session_id);
CREATE TABLE IF NOT EXISTS laundry_auth_rate_limit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  count integer NOT NULL,
  "lastRequest" bigint NOT NULL
);
