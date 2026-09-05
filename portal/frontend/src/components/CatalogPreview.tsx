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

function formatMoney(value: string | null): string | null {
  if (value === null) return null;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value));
}

export default function CatalogPreview() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/public/plans')
      .then((res) => {
        if (!res.ok) throw new Error(`Catalog request failed (${res.status})`);
        return res.json();
      })
      .then((data) => setPlans(data.plans))
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div className="plan-error">
        Could not load plans: {error}. Is the portal backend running on :3102?
      </div>
    );
  }

  if (!plans) {
    return <div className="lede">Loading plans…</div>;
  }

  return (
    <>
      <div className="plans-grid">
        {plans.map((plan) => {
          const monthly = formatMoney(plan.price_monthly);
          const yearly = formatMoney(plan.price_yearly);
          return (
            <div className="plan-card" key={plan.id} data-plan-key={plan.key}>
              <div className="plan-name">{plan.name}</div>
              <div className="plan-tagline">{plan.tagline}</div>
              <div className="plan-price">
                {monthly === null ? (
                  <>Contact sales</>
                ) : (
                  <>
                    {monthly}
                    <small> /month</small>
                  </>
                )}
              </div>
              <ul className="plan-features">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              {plan.billing_cycles.includes('YEARLY') && yearly !== null && (
                <div className="portal-sub">or {yearly}/year</div>
              )}
              {plan.trial_days > 0 && (
                <div className="portal-sub">{plan.trial_days}-day trial</div>
              )}
            </div>
          );
        })}
      </div>
      <p className="price-note">
        Prices in INR. Placeholder catalog from migration 013 — checkout (Portal
        A) and management UI (Portal B) ship in later milestones.
      </p>
    </>
  );
}
