-- ============================================================================
-- API Hub — 014_user_username.sql
-- Unique public username on users for search, invite, and add-to-team
-- without exposing email.
-- ============================================================================

ALTER TABLE users ADD COLUMN username text;

-- Backfill existing rows from the email local-part; keep the CHECK format
-- (letter + 2–29 alphanumerics/underscores) and uniquify collisions.
WITH base AS (
  SELECT
    id,
    regexp_replace(split_part(email, '@', 1), '[^A-Za-z0-9_]', '', 'g') AS raw
  FROM users
  WHERE username IS NULL
),
cleaned AS (
  SELECT
    id,
    CASE
      WHEN raw ~ '^[A-Za-z]' AND char_length(raw) >= 3
        THEN left(raw, 30)
      WHEN char_length(raw) >= 2
        THEN left('u' || raw, 30)
      ELSE 'user' || substr(replace(id::text, '-', ''), 1, 8)
    END AS candidate
  FROM base
),
numbered AS (
  SELECT
    id,
    candidate,
    row_number() OVER (PARTITION BY lower(candidate) ORDER BY id) AS rn
  FROM cleaned
)
UPDATE users u
   SET username = CASE
         WHEN n.rn = 1 THEN n.candidate
         ELSE left(n.candidate, 30 - char_length(n.rn::text)) || n.rn::text
       END
  FROM numbered n
 WHERE u.id = n.id
   AND u.username IS NULL;

ALTER TABLE users
  ALTER COLUMN username SET NOT NULL,
  ADD CONSTRAINT users_username_format
    CHECK (username ~ '^[A-Za-z][A-Za-z0-9_]{2,29}$');

CREATE UNIQUE INDEX users_username_lower_uidx ON users (lower(username));
