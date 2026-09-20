-- API Hub — 056_user_nav_order.sql
--
-- Per-user navigation rail order.
--
-- Every user can rearrange the sidebar icon rail to match how they work. The
-- order is stored server-side (not localStorage) so it follows the account to
-- every device they sign in on. `NULL` means "use the built-in default order";
-- any array is the user's explicit preference.
--
-- Values are rail item keys (see backend/src/api/menuAccess.js RAIL_ORDER_KEYS).
-- They are validated in the API before write, but the CHECK keeps a non-array
-- value from ever being stored.
--
-- Append-only: do not edit earlier migrations.

ALTER TABLE users ADD COLUMN IF NOT EXISTS nav_rail_order jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_nav_rail_order_is_array'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_nav_rail_order_is_array
      CHECK (nav_rail_order IS NULL OR jsonb_typeof(nav_rail_order) = 'array');
  END IF;
END$$;

COMMENT ON COLUMN users.nav_rail_order IS
  'User-chosen sidebar rail order (JSON array of menu keys); NULL = default order.';
