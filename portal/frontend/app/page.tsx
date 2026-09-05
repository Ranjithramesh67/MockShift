import CatalogPreview from '@/components/CatalogPreview';

export default function Home() {
  return (
    <main className="portal-shell">
      <header className="portal-header">
        <div className="brand">
          <span className="brand-dot">SH</span> Subscription Hub
        </div>
        <div className="tag">Portal A — showcase</div>
      </header>

      <h1>Simple, transparent pricing</h1>
      <p className="lede">
        Pick the plan that fits how your team works. Every paid plan starts with
        a free trial — no card required.
      </p>

      <CatalogPreview />
    </main>
  );
}
