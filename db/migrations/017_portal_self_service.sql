-- ============================================================================
-- API Hub — 017_portal_self_service.sql
-- Portal A (A5) subscriber self-service support.
--
-- Customer-created accounts are global role EDITOR, which is deliberately NOT
-- a portal role (B1), so the existing `subscriptions_update` RLS policy (portal
-- ADMIN/MANAGER/SUPPORT/VIEWER only) can never let a subscriber flip
-- cancel_at_period_end on their own subscription. Instead of widening that
-- policy (which would let a customer rewrite plan_id/status/amount fields),
-- self-service mutations run through SECURITY DEFINER functions that:
--   1. pin the acting identity to app.current_user_id() (set per-request by
--      the API layer — same trust anchor every RLS policy uses), and
--   2. validate ownership + allowed transitions before touching the row.
--
-- The A4 single-plan-per-account model is also formalised here: confirming a
-- paid order for a DIFFERENT plan (a self-service plan change via the normal
-- checkout) supersedes — cancels immediately — any other ACTIVE/TRIALING
-- subscription the customer holds, so there is always at most one current
-- plan. All three functions write audit_log rows (action names
-- subscriptions.self_cancel / subscriptions.self_reactivate /
-- subscriptions.self_superseded) so Portal B ops can see customer-initiated
-- changes.
-- ============================================================================

-- ------------------------------------------------- self-service cancel
-- Customer cancels at the end of the paid period (Stripe-style): the row
-- keeps ACTIVE/TRIALING until current_period_end; cancel_at_period_end=true
-- and cancelled_at=now() record the scheduled end.
CREATE OR REPLACE FUNCTION app.self_service_cancel_subscription(_sub_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  _uid  uuid := app.current_user_id();
  _row  subscriptions%ROWTYPE;
  _user users%ROWTYPE;
  _plan_key text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'no session identity' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _row FROM subscriptions WHERE id = _sub_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'subscription_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF _row.user_id <> _uid THEN
    RAISE EXCEPTION 'not_your_subscription' USING ERRCODE = '42501';
  END IF;
  IF _row.status NOT IN ('ACTIVE', 'TRIALING') THEN
    RAISE EXCEPTION 'subscription_not_cancellable'
      USING ERRCODE = 'P0001';
  END IF;
  IF _row.cancel_at_period_end THEN
    RAISE EXCEPTION 'already_scheduled_for_cancellation'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE subscriptions
     SET cancel_at_period_end = true,
         cancelled_at = now(),
         updated_at = now()
   WHERE id = _sub_id;

  SELECT p.key INTO _plan_key FROM plans p WHERE p.id = _row.plan_id;
  SELECT * INTO _user FROM users WHERE id = _uid;
  INSERT INTO audit_log
    (actor_user_id, actor_name, actor_role, action,
     target_type, target_id, target_ref, before, after)
  VALUES
    (_uid, _user.name, _user.role::text, 'subscriptions.self_cancel',
     'subscription', _sub_id, _plan_key,
     jsonb_build_object('status', _row.status,
                        'cancel_at_period_end', _row.cancel_at_period_end),
     jsonb_build_object('status', _row.status,
                        'cancel_at_period_end', true));

  RETURN _sub_id;
END;
$$;

-- ------------------------------------------------- self-service reactivate
-- Undo a scheduled cancellation (cancel_at_period_end=true -> false).
CREATE OR REPLACE FUNCTION app.self_service_reactivate_subscription(_sub_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  _uid  uuid := app.current_user_id();
  _row  subscriptions%ROWTYPE;
  _user users%ROWTYPE;
  _plan_key text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'no session identity' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _row FROM subscriptions WHERE id = _sub_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'subscription_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF _row.user_id <> _uid THEN
    RAISE EXCEPTION 'not_your_subscription' USING ERRCODE = '42501';
  END IF;
  IF NOT _row.cancel_at_period_end THEN
    RAISE EXCEPTION 'subscription_not_scheduled_for_cancellation'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE subscriptions
     SET cancel_at_period_end = false,
         cancelled_at = NULL,
         updated_at = now()
   WHERE id = _sub_id;

  SELECT p.key INTO _plan_key FROM plans p WHERE p.id = _row.plan_id;
  SELECT * INTO _user FROM users WHERE id = _uid;
  INSERT INTO audit_log
    (actor_user_id, actor_name, actor_role, action,
     target_type, target_id, target_ref, before, after)
  VALUES
    (_uid, _user.name, _user.role::text, 'subscriptions.self_reactivate',
     'subscription', _sub_id, _plan_key,
     jsonb_build_object('cancel_at_period_end', true),
     jsonb_build_object('cancel_at_period_end', false));

  RETURN _sub_id;
END;
$$;

-- ------------------------------------------------- self-service supersede
-- A plan change (new order confirmed) moves the customer to the new plan:
-- every OTHER ACTIVE/TRIALING subscription of the same customer is cancelled
-- immediately. _except_sub_id is the freshly-activated replacement.
CREATE OR REPLACE FUNCTION app.supersede_subscriptions(_except_sub_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  _uid  uuid := app.current_user_id();
  _old  subscriptions%ROWTYPE;
  _user users%ROWTYPE;
  _plan_key text;
  _count integer := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'no session identity' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _user FROM users WHERE id = _uid;

  FOR _old IN
    SELECT * FROM subscriptions
     WHERE user_id = _uid
       AND id IS DISTINCT FROM _except_sub_id
       AND status IN ('ACTIVE', 'TRIALING')
  LOOP
    UPDATE subscriptions
       SET status = 'CANCELLED', cancel_at_period_end = false,
           cancelled_at = now(), updated_at = now()
     WHERE id = _old.id;

    SELECT p.key INTO _plan_key FROM plans p WHERE p.id = _old.plan_id;
    INSERT INTO audit_log
      (actor_user_id, actor_name, actor_role, action,
       target_type, target_id, target_ref, before, after)
    VALUES
      (_uid, _user.name, _user.role::text, 'subscriptions.self_superseded',
       'subscription', _old.id, _plan_key,
       jsonb_build_object('status', _old.status,
                          'cancel_at_period_end', _old.cancel_at_period_end),
       jsonb_build_object('status', 'CANCELLED',
                          'reason', 'plan changed via checkout'));
    _count := _count + 1;
  END LOOP;

  RETURN _count;
END;
$$;

-- db/tests run as app_user (SET ROLE) to exercise the policies; let them call
-- the self-service functions. SECURITY DEFINER + search_path pinning keeps the
-- surface exactly these three entry points.
GRANT EXECUTE ON FUNCTION app.self_service_cancel_subscription(uuid)    TO app_user;
GRANT EXECUTE ON FUNCTION app.self_service_reactivate_subscription(uuid) TO app_user;
GRANT EXECUTE ON FUNCTION app.supersede_subscriptions(uuid)             TO app_user;
