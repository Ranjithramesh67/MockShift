// Portal A (A4) checkout API helpers + shared types. Consumers call relative
// /api/... paths (the Next dev server rewrites /api → the portal backend).
import { apiFetch } from './portalApi';

export type Cycle = 'MONTHLY' | 'YEARLY';

export type CatalogPlan = {
  id: string;
  key: string;
  name: string;
  tagline: string | null;
  price_monthly: string | null;
  price_yearly: string | null;
  currency: string;
  billing_cycles: Cycle[];
  trial_days: number;
};

export type Order = {
  id: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'VOID';
  billing_cycle: Cycle;
  amount: string;
  currency: string;
  payment_method: string;
  plan_key: string;
  plan_name: string;
  created_at: string;
};

export type Invoice = {
  id: string;
  number: string;
  amount: string;
  currency: string;
  status: 'DRAFT' | 'ISSUED' | 'PAID' | 'VOID';
  issued_at: string | null;
  paid_at: string | null;
};

export type Subscription = {
  id: string;
  status: string;
  billing_cycle: string;
  plan: { id: string; key: string; name: string; currency: string };
  current_period_start: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  created_at: string;
};

export type Account = { id: string; name: string; email: string; created: boolean };

// L5/L6 — resolved per-plan entitlement + live org-pool usage counters surfaced
// by /api/public/account/overview (additive; old clients ignore it).
export type PlanUsage = {
  key: string;
  name: string;
  enforced: boolean;
  reason: string | null;
  poolOrgId: string | null;
  limits: {
    workspaces: number | null;
    projects: number | null;
    collections: number | null;
    teams: number | null;
    seats: number | null;
    storage_mb: number | null;
    runs_per_month: number | null;
    public_sharing: boolean | null;
  };
  usage: {
    workspaces: number;
    projects: number;
    collections: number;
    teams: number;
    seats: number;
    runs: number;
  };
};

export type CheckoutAccountInput = { name: string; email: string; password: string };

type CheckoutPaid = {
  ok: true;
  requiresPayment: true;
  order: Order;
  invoice: Invoice;
  bonus: { firstRechargeEligible: boolean; days: number };
  account: Account;
};

type CheckoutFree = {
  ok: true;
  requiresPayment: false;
  subscription: Subscription;
  account: Account;
};

export type CheckoutResult = CheckoutPaid | CheckoutFree;

export type ConfirmResult = {
  ok: true;
  order: Order;
  invoice: Invoice | null;
  subscription: Subscription | null;
  bonus: { firstRecharge: boolean; days: number } | null;
  alreadyProcessed?: boolean;
};

export type OrderStatusResult = {
  order: Order;
  invoice: Invoice | null;
  subscription: Subscription | null;
  bonus: { firstRechargeEligible: boolean; days: number } | null;
};

export async function fetchPlans(): Promise<CatalogPlan[]> {
  const data = await apiFetch<{ plans: CatalogPlan[] }>('/api/public/plans');
  return data.plans;
}

export async function checkout(
  planKey: string,
  billingCycle: Cycle,
  account?: CheckoutAccountInput
): Promise<CheckoutResult> {
  return apiFetch<CheckoutResult>('/api/public/checkout', {
    method: 'POST',
    body: { planKey, billingCycle, account },
  });
}

export async function confirmOrder(orderId: string): Promise<ConfirmResult> {
  return apiFetch<ConfirmResult>(`/api/public/checkout/${orderId}/confirm`, { method: 'POST', body: {} });
}

export async function fetchOrder(orderId: string): Promise<OrderStatusResult> {
  return apiFetch<OrderStatusResult>(`/api/public/orders/${orderId}`);
}

// ------------------------------------------------- real Cashfree gateway (A6)
//
// The checkout flow hands the browser to Cashfree's hosted checkout using the
// `payment_session_id` minted by the portal backend. The session endpoint
// settles an already-paid order inline (returning `alreadyProcessed`), so the
// client can treat that as "done".

export type CashfreeSession = {
  ok: true;
  alreadyProcessed?: boolean;
  provider?: 'CASHFREE';
  mode?: 'sandbox' | 'production';
  order_id?: string;
  cf_order_id?: string;
  payment_session_id?: string;
  amount?: string;
  currency?: string;
  order_status?: string;
  order?: Order;
  invoice?: Invoice | null;
  subscription?: Subscription | null;
};

export async function startCashfreeSession(orderId: string): Promise<CashfreeSession> {
  return apiFetch<CashfreeSession>(
    `/api/public/gateway/cashfree/${encodeURIComponent(orderId)}/session`,
    { method: 'POST', body: {} }
  );
}

export type CashfreeStatus = OrderStatusResult & {
  alreadyProcessed?: boolean;
  gateway?: {
    provider: string;
    reference: string | null;
    status?: string | null;
    payment_status?: string | null;
    attempts?: number | null;
    terminal?: boolean;
  };
};

export async function fetchCashfreeStatus(orderId: string): Promise<CashfreeStatus> {
  return apiFetch<CashfreeStatus>(
    `/api/public/gateway/cashfree/${encodeURIComponent(orderId)}/status`
  );
}

// Recover a session for a customer whose account was created at checkout but is
// still unpaid, so they can finish payment without the (gated) login.
export async function resumeCheckout(
  email: string,
  password: string
): Promise<{ ok: true; requiresPayment: true; order: Order; account: Account }> {
  return apiFetch('/api/public/checkout/resume', {
    method: 'POST',
    body: { email, password },
  });
}

export type Me = {
  user: { id: string; name: string; email: string; role: string };
  portalRole: string | null;
};

/** Resolve the current session user, or null when signed out (401). */
export async function fetchMe(): Promise<Me | null> {
  try {
    return await apiFetch<Me>('/api/me');
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 401) {
      return null;
    }
    throw err;
  }
}

export async function signIn(email: string, password: string): Promise<Me> {
  const data = await apiFetch<{ user: Me['user'] }>('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  return { user: data.user, portalRole: null };
}

export async function signOut(): Promise<void> {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST', body: {} });
  } catch {
    /* best effort */
  }
}

// ---------------------------------------------------------------- A5 account

export type AccountInvoice = {
  id: string;
  number: string;
  amount: string;
  currency: string;
  status: 'DRAFT' | 'ISSUED' | 'PAID' | 'VOID';
  order_id: string;
  billing_cycle: Cycle;
  plan_key: string;
  plan_name: string;
  issued_at: string | null;
  paid_at: string | null;
  created_at: string;
};

export type AccountOverview = {
  ok: true;
  account: { id: string; name: string; email: string; role: string };
  current: Subscription | null;
  scheduled?: Subscription | null;
  invoices: AccountInvoice[];
  hasPaidOrders: boolean;
  plan?: PlanUsage | null;
};

export type AccountActionResult = {
  ok: true;
  subscription: Subscription;
};

export async function fetchAccountOverview(): Promise<AccountOverview> {
  return apiFetch<AccountOverview>('/api/public/account/overview');
}

export async function cancelSubscription(subscriptionId: string): Promise<AccountActionResult> {
  return apiFetch<AccountActionResult>('/api/public/account/cancel', {
    method: 'POST',
    body: { subscriptionId },
  });
}

export async function reactivateSubscription(subscriptionId: string): Promise<AccountActionResult> {
  return apiFetch<AccountActionResult>('/api/public/account/reactivate', {
    method: 'POST',
    body: { subscriptionId },
  });
}

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export function formatMoney(value: string | number | null): string | null {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? inr.format(n) : null;
}

export function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}
