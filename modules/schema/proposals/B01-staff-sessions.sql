-- B01 staff login enforcement proposal (coordinator assigns canonical migration 019).
-- Additive only. Session families issued to provisioned staff are bound to the
-- staff row, the provisioned role and the enrolled MFA version at issue time.
-- Customer families carry no binding row and can never gain staff privileges;
-- deactivated/role-changed/MFA-reset staff fail the binding recheck on
-- authenticate, refresh and cached credential replay. Consumed TOTP steps are
-- recorded so a reused authenticator code is rejected atomically.

CREATE TABLE IF NOT EXISTS identity_session_staff_bindings (
  family_id uuid PRIMARY KEY REFERENCES identity_session_families(id),
  staff_id uuid NOT NULL REFERENCES identity_staff(id),
  role text NOT NULL CHECK (role IN ('OPERATOR','SUPPORT','FACILITY','RIDER','ADMIN')),
  -- NULL means the family was issued without an MFA-bound enrollment
  -- (nonproduction focus mode). A bound version must equal the current
  -- ENABLED version forever after; any reset invalidates the family.
  mfa_version integer CHECK (mfa_version IS NULL OR mfa_version > 0),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS identity_staff_mfa_steps (
  staff_id uuid NOT NULL REFERENCES identity_staff(id),
  step bigint NOT NULL CHECK (step >= 0),
  used_at timestamptz NOT NULL,
  PRIMARY KEY (staff_id,step)
);
CREATE INDEX IF NOT EXISTS identity_staff_mfa_steps_used ON identity_staff_mfa_steps (used_at);
