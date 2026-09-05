import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'API Hub — API testing & workflow platform',
  description:
    'Design, test and automate your APIs. A Postman-style workspace with teams, sharing, mock servers, sandboxed formulas and workflow automation.',
  icons: {
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="%237cf29c"/><text x="12" y="16.5" font-size="11" font-weight="bold" text-anchor="middle" fill="%230a0d0a" font-family="Arial">AH</text></svg>',
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0d0a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
