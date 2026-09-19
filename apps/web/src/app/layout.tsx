import type { Metadata } from 'next';
import './globals.css';

const TITLE = 'TrustAgent - Identity, Authorization and Accountability for AI Agents';
const DESCRIPTION =
  'TrustAgent gives autonomous AI agents identity, permissions, policies and verifiable on-chain accountability. The IAM layer for the autonomous AI era.';

export const metadata: Metadata = {
  // Without this, the open-graph image resolves against localhost and the link
  // preview is broken everywhere it is actually pasted.
  metadataBase: process.env.PUBLIC_BASE_URL
    ? new URL(process.env.PUBLIC_BASE_URL)
    : undefined,
  title: TITLE,
  description: DESCRIPTION,
  applicationName: 'TrustAgent',
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'TrustAgent', type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
  // The dashboard is behind auth and the proofs live on-chain; there is nothing
  // here worth indexing, and an ephemeral demo URL should not outlive itself in
  // a search index.
  robots: { index: false, follow: false },
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
