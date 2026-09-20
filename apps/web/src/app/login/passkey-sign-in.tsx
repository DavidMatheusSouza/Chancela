'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Fingerprint, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OWNER_PATH, createPasskeySeed, deriveKey, endKeys, rememberedCredential, unlockPasskeySeed, passkeyErrorText } from '@/lib/passkey-keys';

/**
 * Sign in -- or sign up -- with a passkey.
 *
 * There is no wallet extension and no seed phrase in this path. The passkey
 * derives the owner key in the browser, that key signs the same challenge a
 * wallet would, and the key is zeroed the moment the signature exists. The
 * server sees a signature and an address; it never sees the passkey or the key.
 */
export function PasskeySignIn({ next }: { next: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'create' | 'unlock' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasCredential, setHasCredential] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setHasCredential(Boolean(rememberedCredential()));
    setSupported(typeof window !== 'undefined' && 'PublicKeyCredential' in window);
  }, []);

  async function signIn(mode: 'create' | 'unlock') {
    setError(null);
    setBusy(mode);
    try {
      const seed = mode === 'create' ? await createPasskeySeed() : await unlockPasskeySeed();
      const owner = deriveKey(seed, OWNER_PATH);
      try {
        const nonceRes = await fetch('/api/auth/nonce', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ address: owner.address }),
        });
        const { nonce, message } = await nonceRes.json();
        if (!nonce) throw new Error('Could not start sign-in');

        const signature = await owner.account.signMessage({ message });

        const res = await fetch('/api/auth/passkey', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ nonce, signature }),
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error?.message ?? 'Passkey sign-in failed');

        // A brand-new owner lands on their keys; a returning one goes where they meant to.
        router.push(payload.onboarded ? '/keys' : next);
        router.refresh();
      } finally {
        endKeys([owner]);
        seed.fill(0);
      }
    } catch (err) {
      setError(passkeyErrorText(err, 'Passkey sign-in failed'));
    } finally {
      setBusy(null);
    }
  }

  if (!supported) return null;

  return (
    <div className="space-y-2">
      <Button
        onClick={() => void signIn(hasCredential ? 'unlock' : 'create')}
        disabled={busy !== null}
        variant="outline"
        className="w-full gap-2"
        size="lg"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
        {hasCredential ? 'Continue with your passkey' : 'Create an account with a passkey'}
      </Button>

      <button
        onClick={() => void signIn(hasCredential ? 'create' : 'unlock')}
        disabled={busy !== null}
        className="w-full text-center text-[12px] text-faint transition-colors hover:text-muted"
      >
        {hasCredential ? 'Create a new passkey instead' : 'I already have a passkey'}
      </button>

      <p className="text-[11.5px] leading-relaxed text-faint">
        One passkey derives your owner key and a separate key for every agent. No seed phrase, no
        extension. Powered by mera.
      </p>

      {error ? (
        <div className="rounded-lg border border-deny/40 bg-deny/[0.06] px-3 py-2 text-[12.5px] text-deny">
          {error}
        </div>
      ) : null}
    </div>
  );
}
