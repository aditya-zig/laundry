-- Production-v2 staff identity boundary. Rows here are provisioned by the
-- owner deployment path; runtime invitations only record operator-approved
-- intent. No customer signup or invitation row can promote a phone to staff.
CREATE TABLE IF NOT EXISTS identity_staff (
  id uuid PRIMARY KEY,
  phone text NOT NULL UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  role text NOT NULL CHECK (role IN ('OPERATOR','SUPPORT','FACILITY','RIDER','ADMIN')),
  active boolean NOT NULL DEFAULT true,
  invitation_id uuid UNIQUE,
  created_at timestamptz NOT NULL,
  deactivated_at timestamptz
);
CREATE INDEX IF NOT EXISTS identity_staff_active ON identity_staff (phone) WHERE active;
CREATE TABLE IF NOT EXISTS identity_staff_facilities (
  staff_id uuid NOT NULL REFERENCES identity_staff(id),
  facility_id uuid NOT NULL,
  PRIMARY KEY (staff_id,facility_id)
);
CREATE TABLE IF NOT EXISTS identity_staff_invitations (
  id uuid PRIMARY KEY,
  phone text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  role text NOT NULL CHECK (role IN ('OPERATOR','SUPPORT','FACILITY','RIDER')),
  facility_ids jsonb NOT NULL CHECK (jsonb_typeof(facility_ids) = 'array' AND jsonb_array_length(facility_ids) > 0),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 2000),
  created_by uuid NOT NULL REFERENCES identity_staff(id),
  status text NOT NULL CHECK (status IN ('PENDING','CONSUMED','EXPIRED','REVOKED')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  consumed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS identity_staff_invitation_pending_phone ON identity_staff_invitations (phone) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS identity_staff_invitation_phone ON identity_staff_invitations (phone,created_at DESC);
CREATE TABLE IF NOT EXISTS identity_staff_mfa (
  staff_id uuid NOT NULL REFERENCES identity_staff(id),
  secret_cipher text NOT NULL,
  status text NOT NULL CHECK (status IN ('ENROLLING','ENABLED','DISABLED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (staff_id)
);
-- Pending enrollments keep the secret only until completion; superseded rows
-- are deleted inside the enrolling transaction.
CREATE TABLE IF NOT EXISTS identity_staff_mfa_enrollments (
  id uuid PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES identity_staff(id),
  secret_cipher text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS identity_staff_mfa_enrollment_pending ON identity_staff_mfa_enrollments (staff_id) WHERE completed_at IS NULL;
-- Shared identity_audit, identity_rate_buckets and identity_command_results
-- tables continue to serve the staff boundary.
