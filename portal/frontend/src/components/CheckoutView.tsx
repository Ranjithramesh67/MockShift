'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  fetchMe,
  fetchPlans,
  checkout,
  signIn,
  signOut,
  formatMoney,
  type CatalogPlan,
  type Cycle,
  type Subscription,
} from '@/lib/checkoutApi';

const VALID_CYCLES: Cycle[] = ['MONTHLY', 'YEARLY'];

type MeState = 'loading' | 'guest' | 'signedin';
type View =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready' }
  | { kind: 'busy' }
  | { kind: 'free-done'; subscription: Subscription };

export default function CheckoutView() {
  const params = useSearchParams();
  const router = useRouter();

  const planKey = (params.get('plan') || '').toLowerCase();
  const requestedCycle = String(params.get('cycle') || 'MONTHLY').toUpperCase() as Cycle;

  const [plans, setPlans] = useState<CatalogPlan[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [meState, setMeState] = useState<MeState>('loading');
  const [meEmail, setMeEmail] = useState('');
  const [meName, setMeName] = useState('');

  const [mode, setMode] = useState<'create' | 'signin'>('create');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sEmail, setSEmail] = useState('');
  const [sPassword, setSPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  // Load catalog + session identity.
  useEffect(() => {
    let alive = true;
    setView({ kind: 'loading' });
    setLoadError(null);
    setError(null);
    setMeState('loading');
    Promise.all([fetchPlans(), fetchMe()])
      .then(([planRows, me]) => {
        if (!alive) return;
        setPlans(planRows);
        if (me) {
          setMeState('signedin');
          setMeEmail(me.user.email);
          setMeName(me.user.name);
        } else {
          setMeState('guest');
        }
        setView({ kind: 'ready' });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load');
        setView({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to load' });
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const plan = useMemo(() => (plans ? plans.find((p) => p.key === planKey) ?? null : null), [plans, planKey]);
  const cycle: Cycle = VALID_CYCLES.includes(requestedCycle) ? requestedCycle : 'MONTHLY';

  const custom = plan && plan.price_monthly === null && plan.price_yearly === null;
  const isFree = plan && !custom && Number(plan.price_monthly ?? 0) === 0;
  const price = useMemo(() => {
    if (!plan) return null;
    return cycle === 'YEARLY' ? plan.price_yearly : plan.price_monthly;
  }, [plan, cycle]);
  const amount = price === null ? null : Number(price);
  const bonusDays = plan && amount !== null && amount > 0 ? plan.trial_days : 0;

  const doCheckout = useCallback(
    async (account?: { name: string; email: string; password: string }) => {
      if (!plan) return;
      setError(null);
      setView({ kind: 'busy' });
      try {
        const result = await checkout(plan.key, cycle, account);
        if (!result.requiresPayment) {
          setView({ kind: 'free-done', subscription: result.subscription });
        } else {
          router.push(`/checkout/confirm?order=${encodeURIComponent(result.order.id)}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Checkout failed. Please try again.';
        setError(message);
        setView({ kind: 'ready' });
      }
    },
    [plan, cycle, router]
  );

  const submitAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    await doCheckout({ name, email, password });
  };

  const submitSignedInOrder = async (event: React.FormEvent) => {
    event.preventDefault();
    await doCheckout();
  };

  const submitSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setView({ kind: 'busy' });
    try {
      await signIn(sEmail, sPassword);
      setMode('create');
      setPassword('');
      setView({ kind: 'ready' });
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
      setView({ kind: 'ready' });
    }
  };

  const handleSignOut = async () => {
    setError(null);
    try {
      await signOut();
    } finally {
      window.location.reload();
    }
  };

  if (view.kind === 'free-done') {
    return (
      <div className="ck-panel" data-testid="checkout-success">
        <div className="ck-result-icon" aria-hidden="true">
          ✓
        </div>
        <h1 className="ck-title">You&rsquo;re on the {view.subscription.plan.name} plan</h1>
        <p className="ck-lede">
          Your subscription is active — no payment was needed. Your account is ready and you are
          signed in.
        </p>
        <dl className="ck-detail">
          <div>
            <dt>Plan</dt>
            <dd data-testid="checkout-success-plan">{view.subscription.plan.name}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <span className="ck-badge ck-badge-ok">Active</span>
            </dd>
          </div>
          <div>
            <dt>Billing</dt>
            <dd>Free — no card required</dd>
          </div>
        </dl>
        <div className="ck-actions">
          <a className="btn btn-primary" href="/#pricing">
            Back to pricing
          </a>
          <a className="btn btn-ghost" href="/#product">
            Explore features
          </a>
        </div>
      </div>
    );
  }

  if (view.kind === 'error' && !plan) {
    return (
      <div className="ck-panel" role="alert" data-testid="checkout-load-error">
        <h1 className="ck-title">Checkout unavailable</h1>
        <p className="ck-lede">{view.message}</p>
        <div className="ck-actions">
          <a className="btn btn-primary" href="/#pricing">
            Back to pricing
          </a>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // A plan was requested but the catalog has no such PUBLISHED plan, or the
  // selected cycle isn't offered (Enterprise is custom pricing → contact sales).
  if (view.kind === 'ready' && plans && (!plan || !plan.billing_cycles.includes(cycle))) {
    return (
      <div className="ck-panel" role="alert" data-testid="checkout-no-plan">
        <h1 className="ck-title">Checkout unavailable</h1>
        <p className="ck-lede">
          {!plan
            ? `We could not find a plan matching “${planKey}”. It may have been unpublished.`
            : `${plan.name} uses custom pricing — contact our sales team for a quote.`}
        </p>
        <div className="ck-actions">
          <a className="btn btn-primary" href="/#pricing">
            Back to pricing
          </a>
        </div>
      </div>
    );
  }

  const summary = plan ? (
    <aside className="ck-summary" aria-label="Order summary">
      <div className="ck-summary-plan">
        <span className="ck-summary-name" data-testid="checkout-summary-plan">
          {plan.name}
        </span>
        <span className="ck-summary-cycle">
          {cycle === 'YEARLY' ? 'Yearly billing' : 'Monthly billing'}
        </span>
      </div>
      <div className="ck-summary-price-row">
        <span>Due now</span>
        <strong data-testid="checkout-summary-price">
          {custom ? 'Contact sales' : amount === null ? '—' : formatMoney(amount)}
        </strong>
      </div>
      {!custom && !isFree && bonusDays > 0 && (
        <p className="ck-summary-bonus" data-testid="checkout-summary-bonus">
          +{bonusDays} extra days of validity included with your first recharge
        </p>
      )}
      {custom && (
        <p className="ck-summary-bonus">
          Enterprise uses custom pricing — our sales team will reach out after you continue.
        </p>
      )}
    </aside>
  ) : null;

  return (
    <div className="ck-shell" data-testid="checkout-view">
      <div className="ck-head">
        <a className="ck-back" href="/#pricing">
          ← Back to pricing
        </a>
        <h1 className="ck-title">Complete your {plan ? plan.name : 'plan'} sign-up</h1>
        <p className="ck-lede">
          {plan
            ? amount === null || amount === 0
              ? 'A quick account step and you are in.'
              : 'Create your account and confirm the order — payment is simulated for this demo.'
            : ''}
        </p>
      </div>

      <div className="ck-grid">
        {summary}

        <section className="ck-panel" aria-label="Checkout form">
          {meState === 'loading' ? (
            <div className="ck-loading" role="status">
              Checking your session…
            </div>
          ) : meState === 'signedin' ? (
            <div className="ck-form" data-testid="checkout-signedin">
              <div className="ck-notice ck-notice-ok">
                <strong>Signed in as {meName}</strong>
                <span>{meEmail}</span>
              </div>
              <p className="ck-hint">This purchase will be attached to the account above.</p>
              <button type="button" className="ck-link" onClick={handleSignOut} data-testid="checkout-signout">
                Not you? Sign out
              </button>
              <form onSubmit={submitSignedInOrder} className="ck-stack">
                <button type="submit" className="btn btn-primary btn-lg" data-testid="checkout-submit" disabled={view.kind === 'busy'}>
                  {view.kind === 'busy'
                    ? 'Placing order…'
                    : amount === null || amount === 0
                      ? `Start ${plan?.name}`
                      : `Place order — ${amount === null ? '' : formatMoney(amount)}`}
                </button>
                {amount !== null && amount > 0 && (
                  <p className="ck-fine">You&rsquo;ll confirm payment on the next screen.</p>
                )}
              </form>
            </div>
          ) : mode === 'signin' ? (
            <div className="ck-form" data-testid="checkout-signin-form">
              <h2 className="ck-sub">Sign in to your account</h2>
              <p className="ck-hint">
                This email already has an account, or you prefer to sign in first.
              </p>
              <form onSubmit={submitSignIn} className="ck-stack">
                <label className="ck-field">
                  <span>Email</span>
                  <input
                    type="email"
                    autoComplete="email"
                    value={sEmail}
                    onChange={(e) => setSEmail(e.target.value)}
                    required
                    data-testid="checkout-signin-email"
                  />
                </label>
                <label className="ck-field">
                  <span>Password</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={sPassword}
                    onChange={(e) => setSPassword(e.target.value)}
                    required
                    data-testid="checkout-signin-password"
                  />
                </label>
                <button
                  type="submit"
                  className="btn btn-primary btn-lg"
                  disabled={view.kind === 'busy'}
                  data-testid="checkout-signin-submit"
                >
                  {view.kind === 'busy' ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
              <button type="button" className="ck-link" onClick={() => setMode('create')} data-testid="checkout-back-create">
                ← Create a new account instead
              </button>
            </div>
          ) : (
            <div className="ck-form" data-testid="checkout-account-form">
              <h2 className="ck-sub">Your account</h2>
              <p className="ck-hint">
                Used to manage your subscription and sign back in later.
              </p>
              <form onSubmit={submitAccount} className="ck-stack">
                <label className="ck-field">
                  <span>Full name</span>
                  <input
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    data-testid="checkout-name"
                  />
                </label>
                <label className="ck-field">
                  <span>Email</span>
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    data-testid="checkout-email"
                  />
                </label>
                <label className="ck-field">
                  <span>Password</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="At least 8 characters"
                    data-testid="checkout-password"
                  />
                </label>
                {error && (
                  <div className="ck-error" role="alert" data-testid="checkout-error">
                    {error}
                    {/already exists/.test(error) && (
                      <button type="button" className="ck-link" onClick={() => setMode('signin')} data-testid="checkout-signin-toggle">
                        Sign in instead
                      </button>
                    )}
                  </div>
                )}
                <button
                  type="submit"
                  className="btn btn-primary btn-lg"
                  disabled={view.kind === 'busy'}
                  data-testid="checkout-submit"
                >
                  {view.kind === 'busy'
                    ? amount === 0
                      ? 'Setting you up…'
                      : 'Placing order…'
                    : amount === null || amount === 0
                      ? `Start ${plan?.name} — free`
                      : `Place order — ${formatMoney(amount)}`}
                </button>
                {amount !== null && amount > 0 && (
                  <p className="ck-fine">You&rsquo;ll confirm the (simulated) payment on the next screen.</p>
                )}
              </form>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
