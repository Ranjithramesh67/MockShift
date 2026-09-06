-- ============================================================================
-- Portal B demo seed — run manually against the dev DB as superuser (postgres),
-- which bypasses RLS. Idempotent; safe to re-run any time.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:5432/apihub" \
--        -v ON_ERROR_STOP=1 -f portal/db/seed-demo.sql
--
-- Guarantees five catalog plans exist with their first-recharge bonus policy
-- (Free ₹0: none; Starter +5, Pro +10, Team +15 extra validity days added on
-- the customer's first paid recharge; Enterprise custom), then seeds demo
-- "customer" users with one subscription per plan plus dedicated expiry
-- edge-case accounts (already expired / expires today / expires tomorrow),
-- orders, invoices, promo codes and audit rows.
-- ============================================================================

-- ---- Catalog plans (idempotent by unique key slug) -------------------------
-- trial_days is the per-plan "first-recharge bonus" knob: the number of extra
-- validity days granted on top of the paid period when the customer makes
-- their first paid recharge (Free ₹0 plan has no bonus). Re-running enforces
-- the canonical catalog values even when the rows already exist.
INSERT INTO plans (key, name, tagline, description, price_monthly, price_yearly,
                   currency, billing_cycles, trial_days, sort_order, status)
VALUES
  ('free',  'Free',       'For hobbyists and quick experiments', NULL,
    0,     0,     'INR', ARRAY['MONTHLY','YEARLY'], 0,  10, 'PUBLISHED'),
  ('starter','Starter',   'For solo builders shipping real work', NULL,
    99,    990,   'INR', ARRAY['MONTHLY','YEARLY'], 5,  20, 'PUBLISHED'),
  ('pro',   'Pro',        'For teams that live in their API workflow', NULL,
    299,  2990,   'INR', ARRAY['MONTHLY','YEARLY'], 10, 30, 'PUBLISHED'),
  ('team',  'Team',       'Shared workspaces, permissions and more', NULL,
    799,  7990,   'INR', ARRAY['MONTHLY','YEARLY'], 15, 40, 'PUBLISHED'),
  ('enterprise','Enterprise','Dedicated support and SSO at scale', NULL,
    NULL, NULL,  'INR', ARRAY['CUSTOM'],            0,  50, 'PUBLISHED')
ON CONFLICT (key) DO UPDATE SET trial_days = EXCLUDED.trial_days;

-- ---- Demo customer users (idempotent by email) ------------------------------
-- c1..c6 = one account per plan. c7 = already expired, c8 = expires today,
-- c9 = expires tomorrow (the expiry demo set).
INSERT INTO users (id, email, password_hash, name, role, username, is_active)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'c1@demo.apihub', 'x', 'Aarav Kumar',   'EDITOR', 'aarav',   true),
  ('a0000000-0000-0000-0000-000000000002', 'c2@demo.apihub', 'x', 'Priya Sharma',  'EDITOR', 'priya',   true),
  ('a0000000-0000-0000-0000-000000000003', 'c3@demo.apihub', 'x', 'Rohan Mehta',   'EDITOR', 'rohan',   true),
  ('a0000000-0000-0000-0000-000000000004', 'c4@demo.apihub', 'x', 'Ananya Iyer',   'EDITOR', 'ananya',  true),
  ('a0000000-0000-0000-0000-000000000005', 'c5@demo.apihub', 'x', 'Vikram Singh',  'EDITOR', 'vikram',  true),
  ('a0000000-0000-0000-0000-000000000006', 'c6@demo.apihub', 'x', 'Neha Gupta',    'EDITOR', 'neha',    true),
  ('a0000000-0000-0000-0000-000000000007', 'c7@demo.apihub', 'x', 'Meera Nair',    'EDITOR', 'meera',   true),
  ('a0000000-0000-0000-0000-000000000008', 'c8@demo.apihub', 'x', 'Kabir Kapoor',  'EDITOR', 'kabir',   true),
  ('a0000000-0000-0000-0000-000000000009', 'c9@demo.apihub', 'x', 'Zoya Ali',      'EDITOR', 'zoya',    true)
ON CONFLICT (email) DO NOTHING;

DO $$
DECLARE
  u1 uuid; u2 uuid; u3 uuid; u4 uuid; u5 uuid; u6 uuid;
  u7 uuid; u8 uuid; u9 uuid;
  p_free uuid; p_start uuid; p_pro uuid; p_team uuid; p_ent uuid;
  sub_id uuid; order_id uuid; n int;
BEGIN

  SELECT id INTO u1 FROM users WHERE email = 'c1@demo.apihub';
  SELECT id INTO u2 FROM users WHERE email = 'c2@demo.apihub';
  SELECT id INTO u3 FROM users WHERE email = 'c3@demo.apihub';
  SELECT id INTO u4 FROM users WHERE email = 'c4@demo.apihub';
  SELECT id INTO u5 FROM users WHERE email = 'c5@demo.apihub';
  SELECT id INTO u6 FROM users WHERE email = 'c6@demo.apihub';
  SELECT id INTO u7 FROM users WHERE email = 'c7@demo.apihub';
  SELECT id INTO u8 FROM users WHERE email = 'c8@demo.apihub';
  SELECT id INTO u9 FROM users WHERE email = 'c9@demo.apihub';
  SELECT id INTO p_free   FROM plans WHERE key = 'free';
  SELECT id INTO p_start  FROM plans WHERE key = 'starter';
  SELECT id INTO p_pro    FROM plans WHERE key = 'pro';
  SELECT id INTO p_team   FROM plans WHERE key = 'team';
  SELECT id INTO p_ent    FROM plans WHERE key = 'enterprise';

  -- ============ c1 Aarav — Pro MONTHLY ACTIVE, renews in ~6 days =============
  SELECT count(*) INTO n FROM subscriptions s WHERE s.user_id = u1 AND s.plan_id = p_pro;
  IF n = 0 THEN
    INSERT INTO subscriptions (user_id, plan_id, status, billing_cycle,
        current_period_start, current_period_end, cancel_at_period_end, created_at)
      VALUES (u1, p_pro, 'ACTIVE', 'MONTHLY',
        now() - interval '24 days', now() + interval '6 days', false, now() - interval '90 days')
      RETURNING id INTO sub_id;
    INSERT INTO orders (user_id, plan_id, subscription_id, amount, currency,
        billing_cycle, status, payment_method, created_at)
      VALUES (u1, p_pro, sub_id, 299, 'INR', 'MONTHLY', 'PAID', 'RAZORPAY',
              now() - interval '54 days');
    INSERT INTO orders (user_id, plan_id, subscription_id, amount, currency,
        billing_cycle, status, payment_method, created_at)
      VALUES (u1, p_pro, sub_id, 299, 'INR', 'MONTHLY', 'PAID', 'RAZORPAY',
              now() - interval '24 days')
      RETURNING id INTO order_id;
    INSERT INTO invoices (order_id, user_id, number, amount, currency, status,
        issued_at, paid_at, created_at)
      VALUES (order_id, u1, 'INV-2026-0001', 299, 'INR', 'PAID',
        now() - interval '24 days', now() - interval '24 days', now() - interval '24 days');
    INSERT INTO orders (user_id, plan_id, subscription_id, amount, currency,
        billing_cycle, status, payment_method, created_at)
      VALUES (u1, p_pro, sub_id, 299, 'INR', 'MONTHLY', 'PAID', 'RAZORPAY',
              now() - interval '6 days')
      RETURNING id INTO order_id;
    INSERT INTO invoices (order_id, user_id, number, amount, currency, status,
        issued_at, paid_at, created_at)
      VALUES (order_id, u1, 'INV-2026-0002', 299, 'INR', 'PAID',
        now() - interval '6 days', now() - interval '6 days', now() - interval '6 days');
    RAISE NOTICE 'demo-seed: c1 Aarav pro ACTIVE inserted';
  END IF;

  -- ============ c2 Priya — Team YEARLY ACTIVE (MRR 7990/12) ===================
  SELECT count(*) INTO n FROM subscriptions s WHERE s.user_id = u2 AND s.plan_id = p_team;
  IF n = 0 THEN
    INSERT INTO subscriptions (user_id, plan_id, status, billing_cycle,
        current_period_start, current_period_end, created_at)
      VALUES (u2, p_team, 'ACTIVE', 'YEARLY',
        now() - interval '200 days', now() + interval '165 days', now() - interval '200 days')
      RETURNING id INTO sub_id;
    INSERT INTO orders (user_id, plan_id, subscription_id, amount, currency,
        billing_cycle, status, payment_method, created_at)
      VALUES (u2, p_team, sub_id, 7990, 'INR', 'YEARLY', 'PAID', 'UPI',
              now() - interval '40 days')
      RETURNING id INTO order_id;
    INSERT INTO invoices (order_id, user_id, number, amount, currency, status,
        issued_at, paid_at, created_at)
      VALUES (order_id, u2, 'INV-2026-0003', 7990, 'INR', 'PAID',
        now() - interval '40 days', now() - interval '40 days', now() - interval '40 days');
    RAISE NOTICE 'demo-seed: c2 Priya team ACTIVE inserted';
  END IF;

  -- ============ c3 Rohan — Starter MONTHLY TRIALING (5-day first trial) =======
  SELECT count(*) INTO n FROM subscriptions s WHERE s.user_id = u3 AND s.plan_id = p_start;
  IF n = 0 THEN
    INSERT INTO subscriptions (user_id, plan_id, status, billing_cycle,
        current_period_start, trial_ends_at, created_at)
      VALUES (u3, p_start, 'TRIALING', 'MONTHLY',
        now() - interval '1 day', now() + interval '4 days', now() - interval '1 day')
      RETURNING id INTO sub_id;
    INSERT INTO orders (user_id, plan_id, subscription_id, amount, currency,
        billing_cycle, status, payment_method, created_at)
      VALUES (u3, p_start, sub_id, 99, 'INR', 'MONTHLY', 'PENDING', 'CARD',
              now() - interval '1 day');
    RAISE NOTICE 'demo-seed: c3 Rohan starter TRIALING inserted';
  END IF;

  -- ============ c4 Ananya — Starter MONTHLY PAST_DUE (missed renewal) =========
  SELECT count(*) INTO n FROM subscriptions s WHERE s.user_id = u4 AND s.plan_id = p_start;
  IF n = 0 THEN
    INSERT INTO subscriptions (user_id, plan_id, status, billing_cycle,
        current_period_start, current_period_end, created_at)
      VALUES (u4, p_start, 'PAST_DUE', 'MONTHLY',
        now() - interval '33 days', now() - interval '3 days', now() - interval '60 days')
      RETURNING id INTO sub_id;
    INSERT INTO orders (user_id, plan_id, subscription_id, amount, currency,
        billing_cycle, status, payment_method, created_at)
      VALUES (u4, p_start, sub_id, 99, 'INR', 'MONTHLY', 'PAID', 'CARD',
              now() - interval '33 days');
    RAISE NOTICE 'demo-seed: c4 Ananya starter PAST_DUE inserted';
  END IF;

  -- ============ c5 Vikram — Pro MONTHLY SUSPENDED (refunded) ==================
  SELECT count(*) INTO n FROM subscriptions s WHERE s.user_id = u5 AND s.plan_id = p_pro;
  IF n = 0 THEN
    INSERT INTO subscriptions (user_id, plan_id, status, billing_cycle,
        current_period_start, current_period_end, cancel_at_period_end,
        cancelled_at, created_at)
      VALUES (u5, p_pro, 'SUSPENDED', 'MONTHLY',
        now() - interval '20 days', now() - interval '5 days', false,
        now() - interval '5 days', now() - interval '75 days')
      RETURNING id INTO sub_id;
    INSERT INTO orders (user_id, plan_id, subscription_id, amount, currency,
        billing_cycle, status, payment_method, created_at)
      VALUES (u5, p_pro, sub_id, 299, 'INR', 'MONTHLY', 'PAID', 'UPI',
              now() - interval '20 days')
      RETURNING id INTO order_id;
    INSERT INTO invoices (order_id, user_id, number, amount, currency, status,
        issued_at, paid_at, created_at)
      VALUES (order_id, u5, 'INV-2026-0004', 299, 'INR', 'VOID',
        now() - interval '20 days', NULL, now() - interval '20 days');
    INSERT INTO orders (user_id, plan_id, subscription_id, amount, currency,
        billing_cycle, status, payment_method, created_at)
      VALUES (u5, p_pro, sub_id, 299, 'INR', 'MONTHLY', 'REFUNDED', 'UPI',
              now() - interval '20 days');
    RAISE NOTICE 'demo-seed: c5 Vikram pro SUSPENDED inserted';
  END IF;

  -- ============ c6 Neha — Enterprise CUSTOM CANCELLED (churn example) =========
  SELECT count(*) INTO n FROM subscriptions s WHERE s.user_id = u6 AND s.plan_id = p_ent;
  IF n = 0 THEN
    INSERT INTO subscriptions (user_id, plan_id, status, billing_cycle,
        current_period_start, current_period_end, cancelled_at, created_at)
      VALUES (u6, p_ent, 'CANCELLED', 'CUSTOM',
        now() - interval '200 days', now() - interval '18 days',
        now() - interval '18 days', now() - interval '220 days')
      RETURNING id INTO sub_id;
    INSERT INTO orders (user_id, plan_id, subscription_id, amount, currency,
        billing_cycle, status, payment_method, created_at)
      VALUES (u6, p_ent, sub_id, 25000, 'INR', 'CUSTOM', 'PAID', 'INVOICE',
              now() - interval '80 days');
    RAISE NOTICE 'demo-seed: c6 Neha enterprise CANCELLED inserted';
  END IF;

  -- ============ c7 Meera — Starter MONTHLY, ALREADY EXPIRED (ended 10d ago) ===
  SELECT count(*) INTO n FROM subscriptions s WHERE s.user_id = u7 AND s.plan_id = p_start;
  IF n = 0 THEN
    INSERT INTO subscriptions (user_id, plan_id, status, billing_cycle,
        current_period_start, current_period_end, created_at)
      VALUES (u7, p_start, 'EXPIRED', 'MONTHLY',
        now() - interval '40 days', now() - interval '10 days', now() - interval '60 days')
      RETURNING id INTO sub_id;
    INSERT INTO orders (user_id, plan_id, subscription_id, amount, currency,
        billing_cycle, status, payment_method, created_at)
      VALUES (u7, p_start, sub_id, 99, 'INR', 'MONTHLY', 'PAID', 'CARD',
              now() - interval '40 days');
    RAISE NOTICE 'demo-seed: c7 Meera starter EXPIRED inserted';
  END IF;

  -- ============ c8 Kabir — Pro MONTHLY ACTIVE, EXPIRES TODAY ==================
  SELECT count(*) INTO n FROM subscriptions s WHERE s.user_id = u8 AND s.plan_id = p_pro;
  IF n = 0 THEN
    INSERT INTO subscriptions (user_id, plan_id, status, billing_cycle,
        current_period_start, current_period_end, created_at)
      VALUES (u8, p_pro, 'ACTIVE', 'MONTHLY',
        now() - interval '29 days',
        date_trunc('day', now()) + interval '1 day' - interval '1 minute',
        now() - interval '30 days')
      RETURNING id INTO sub_id;
    INSERT INTO orders (user_id, plan_id, subscription_id, amount, currency,
        billing_cycle, status, payment_method, created_at)
      VALUES (u8, p_pro, sub_id, 299, 'INR', 'MONTHLY', 'PAID', 'RAZORPAY',
              now() - interval '29 days');
    RAISE NOTICE 'demo-seed: c8 Kabir pro ACTIVE (expires today) inserted';
  END IF;

  -- ============ c9 Zoya — Team MONTHLY ACTIVE, EXPIRES TOMORROW ================
  SELECT count(*) INTO n FROM subscriptions s WHERE s.user_id = u9 AND s.plan_id = p_team;
  IF n = 0 THEN
    INSERT INTO subscriptions (user_id, plan_id, status, billing_cycle,
        current_period_start, current_period_end, created_at)
      VALUES (u9, p_team, 'ACTIVE', 'MONTHLY',
        now() - interval '29 days', now() + interval '1 day', now() - interval '30 days')
      RETURNING id INTO sub_id;
    INSERT INTO orders (user_id, plan_id, subscription_id, amount, currency,
        billing_cycle, status, payment_method, created_at)
      VALUES (u9, p_team, sub_id, 799, 'INR', 'MONTHLY', 'PAID', 'UPI',
              now() - interval '29 days');
    RAISE NOTICE 'demo-seed: c9 Zoya team ACTIVE (expires tomorrow) inserted';
  END IF;

END $$;

-- ---- Promo codes (idempotent by unique code) --------------------------------
INSERT INTO promo_codes (code, description, discount_type, discount_value,
    plan_id, max_uses, used_count, active, starts_at, expires_at)
SELECT c.code, c.description, c.discount_type, c.discount_value,
       p.id, c.max_uses, c.used_count, c.active, c.starts_at, c.expires_at
FROM (VALUES
  ('LAUNCH20', '20% off any monthly plan at launch', 'PERCENT', 20, NULL::text,
    500, 12, true, NULL::timestamptz, now() + interval '60 days'),
  ('TEAM100', 'Flat INR 100 off the Team plan', 'FIXED', 100, 'team',
    100, 3, true, NULL, now() + interval '90 days'),
  ('WELCOME10', 'New sign-up 10% off first month', 'PERCENT', 10, NULL,
    NULL::int, 41, true, NULL, NULL),
  ('FLASH25', 'Expired flash sale', 'PERCENT', 25, 'pro',
    50, 9, false, now() - interval '90 days', now() - interval '10 days')
) AS c(code, description, discount_type, discount_value, plan_key, max_uses,
       used_count, active, starts_at, expires_at)
LEFT JOIN plans p ON p.key = c.plan_key
ON CONFLICT (code) DO NOTHING;

-- ---- A few audit rows so the B5 page is not empty (actor = Boss if present) --
DO $$
DECLARE
  u_boss uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM audit_log LIMIT 1) THEN
    RAISE NOTICE 'demo-seed: audit_log present, skipping';
    RETURN;
  END IF;
  SELECT id INTO u_boss FROM users WHERE email = 'boss1785867669@test.io';
  IF u_boss IS NULL THEN
    SELECT id INTO u_boss FROM users WHERE email = 'admin@test.io';
  END IF;
  IF u_boss IS NOT NULL THEN
    INSERT INTO audit_log (actor_user_id, actor_name, actor_role, action,
        target_type, target_ref, before, after, ip_address, created_at)
    VALUES
      (u_boss, 'Boss', 'ADMIN', 'plans.update', 'plan', 'pro',
       '{"price_monthly":"249.00"}', '{"price_monthly":"299.00"}', '127.0.0.1',
       now() - interval '12 days'),
      (u_boss, 'Boss', 'ADMIN', 'subscriptions.activate', 'subscription',
       'pro', '{"status":"TRIALING"}', '{"status":"ACTIVE"}', '127.0.0.1',
       now() - interval '6 days'),
      (u_boss, 'Boss', 'ADMIN', 'promo_codes.create', 'promo_code', 'LAUNCH20',
       NULL, '{"discount_type":"PERCENT","discount_value":"20"}', '127.0.0.1',
       now() - interval '2 days');
    RAISE NOTICE 'demo-seed: audit_log seeded';
  END IF;
END $$;
