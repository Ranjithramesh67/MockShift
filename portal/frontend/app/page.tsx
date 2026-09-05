import CatalogPreview from '@/components/CatalogPreview';

function BrandMark() {
  return (
    <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true" className="brand-mark">
      <rect x="1.5" y="1.5" width="25" height="25" rx="7" fill="var(--color-accent)" />
      <path
        d="M9 14.5 12.4 18 19 10"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const VALUE_PROPS = [
  {
    title: 'Start free, upgrade later',
    body: 'Free plan forever for a single workspace. Paid plans add a no-card trial so you can evaluate before committing.',
    icon: 'free',
  },
  {
    title: 'Pricing that scales with you',
    body: 'Flat seats per plan with generous limits — move up or down as your team grows, no surprise overage bills.',
    icon: 'scale',
  },
  {
    title: 'Enterprise-ready controls',
    body: 'SSO, SAML, advanced roles and an audit log on the top tiers, with a dedicated CSM for Enterprise customers.',
    icon: 'shield',
  },
];

const FAQS = [
  {
    q: 'How does the free trial work?',
    a: 'Every paid plan includes a 14-day free trial — no card required. When the trial ends you can subscribe or drop back to the Free plan.',
  },
  {
    q: 'Can I switch or cancel at any time?',
    a: 'Yes. You can upgrade, downgrade or cancel your subscription anytime from your account. Changes take effect at the end of the current billing period.',
  },
  {
    q: 'What is your annual billing discount?',
    a: 'Choosing yearly billing saves roughly 17% compared to paying monthly — you can switch between the two at any renewal.',
  },
  {
    q: 'What happens when I reach a plan limit?',
    a: 'You will be notified in advance. Upgrade to the next plan to raise your limits, or trim usage — nothing is ever deleted without your say-so.',
  },
  {
    q: 'Do you offer custom pricing for large teams?',
    a: 'The Enterprise plan is priced to fit your needs — contact sales for volume seats, SAML SSO, an SLA and a dedicated customer success manager.',
  },
];

function IconFor({ kind }: { kind: string }) {
  if (kind === 'free') {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="5" rx="1.5" />
        <rect x="3" y="15" width="18" height="5" rx="1.5" />
      </svg>
    );
  }
  if (kind === 'scale') {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19V10" />
        <path d="M10 19V5" />
        <path d="M16 19v-6" />
        <path d="M21 19H3" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 4.5 6v5c0 4.6 3 8.1 7.5 10 4.5-1.9 7.5-5.4 7.5-10V6L12 3Z" />
      <path d="m9.2 12 2 2 3.6-4" />
    </svg>
  );
}

export default function Home() {
  return (
    <div className="site">
      <header className="site-nav">
        <a className="brand" href="#top">
          <BrandMark />
          <span className="brand-name">Subscription Hub</span>
        </a>
        <nav className="nav-links" aria-label="Page">
          <a href="#pricing">Pricing</a>
          <a href="#features">Features</a>
          <a href="#faq">FAQ</a>
        </nav>
        <a className="tag" href="#pricing">
          Public preview
        </a>
      </header>

      <main id="top">
        <section className="hero">
          <p className="eyebrow">SUBSCRIPTION HUB</p>
          <h1>Simple, transparent pricing for your whole team</h1>
          <p className="hero-lede">
            Pick the plan that fits how you work. Every paid plan starts with a free
            trial — no card required, upgrade or cancel anytime.
          </p>
          <div className="hero-actions">
            <a className="btn btn-primary btn-lg" href="#pricing">
              Compare plans
            </a>
            <a className="btn btn-outline btn-lg" href="#faq">
              Read the FAQ
            </a>
          </div>
        </section>

        <section id="pricing" className="section pricing-section">
          <h2>Plans for every stage</h2>
          <p className="section-lede">
            From a solo workspace to organisation-wide control — choose a billing
            cycle and compare.
          </p>
          <CatalogPreview />
        </section>

        <section id="features" className="section features-section">
          <h2>Everything you need to succeed</h2>
          <div className="value-grid">
            {VALUE_PROPS.map((v) => (
              <div className="value-card" key={v.title}>
                <span className="value-ic">
                  <IconFor kind={v.icon} />
                </span>
                <h3>{v.title}</h3>
                <p>{v.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="faq" className="section faq-section">
          <h2>Frequently asked questions</h2>
          <div className="faq-list">
            {FAQS.map((f) => (
              <details className="faq-item" key={f.q}>
                <summary>
                  <span>{f.q}</span>
                </summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="final-cta">
          <h2>Ready to get started?</h2>
          <p>
            Start free today. When you are ready to grow, pick a paid plan with a
            14-day trial.
          </p>
          <a className="btn btn-primary btn-lg" href="#pricing">
            See plans &amp; pricing
          </a>
        </section>
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <a className="brand brand-sm" href="#top">
            <BrandMark />
            <span className="brand-name">Subscription Hub</span>
          </a>
          <p className="footer-note">
            Public showcase (Portal A) — management portal (Portal B) is internal.
          </p>
        </div>
      </footer>
    </div>
  );
}
