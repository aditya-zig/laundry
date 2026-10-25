-- B01 verified WhatsApp channel binding. A link is written only after the
-- signed-in customer proves fresh control of the phone already bound to their
-- profile with a live-mode OTP challenge. The profile/phone pair is unique, so
-- one account cannot claim another account's number and one number cannot be
-- linked twice.
CREATE TABLE IF NOT EXISTS identity_whatsapp_links (
  profile_id uuid PRIMARY KEY REFERENCES identity_profiles(id),
  phone text NOT NULL UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  linked_at timestamptz NOT NULL
);
