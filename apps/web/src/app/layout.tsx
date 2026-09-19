import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TrustAgent - Identity, Authorization and Accountability for AI Agents',
  description:
    'TrustAgent gives autonomous AI agents identity, permissions, policies and verifiable on-chain accountability. The IAM layer for the autonomous AI era.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-ink antialiased">{children}</body>
    </html>
  );
}
