-- Drop role, phone and email from people. Names and callings stay.
--
-- Verified empty before writing this migration: 562 people, 0 non-null values
-- across all three columns. Nothing is lost. DROP COLUMN is not reversible, so
-- if that ever stops being true, back the columns up first.
--
-- Why they go rather than staying unused: this is the most sensitive data the
-- app could hold — phone numbers and email addresses of members including
-- minors — and neither report the ward imports carries them. Columns nobody
-- fills are columns nobody can leak.

ALTER TABLE people
  DROP COLUMN role,
  DROP COLUMN phone,
  DROP COLUMN email;
