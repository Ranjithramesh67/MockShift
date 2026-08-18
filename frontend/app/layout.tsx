import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { AppProvider } from '@/store/AppStore';
import { WorkspaceProvider } from '@/store/WorkspaceStore';
import { NavProvider } from '@/store/NavStore';
import { RouteViewSync } from '@/components/RouteViewSync';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  title: 'API Hub — API testing & workflow platform',
  description:
    'Design, test and automate your APIs. A Postman-style workspace with teams, sharing, auth providers and workflow automation.',
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
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        <AuthProvider>
          <AppProvider>
            <WorkspaceProvider>
              <NavProvider initialView="workspace">
                <RouteViewSync />
                {children}
              </NavProvider>
            </WorkspaceProvider>
          </AppProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
