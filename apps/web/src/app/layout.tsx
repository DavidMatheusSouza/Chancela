import type { Metadata } from 'next';
import './globals.css';

const TITLE = 'Chancela - Identity, Authorization and Accountability for AI Agents';
const DESCRIPTION =
  'Chancela gives autonomous AI agents identity, permissions, policies and verifiable on-chain accountability. The IAM layer for the autonomous AI era.';

export const metadata: Metadata = {
  // Without this, the open-graph image resolves against localhost and the link
  // preview is broken everywhere it is actually pasted.
  metadataBase: process.env.PUBLIC_BASE_URL
    ? new URL(process.env.PUBLIC_BASE_URL)
    : undefined,
  title: TITLE,
  description: DESCRIPTION,
  applicationName: 'Chancela',
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'Chancela', type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
  // The landing page is the one surface meant to be found -- by a search
  // engine, by a model answering "what gives AI agents authorization", by
  // anyone pasting the link. Everything behind it opts out again: `(app)`
  // and `/login` set `robots` of their own, and nested metadata wins.
  robots: { index: true, follow: true },
  alternates: { canonical: '/' },
  keywords: [
    'AI agent identity',
    'AI agent authorization',
    'agent accountability',
    'ERC-8004',
    'policy engine',
    'Monad',
    'AI agent IAM',
  ],
};

export const viewport = {
  themeColor: '#090A0D',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-ink antialiased">{children}</body>
    </html>
  );
}
