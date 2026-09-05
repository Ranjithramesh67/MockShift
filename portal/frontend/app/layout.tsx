import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Subscription Hub — plans & pricing',
  description:
    'Public subscription showcase and purchase (Portal A) with an internal management portal (Portal B, RBAC).',
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
