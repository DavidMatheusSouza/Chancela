'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Ethereum {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: Ethereum;
  }
}

export function SignIn({
  next,
  demoOwner,
  devSignIn,
}: {
  next: string;
  demoOwner: string;
  devSignIn: boolean;
}) {
  const [busy, setBusy] = useState<'wallet' | 'dev' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function completeSignIn(nonce: string, signature: string) {
    const response = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonce, signature }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message ?? 'Sign-in failed');
    router.push(next);
    router.refresh();
  }

  async function signInWithWallet() {
    setError(null);
    setBusy('wallet');
    try {
      if (!window.ethereum) throw new Error('No browser wallet found. Install MetaMask or use the demo owner.');

      const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[];
      const address = accounts[0];
      if (!address) throw new Error('No account selected');

      const nonceResponse = await fetch('/api/auth/nonce', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const { nonce, message } = await nonceResponse.json();
      if (!nonce) throw new Error('Could not start sign-in');

      const signature = (await window.ethereum.request({
        method: 'personal_sign',
        params: [message, address],
      })) as string;

      await completeSignIn(nonce, signature);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(null);
    }
  }

  /**
   * Demo sign-in.
   *
   * The seeded owner's key is a published test vector, so the browser can sign
   * the challenge itself. It goes through the exact same verify endpoint and
   * the same signature check as a real wallet — nothing is bypassed, which is
   * why this is safe to ship behind an explicit flag.
   */
  async function signInAsDemoOwner() {
    setError(null);
    setBusy('dev');
    try {
      const response = await fetch('/api/auth/dev', { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Demo sign-in unavailable');
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <Button onClick={signInWithWallet} disabled={busy !== null} className="w-full gap-2" size="lg">
        {busy === 'wallet' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
        Sign in with wallet
      </Button>

      {devSignIn && demoOwner ? (
        <Button
          onClick={signInAsDemoOwner}
          disabled={busy !== null}
          variant="outline"
          className="w-full gap-2"
          size="lg"
        >
          {busy === 'dev' ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Continue as demo owner
        </Button>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-deny/40 bg-deny/[0.06] px-3 py-2 text-[12.5px] text-deny">
          {error}
        </div>
      ) : null}
    </div>
  );
}
