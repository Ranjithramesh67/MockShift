import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './account.css';

export const metadata: Metadata = {
  title: 'My subscription — API Hub',
};

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <div className="site ac">
      <header className="ac-nav">
        <div className="ac-nav-inner">
          <a className="ac-brand" href="/">
            <span className="ac-brand-mark" aria-hidden="true">
              AH
            </span>
            <span className="ac-brand-name">API Hub</span>
            <span className="ac-pill">My subscription</span>
          </a>
          <nav className="ac-nav-links" aria-label="Account">
            <a href="/#pricing">Pricing</a>
            <a href="/#faq">FAQ</a>
          </nav>
        </div>
      </header>
      <main className="ac-main">{children}</main>
      <footer className="ac-foot">
        <strong>API Hub</strong> — subscriber self-service (Portal A)
      </footer>
    </div>
  );
}
