'use client';

import { useEffect, useState } from 'react';

export type Plan = {
  id: string;
  key: string;
  name: string;
  tagline: string | null;
  description: string | null;
  price_monthly: string | null;
  price_yearly: string | null;
  currency: string;
  billing_cycles: string[];
  trial_days: number;
  sort_order: number;
  limits: Record<string, unknown>;
  features: string[];
};

type Cycle = 'MONTHLY' | 'YEARLY';

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

function formatMoney(value: string | null): string | null {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? inr.format(n) : null;
}

function CheckSvg() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="16"
      height="16"
      aria-hidden="true"
      className="check-ic"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 10.5 8.2 15 16 6" />
    </svg>
  );
}

function SkeletonCard() {
  return (
    <div className="plan-card plan-skeleton" aria-hidden="true">
      <div className="sk sk-line sk-lg" />
      <div className="sk sk-line sk-sm" />
      <div className="sk sk-line sk-price" />
      <div className="sk sk-line" />
      <div className="sk sk-line" />
      <div className="sk sk-line" />
      <div className="sk sk-cta" />
    </div>
  );
}

export default function CatalogPreview() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cycle, setCycle] = useState<Cycle>('MONTHLY');
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => {
    setError(null);
    setPlans(null);
    fetch('/api/public/plans')
      .then((res) => {
        if (!res.ok) throw new Error(`Catalog request failed (${res.status})`);
        return res.json();
      })
      .then((data) => setPlans(data.plans))
      .catch((err) => setError(err.message));
  };

  useEffect(load, []);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 4500);
  };

  if (error) {
    return (
      <div className="plan-error" role="alert">
        <strong>Could not load plans.</strong> {error} Is the portal backend
        running on :3102?
        <button type="button" className="btn btn-outline btn-sm" onClick={load}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="pricing">
      <div className="pricing-head">
        <div className="billing-toggle" role="group" aria-label="Billing cycle">
          <button
            type="button"
            className={`billing-option ${cycle === 'MONTHLY' ? 'active' : ''}`}
            aria-pressed={cycle === 'MONTHLY'}
            onClick={() => setCycle('MONTHLY')}
          >
            Monthly
          </button>
          <button
            type="button"
            className={`billing-option ${cycle === 'YEARLY' ? 'active' : ''}`}
            aria-pressed={cycle === 'YEARLY'}
            onClick={() => setCycle('YEARLY')}
          >
            Yearly
            <span className="save-badge">Save ~17%</span>
          </button>
        </div>
      </div>

      {!plans ? (
        <div className="plans-grid" data-testid="plans-loading">
          {[0, 1, 2, 3, 4].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <>
          <div className="plans-grid">
            {plans.map((plan) => {
              const popular = plan.key === 'pro';
              const custom = plan.price_monthly === null && plan.price_yearly === null;
              const monthly = formatMoney(plan.price_monthly);
              const yearly = formatMoney(plan.price_yearly);
              const price = cycle === 'YEARLY' ? yearly ?? monthly : monthly;
              const per = cycle === 'YEARLY' ? 'per year' : 'per month';
              const savePct =
                cycle === 'YEARLY' &&
                plan.price_monthly !== null &&
                plan.price_yearly !== null &&
                Number(plan.price_monthly) > 0
                  ? Math.round(
                      (1 - Number(plan.price_yearly) / (Number(plan.price_monthly) * 12)) * 100
                    )
                  : 0;

              return (
                <div
                  className={`plan-card ${popular ? 'plan-popular' : ''}`}
                  key={plan.id}
                  data-plan-key={plan.key}
                >
                  {popular && <div className="plan-popular-badge">Most popular</div>}
                  <div className="plan-name">{plan.name}</div>
                  <div className="plan-tagline">{plan.tagline}</div>
                  <div className="plan-price">
                    {custom ? (
                      <span className="plan-custom-price">Custom</span>
                    ) : (
                      <>
                        {price}
                        <small> {per}</small>
                      </>
                    )}
                  </div>
                  {!custom && cycle === 'YEARLY' && savePct > 0 && (
                    <div className="plan-save">Save {savePct}% with yearly billing</div>
                  )}
                  {plan.trial_days > 0 && (
                    <div className="plan-trial">
                      +{plan.trial_days} days extra validity on your first recharge
                    </div>
                  )}
                  <ul className="plan-features">
                    {plan.features.map((feature) => (
                      <li key={feature}>
                        <CheckSvg />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className={`plan-cta ${custom ? 'btn-outline' : popular ? '' : 'btn-ghost'}`}
                    data-testid={`choose-${plan.key}`}
                    onClick={() =>
                      showNotice(
                        custom
                          ? 'Contact sales opens with the checkout flow (Portal A, A4).'
                          : `${plan.name} checkout opens with the purchase flow (Portal A, A4).`
                      )
                    }
                  >
                    {custom ? 'Contact sales' : popular ? 'Get started' : `Choose ${plan.name}`}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="price-note">
            Prices in INR, billed {cycle === 'YEARLY' ? 'annually' : 'monthly'}. Placeholder
            catalog from migration 013 — checkout (Portal A) ships in a later milestone.
          </p>
        </>
      )}

      {notice && (
        <div className="plan-notice" role="status" data-testid="purchase-notice">
          {notice}
        </div>
      )}
    </div>
  );
}
