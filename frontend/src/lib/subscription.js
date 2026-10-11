'use strict';

// Pure helpers describing a subscription snapshot for the top-bar chip and the
// user-menu plan row. Kept CommonJS so the node --test suite can require() them.

const STATUS_TONES = {
  ACTIVE: 'ok',
  TRIALING: 'info',
  PAST_DUE: 'warn',
  UNPAID: 'warn',
  INCOMPLETE: 'warn',
  CANCELED: 'muted',
  CANCELLED: 'muted',
};

const URGENT_STATUSES = ['PAST_DUE', 'UNPAID', 'INCOMPLETE'];

function normalizeStatus(status) {
  return String(status || '').toUpperCase();
}

function daysUntil(iso, now = Date.now()) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - now) / 86400000);
}

// Returns { label, tone, title, urgent, status } for the subscription chip.
function subscriptionChip(subscription, { now = Date.now(), renewWindowDays = 7 } = {}) {
  if (!subscription) {
    return {
      label: 'Free',
      tone: 'muted',
      title: 'No active plan — see plans & pricing',
      urgent: false,
      status: 'NONE',
    };
  }
  const status = normalizeStatus(subscription.status);
  const planName = (subscription.plan && (subscription.plan.name || subscription.plan.key)) || 'Plan';
  const tone = STATUS_TONES[status] || 'info';
  const endDays = daysUntil(subscription.current_period_end, now);
  const trialDays = subscription.trial_ends_at ? daysUntil(subscription.trial_ends_at, now) : null;
  const renewingSoon = endDays !== null && endDays >= 0 && endDays <= renewWindowDays;
  const trialSoon =
    status === 'TRIALING' && trialDays !== null && trialDays >= 0 && trialDays <= renewWindowDays;
  const urgent =
    URGENT_STATUSES.includes(status) ||
    Boolean(subscription.cancel_at_period_end) ||
    renewingSoon ||
    trialSoon;

  let title;
  if (URGENT_STATUSES.includes(status)) {
    title = `${planName}: payment issue — update billing`;
  } else if (subscription.cancel_at_period_end) {
    title = `${planName}: ends${endDays === null ? ' soon' : ` in ${endDays} day(s)`} — renew to keep access`;
  } else if (renewingSoon) {
    title = `${planName}: renews in ${endDays} day(s)`;
  } else if (trialSoon) {
    title = `${planName} trial ends in ${trialDays} day(s)`;
  } else {
    title = `${planName} subscription`;
  }

  return { label: planName, tone, title, urgent, status };
}

module.exports = { subscriptionChip, daysUntil, normalizeStatus, STATUS_TONES, URGENT_STATUSES };
