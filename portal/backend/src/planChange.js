'use strict';

// ---------------------------------------------------------------------------
// Portal A — plan-change rules (single source of truth).
//
// Two product rules, enforced identically by the checkout route, the paid-order
// finalizer and the simulated confirm route:
//
//   1. A customer who already holds an active plan CANNOT recharge a plan that
//      is the same price or cheaper to switch immediately. They must schedule a
//      cancellation first; the lower-priced plan is then queued (SCHEDULED) and
//      starts only when the current paid period ends. No refund is issued.
//   2. A customer upgrading to a strictly higher-priced plan switches
//      immediately and is charged only the prorated difference for the paid
//      days that remain in the current period. The first-recharge bonus
//      (plans.trial_days extra validity) is excluded from that calculation.
//
// Direction is decided from the FULL catalog price of the requested plan for
// the requested cycle — never from the (possibly prorated) amount on an order,
// so a small prorated upgrade can never be mistaken for a downgrade.
// ---------------------------------------------------------------------------

const { query } = require('./shared');

const CURRENT_STATUSES = ['ACTIVE', 'TRIALING'];

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Catalog price of a plan for a billing cycle, falling back to the other cycle
// (×12 or ÷12) so plans that publish a single cycle can still be compared.
function priceForCycle(plan, cycle) {
  const monthly = num(plan && plan.price_monthly);
  const yearly = num(plan && plan.price_yearly);
  if (cycle === 'YEARLY') {
    if (yearly !== null) return yearly;
    if (monthly !== null) return monthly * 12;
    return null;
  }
  if (monthly !== null) return monthly;
  if (yearly !== null) return yearly / 12;
  return null;
}

function formatDate(value) {
  if (!value) return 'the end of your current period';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'the end of your current period';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// The user's current plan-bearing subscription: an ACTIVE/TRIALING row when one
// exists, otherwise the newest SCHEDULED (queued) row. `forUpdate` locks it so
// concurrent checkouts cannot both classify against a stale snapshot.
async function loadCurrentSubscription(client, userId, options = {}) {
  const lock = options.forUpdate ? ' FOR UPDATE OF s' : '';
  const { rows } = await client.query(
    `SELECT s.id, s.user_id, s.plan_id, s.status, s.billing_cycle,
            s.current_period_start, s.current_period_end,
            s.cancel_at_period_end, s.created_at,
            p.key AS plan_key, p.name AS plan_name,
            p.price_monthly, p.price_yearly, p.billing_cycles
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
      WHERE s.user_id = $1
        AND s.status IN ('ACTIVE', 'TRIALING', 'SCHEDULED')
      ORDER BY (s.status IN ('ACTIVE', 'TRIALING')) DESC, s.created_at DESC
      LIMIT 1${lock}`,
    [userId]
  );
  return rows[0] || null;
}

// Paid-days fraction of the current period, with the first-recharge bonus
// validity stripped out. base_end is what the period end would be without the
// bonus (start + 1 cycle); remaining/base is the fraction the customer still
// has paid for.
async function computeProration(client, current, cycle) {
  const { rows } = await client.query(
    `SELECT
        EXTRACT(EPOCH FROM (base_end - now()))::double precision AS remaining_seconds,
        EXTRACT(EPOCH FROM (base_end - st))::double precision   AS base_seconds,
        base_end
       FROM (
         SELECT current_period_start AS st,
                CASE WHEN $2 = 'YEARLY'
                     THEN current_period_start + interval '1 year'
                     ELSE current_period_start + interval '1 month'
                END AS base_end
           FROM subscriptions WHERE id = $1
       ) q`,
    [current.id, cycle]
  );
  const row = rows[0] || {};
  const baseSeconds = num(row.base_seconds);
  const remainingSeconds = num(row.remaining_seconds);
  if (!baseSeconds || baseSeconds <= 0 || remainingSeconds === null) {
    return { fraction: 1, baseEnd: null, remainingDays: null, totalDays: null };
  }
  const fraction = Math.max(0, Math.min(1, remainingSeconds / baseSeconds));
  return {
    fraction,
    baseEnd: row.base_end || null,
    remainingDays: Math.ceil(remainingSeconds / 86400),
    totalDays: Math.round(baseSeconds / 86400),
  };
}

/**
 * Classify a requested plan against the customer's current plan.
 *
 * @returns {Promise<
 *   | { kind: 'NONE' }
 *   | { kind: 'UPGRADE', amountDue, periodEnd, proration, current, ... }
 *   | { kind: 'DOWNGRADE', startsAt, amountDue, current, ... }
 *   | { kind: 'BLOCKED', code, message, current }
 * >}
 */
async function classifyPlanChange(client, { userId, plan, cycle, newPrice }) {
  const fullNewPrice =
    newPrice === undefined || newPrice === null ? priceForCycle(plan, cycle) : num(newPrice);

  const current = await loadCurrentSubscription(client, userId, { forUpdate: true });
  if (!current) return { kind: 'NONE', current: null, newPrice: fullNewPrice };

  // A queued plan that has not started yet blocks further changes until the
  // customer cancels it.
  if (current.status === 'SCHEDULED') {
    return {
      kind: 'BLOCKED',
      code: 'change_already_scheduled',
      message: `You already have a change to your ${current.plan_name} plan scheduled. Cancel it before choosing a different plan.`,
      current,
      newPrice: fullNewPrice,
    };
  }

  const currentPrice = priceForCycle(current, cycle);
  if (fullNewPrice === null || currentPrice === null) {
    return { kind: 'NONE', current, newPrice: fullNewPrice };
  }

  const proration = await computeProration(client, current, cycle);

  if (fullNewPrice > currentPrice) {
    if (!proration.baseEnd || proration.fraction <= 0) {
      // The paid period has already lapsed — a fresh full purchase, not a
      // prorated upgrade.
      return { kind: 'NONE', current, newPrice: fullNewPrice };
    }
    const amountDue = round2((fullNewPrice - currentPrice) * proration.fraction);
    return {
      kind: 'UPGRADE',
      current,
      newPrice: fullNewPrice,
      currentPrice,
      amountDue,
      proration,
      periodEnd: proration.baseEnd,
    };
  }

  // Same or lower price — a downgrade/lateral move. The customer must have
  // scheduled the cancellation first; the new plan then starts at period end.
  if (!current.cancel_at_period_end) {
    return {
      kind: 'BLOCKED',
      code: 'cancel_required',
      message: `You already have an active ${current.plan_name} subscription. Cancel it first — your ${plan ? plan.name : 'new'} plan will start only after the current period ends on ${formatDate(current.current_period_end)}. No refund is issued for the unused period.`,
      current,
      newPrice: fullNewPrice,
    };
  }

  return {
    kind: 'DOWNGRADE',
    current,
    newPrice: fullNewPrice,
    startsAt: current.current_period_end,
    amountDue: fullNewPrice,
  };
}

// A payment has already been taken by the time a paid order is finalized, so a
// BLOCKED classification must not lose the customer's money: queue the plan
// instead (start at period end when one is still running, else immediately).
function decisionForPaidOrder(decision) {
  if (decision.kind === 'UPGRADE' || decision.kind === 'NONE') return decision;
  const current = decision.current || null;
  return {
    kind: 'DOWNGRADE',
    current,
    startsAt:
      current && current.status !== 'SCHEDULED' && current.current_period_end
        ? current.current_period_end
        : null,
  };
}

// Insert an ACTIVE subscription covering `periodEnd` (or a full fresh cycle
// when null); retire any queued plan and supersede other active plans.
async function activateSubscription(client, { userId, planId, cycle, bonusDays = 0, periodEnd = null }) {
  const { rows } = await client.query(
    `INSERT INTO subscriptions
       (user_id, plan_id, status, billing_cycle, current_period_start,
        current_period_end)
     VALUES ($1, $2, 'ACTIVE', $3, now(),
             COALESCE($5::timestamptz,
               CASE WHEN $3 = 'YEARLY'
                    THEN now() + interval '1 year' + make_interval(days => $4)
                    ELSE now() + interval '1 month' + make_interval(days => $4)
               END))
     RETURNING id`,
    [userId, planId, cycle, bonusDays, periodEnd || null]
  );
  const id = rows[0].id;
  await client.query(
    `UPDATE subscriptions
        SET status = 'CANCELLED', cancelled_at = now(), updated_at = now()
      WHERE user_id = $1 AND status = 'SCHEDULED' AND id <> $2`,
    [userId, id]
  );
  await client.query('SELECT app.supersede_subscriptions($1)', [id]);
  return id;
}

// Create the subscription that a finalized plan change calls for. DOWNGRADE
// queues a SCHEDULED row (start = period end) unless there is nothing running;
// everything else activates immediately. Returns the new subscription id.
async function createSubscriptionForChange(client, { userId, planId, cycle, decision, bonusDays = 0 }) {
  if (decision.kind === 'DOWNGRADE') {
    const startsAt = decision.startsAt || null;
    if (!startsAt) {
      return activateSubscription(client, { userId, planId, cycle, bonusDays, periodEnd: null });
    }
    const { rows } = await client.query(
      `INSERT INTO subscriptions
         (user_id, plan_id, status, billing_cycle, current_period_start,
          current_period_end)
       VALUES ($1, $2, 'SCHEDULED', $3, $4::timestamptz,
               CASE WHEN $3 = 'YEARLY'
                    THEN $4::timestamptz + interval '1 year' + make_interval(days => $5)
                    ELSE $4::timestamptz + interval '1 month' + make_interval(days => $5)
               END)
       RETURNING id`,
      [userId, planId, cycle, startsAt, bonusDays]
    );
    await client.query(
      `UPDATE subscriptions
          SET status = 'CANCELLED', cancelled_at = now(), updated_at = now()
        WHERE user_id = $1 AND status = 'SCHEDULED' AND id <> $2`,
      [userId, rows[0].id]
    );
    return rows[0].id;
  }

  return activateSubscription(client, {
    userId,
    planId,
    cycle,
    bonusDays,
    periodEnd: decision.kind === 'UPGRADE' ? decision.periodEnd : null,
  });
}

// Lazy queue promotion (migration 054) — idempotent, best effort.
async function promoteScheduledSubscriptions(userId) {
  if (!userId) return 0;
  try {
    const { rows } = await query(
      'SELECT app.promote_scheduled_subscriptions($1) AS promoted',
      [userId]
    );
    return rows[0] ? Number(rows[0].promoted) : 0;
  } catch (err) {
    console.error('[plan-change] promotion failed:', err && err.message);
    return 0;
  }
}

module.exports = {
  CURRENT_STATUSES,
  priceForCycle,
  formatDate,
  loadCurrentSubscription,
  classifyPlanChange,
  decisionForPaidOrder,
  createSubscriptionForChange,
  promoteScheduledSubscriptions,
};
