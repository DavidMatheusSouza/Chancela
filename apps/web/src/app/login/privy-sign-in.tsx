'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PrivyProvider, getAccessToken, useLogin, useLogout, usePrivy } from '@privy-io/react-auth';
import { Fingerprint, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Sign in with Privy.
 *
 * Privy authenticates; it does not authorize. The access token it returns is
 * verified server-side in /api/auth/privy, the owner address is read out of the
 * verified token rather than out of the browser, and a Privy user who owns no
 * agent is refused there exactly as a wallet signer would be.
 *
 * On failure the Privy session is torn down. Leaving someone logged in to the
 * identity provider while TrustAgent refused them is the sort of half-state
 * that makes a second attempt silently do nothing.
 */
function PrivyButton({ next }: { next: string }) {
  const router = useRouter();
  const { ready } = usePrivy();
  const { logout } = useLogout();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exchange = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Privy returned no access token');

      const response = await fetch('/api/auth/privy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accessToken }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Privy sign-in failed');

      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Privy sign-in failed');
      await logout().catch(() => {});
    } finally {
      setBusy(false);
    }
  }, [logout, next, router]);

  const { login } = useLogin({
    onComplete: () => void exchange(),
    onError: (code) => setError(`Privy sign-in failed (${code})`),
  });

  return (
    <div className="space-y-3">
      <Button
        onClick={() => login()}
        disabled={!ready || busy}
        variant="outline"
        className="w-full gap-2"
        size="lg"
      >
        {busy || !ready ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Fingerprint className="h-4 w-4" />
        )}
        Sign in with Privy
      </Button>

      {error ? (
        <div className="rounded-lg border border-deny/40 bg-deny/[0.06] px-3 py-2 text-[12.5px] text-deny">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export function PrivySignIn({ appId, next }: { appId: string; next: string }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        // Matches the product's own surface: an owner is an Ethereum address.
        loginMethods: ['wallet', 'email'],
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
        appearance: { theme: 'dark', accentColor: '#7E7AFF', walletChainType: 'ethereum-only' },
      }}
    >
      <PrivyButton next={next} />
    </PrivyProvider>
  );
}
