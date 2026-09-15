-- 048_ci_email.sql
-- Case-insensitive account identity.
--
-- users.email was declared UNIQUE case-sensitively, so "Alice@Example.com" and
-- "alice@example.com" could become two separate accounts (LOW-3). Normalise the
-- stored addresses to lower-case and enforce uniqueness on lower(email).
--
-- The index is only created when the table has no pre-existing case-variant
-- duplicates; a dirty database is left untouched rather than failing the whole
-- migration (application code normalises on signup/login/checkout regardless).

UPDATE users u
   SET email = lower(u.email)
 WHERE u.email <> lower(u.email)
   AND NOT EXISTS (
     SELECT 1 FROM users v
      WHERE v.id <> u.id AND lower(v.email) = lower(u.email)
   );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users GROUP BY lower(email) HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));
  END IF;
END
$$;
