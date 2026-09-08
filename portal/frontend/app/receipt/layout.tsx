import type { ReactNode } from 'react';
import AccountLink from '@/components/AccountLink';
import '../checkout/checkout.css';
import './receipt.css';

export default function ReceiptLayout({ children }: { children: ReactNode }) {
  return (
    <div className="site ck">
      <header className="ck-nav">
        <div className="ck-nav-inner">
          <a className="ck-brand" href="/#pricing">
            <span className="ck-brand-mark" aria-hidden="true">
              AH
            </span>
            <span className="ck-brand-name">API Hub</span>
            <span className="ck-pill">Receipt</span>
          </a>
          <nav className="ck-nav-links" aria-label="Receipt">
            <a href="/#pricing">Pricing</a>
            <a href="/account">My subscription</a>
            <AccountLink className="ck-nav-signin" />
          </nav>
        </div>
      </header>
      <main className="ck-main">{children}</main>
      <footer className="ck-foot">
        <strong>API Hub</strong> — public showcase (Portal A) · subscription management (Portal B) is internal
      </footer>
    </div>
  );
}
