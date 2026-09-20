-- ============================================================================
-- API Hub — 054_plan_change_rules.sql
-- Plan-change rules for subscriptions (lower-plan recharge + prorated upgrades).
--
-- Product rules this migration makes representable:
--   1. A customer WITH an active plan may not "recharge" a lower-priced plan to
--      immediately switch (and possibly re-claim first-recharge perks). They
--      must cancel first; the lower plan then starts only when the current paid
--      period ends. No refund is issued.
--   2. Upgrading to a higher-priced plan mid-cycle is allowed immediately and
--      is charged only the prorated difference for the remaining paid days
--      (the first-recharge bonus validity is excluded from that calculation).
--
-- To support (1) the subscriptions.status vocabulary gains a non-terminal
-- SCHEDULED state: a queued plan whose current_period_start is in the future.
-- `app.promote_scheduled_subscriptions()` activates queued plans (and retires
-- the period-expired plan) when their start date arrives; it is called lazily
-- from the portal (account overview + checkout) and entitlements treat a
-- scheduled plan that has started as covering even before promotion runs.
--
-- Additive only; no existing rows are modified.
-- ============================================================================

-- ---------------------------------------------------- SCHEDULED status
-- Replace the status CHECK with one that also allows SCHEDULED. The original
-- constraint was created inline (auto-named), so drop whichever CHECK on the
-- column exists rather than guessing a name.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'subscriptions'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE subscriptions DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED',
                    'CANCELLED', 'EXPIRED', 'SCHEDULED'));

COMMENT ON COLUMN subscriptions.status IS
  'TRIALING/ACTIVE = current; SCHEDULED = queued plan that starts at current_period_start; CANCELLED/EXPIRED = terminal.';

CREATE INDEX IF NOT EXISTS subscriptions_scheduled_idx
  ON subscriptions (user_id, current_period_start)
  WHERE status = 'SCHEDULED';

-- ------------------------------------------- lazy promotion of queue
-- Cancel ACTIVE/TRIALING plans whose scheduled cancellation has elapsed and
-- activate SCHEDULED plans whose start date has arrived. Idempotent; safe to
-- call on any read path. Returns the number of plans promoted.
CREATE OR REPLACE FUNCTION app.promote_scheduled_subscriptions(_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  _promoted integer := 0;
  _sched    subscriptions%ROWTYPE;
  _other    subscriptions%ROWTYPE;
  _user     users%ROWTYPE;
  _plan_key text;
BEGIN
  IF _user_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT * INTO _user FROM users WHERE id = _user_id;

  -- 1. Retire active plans whose scheduled cancellation has elapsed.
  FOR _other IN
    SELECT * FROM subscriptions
     WHERE user_id = _user_id
       AND status IN ('ACTIVE', 'TRIALING')
       AND cancel_at_period_end = true
       AND current_period_end IS NOT NULL
       AND current_period_end <= now()
  LOOP
    UPDATE subscriptions
       SET status = 'CANCELLED', cancel_at_period_end = false,
           cancelled_at = COALESCE(cancelled_at, now()), updated_at = now()
     WHERE id = _other.id;

    SELECT p.key INTO _plan_key FROM plans p WHERE p.id = _other.plan_id;
    INSERT INTO audit_log
      (actor_user_id, actor_name, actor_role, action,
       target_type, target_id, target_ref, before, after)
    VALUES
      (_user_id, _user.name, _user.role::text,
       'subscriptions.period_ended',
       'subscription', _other.id, _plan_key,
       jsonb_build_object('status', _other.status,
                          'cancel_at_period_end', _other.cancel_at_period_end),
       jsonb_build_object('status', 'CANCELLED', 'reason', 'paid period ended'));
  END LOOP;

  -- 2. Promote every queued plan whose start date has arrived, superseding any
  --    plan still active (one current plan always holds).
  FOR _sched IN
    SELECT * FROM subscriptions
     WHERE user_id = _user_id
       AND status = 'SCHEDULED'
       AND current_period_start IS NOT NULL
       AND current_period_start <= now()
     ORDER BY current_period_start
  LOOP
    FOR _other IN
      SELECT * FROM subscriptions
       WHERE user_id = _user_id
         AND id IS DISTINCT FROM _sched.id
         AND status IN ('ACTIVE', 'TRIALING')
    LOOP
      UPDATE subscriptions
         SET status = 'CANCELLED', cancel_at_period_end = false,
             cancelled_at = now(), updated_at = now()
       WHERE id = _other.id;

      SELECT p.key INTO _plan_key FROM plans p WHERE p.id = _other.plan_id;
      INSERT INTO audit_log
        (actor_user_id, actor_name, actor_role, action,
         target_type, target_id, target_ref, before, after)
      VALUES
        (_user_id, _user.name, _user.role::text,
         'subscriptions.scheduled_superseded',
         'subscription', _other.id, _plan_key,
         jsonb_build_object('status', _other.status),
         jsonb_build_object('status', 'CANCELLED',
                            'reason', 'scheduled plan started'));
    END LOOP;

    UPDATE subscriptions
       SET status = 'ACTIVE', cancel_at_period_end = false, updated_at = now()
     WHERE id = _sched.id;
    _promoted := _promoted + 1;

    SELECT p.key INTO _plan_key FROM plans p WHERE p.id = _sched.plan_id;
    INSERT INTO audit_log
      (actor_user_id, actor_name, actor_role, action,
       target_type, target_id, target_ref, before, after)
    VALUES
      (_user_id, _user.name, _user.role::text,
       'subscriptions.scheduled_activated',
       'subscription', _sched.id, _plan_key,
       jsonb_build_object('status', 'SCHEDULED',
                          'current_period_start', _sched.current_period_start),
       jsonb_build_object('status', 'ACTIVE'));
  END LOOP;

  RETURN _promoted;
END;
$$;

-- ----------------------------------- self-service cancel (SCHEDULED aware)
-- ACTIVE/TRIALING: schedule cancellation at period end (unchanged behaviour).
-- SCHEDULED: cancel the queued plan outright (the customer changed their mind
-- before it ever started); the current plan keeps running.
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

  IF _row.status = 'SCHEDULED' THEN
    UPDATE subscriptions
       SET status = 'CANCELLED', cancelled_at = now(), updated_at = now()
     WHERE id = _sub_id;

    SELECT p.key INTO _plan_key FROM plans p WHERE p.id = _row.plan_id;
    SELECT * INTO _user FROM users WHERE id = _uid;
    INSERT INTO audit_log
      (actor_user_id, actor_name, actor_role, action,
       target_type, target_id, target_ref, before, after)
    VALUES
      (_uid, _user.name, _user.role::text, 'subscriptions.self_cancel',
       'subscription', _sub_id, _plan_key,
       jsonb_build_object('status', 'SCHEDULED'),
       jsonb_build_object('status', 'CANCELLED',
                          'reason', 'queued plan cancelled'));
    RETURN _sub_id;
  END IF;

  IF _row.status NOT IN ('ACTIVE', 'TRIALING') THEN
    RAISE EXCEPTION 'subscription_not_cancellable' USING ERRCODE = 'P0001';
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

-- --------------------------------- self-service reactivate (drops queue)
-- Undoing a scheduled cancellation also discards any queued lower plan, so the
-- current plan simply continues.
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

  -- Discard any queued plan the customer had lined up for this period end.
  UPDATE subscriptions
     SET status = 'CANCELLED', cancelled_at = now(), updated_at = now()
   WHERE user_id = _uid AND status = 'SCHEDULED';

  SELECT p.key INTO _plan_key FROM plans p WHERE p.id = _row.plan_id;
  SELECT * INTO _user FROM users WHERE id = _uid;
  INSERT INTO audit_log
    (actor_user_id, actor_name, actor_role, action,
     target_type, target_id, target_ref, before, after)
  VALUES
    (_uid, _user.name, _user.role::text, 'subscriptions.self_reactivate',
     'subscription', _sub_id, _plan_key,
     jsonb_build_object('cancel_at_period_end', true),
     jsonb_build_object('cancel_at_period_end', false,
                        'queued_plan_discarded', true));

  RETURN _sub_id;
END;
$$;

GRANT EXECUTE ON FUNCTION app.promote_scheduled_subscriptions(uuid) TO app_user;
