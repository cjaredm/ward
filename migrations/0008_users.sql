-- Named accounts replace the single shared ward password.
--
-- Until now everyone typed the same WARD_APP_PASSWORD_HASH and hand-typed a
-- display name, so `audit_log.actor` and `households.updated_by` recorded
-- whatever the person felt like typing, and revoking access meant rotating one
-- secret for all 5-15 people at once. Each person now gets their own row here:
-- their own password, their own revocation, and a name the app supplies rather
-- than trusts the browser for.
--
-- The name column deliberately matches what was previously typed at the login
-- screen, so existing `updated_by` / `actor` strings keep lining up with the
-- people who wrote them. No backfill is possible or attempted — those are free
-- text from before accounts existed.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,                 -- always stored lowercased; see users_email_idx
  name          text NOT NULL,                 -- display name written into updated_by / audit actor
  password_hash text NOT NULL,                 -- bcrypt, cost 12
  is_admin      boolean NOT NULL DEFAULT false,
  -- Section keys from src/lib/permissions.ts. Admins bypass this list entirely,
  -- so it is empty for them. Kept as text[] rather than an enum because sections
  -- are app concepts that will churn faster than migrations should.
  permissions   text[] NOT NULL DEFAULT '{}',
  -- Set when an admin creates the account or resets the password. Every page in
  -- the app bounces to /change-password while it is true, so the temporary
  -- password an admin hands over cannot stay in use.
  must_change_password boolean NOT NULL DEFAULT true,
  -- Deactivation rather than deletion: audit rows and updated_by strings point
  -- at a person who has to keep existing.
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text
);

-- Case-insensitive uniqueness. Writers lowercase before inserting, so this is a
-- backstop against a path that forgets rather than the primary mechanism.
CREATE UNIQUE INDEX users_email_idx ON users (lower(email));
