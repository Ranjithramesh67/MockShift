-- Monotonic per-user session generation. Bumped on password reset so every
-- session minted before the reset is rejected without comparing clocks.
ALTER TABLE users ADD COLUMN session_epoch integer NOT NULL DEFAULT 0;
