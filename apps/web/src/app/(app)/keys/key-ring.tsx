'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Fingerprint, KeyRound, Loader2, Lock, PenLine } from 'lucide-react';
import { verifyMessage } from 'viem';
import { Badge, Card, Label, Mono } from '@/components/primitives';
import { bindMessage } from '@/lib/bind-message';
import {
  OWNER_PATH,
  agentPath,
  createPasskeySeed,
  deriveKey,
  endKeys,
  rememberedCredential,
  unlockPasskeySeed,
  type DerivedKey,
} from '@/lib/passkey-keys';
import { cn, shortHash } from '@/lib/ui';

export interface KeyRingAgent {
  id: string;
  name: string;
  derivationIndex: number;
  walletAddress?: string;
  walletProvider?: string;
}

interface Proof {
  signature: string;
  recovered: boolean;
}

/**
 * One passkey, many keys -- made visible.
 *
 * Unlocking derives the owner key and one key per agent, in the browser, from
 * a single passkey. Each row can prove itself: the key signs a message and the
 * signature is verified against the address right here, so "derived" is a
 * demonstrated fact rather than a label. Binding sends that same kind of
 * proof to the server, which refuses an address whose key did not sign.
 *
 * Keys live in memory only while this screen is unlocked. Locking, or leaving,
 * zeroes them.
 */
export function KeyRing({ agents, ownerAddress }: { agents: KeyRingAgent[]; ownerAddress: string }) {
  const router = useRouter();
  const [keys, setKeys] = useState<{ owner: DerivedKey; agents: Record<string, DerivedKey> } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proofs, setProofs] = useState<Record<string, Proof>>({});
  const [hasCredential, setHasCredential] = useState(false);
  const live = useRef<DerivedKey[]>([]);

  useEffect(() => {
    setHasCredential(Boolean(rememberedCredential()));
    return () => endKeys(live.current); // leaving the page zeroes every key
  }, []);

  async function unlock(mode: 'create' | 'unlock') {
    setError(null);
    setBusy('unlock');
    try {
      const seed = mode === 'create' ? await createPasskeySeed() : await unlockPasskeySeed();
      const owner = deriveKey(seed, OWNER_PATH);
      const derived: Record<string, DerivedKey> = {};
      for (const a of agents) derived[a.id] = deriveKey(seed, agentPath(a.derivationIndex));
      seed.fill(0);
      live.current = [owner, ...Object.values(derived)];
      setKeys({ owner, agents: derived });
      setHasCredential(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unlock the passkey');
    } finally {
      setBusy(null);
    }
  }

  function lock() {
    endKeys(live.current);
    live.current = [];
    setKeys(null);
    setProofs({});
  }

  async function prove(agentId: string) {
    const key = keys?.agents[agentId];
    if (!key) return;
    setBusy(`prove-${agentId}`);
    try {
      const message = `Chancela key check for ${agentId} at ${new Date().toISOString()}`;
      const signature = await key.account.signMessage({ message });
      const recovered = await verifyMessage({ address: key.address, message, signature });
      setProofs((p) => ({ ...p, [agentId]: { signature, recovered } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signing failed');
    } finally {
      setBusy(null);
    }
  }

  async function bind(agentId: string) {
    const key = keys?.agents[agentId];
    if (!key) return;
    setBusy(`bind-${agentId}`);
    setError(null);
    try {
      const signature = await key.account.signMessage({ message: bindMessage(agentId, key.address) });
      const res = await fetch(`/api/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ walletAddress: key.address, signature }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error?.message ?? 'Binding was refused');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Binding failed');
    } finally {
      setBusy(null);
    }
  }

  const ownerMatches = keys ? keys.owner.address.toLowerCase() === ownerAddress.toLowerCase() : false;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Fingerprint className={cn('mt-0.5 h-5 w-5 shrink-0', keys ? 'text-allow' : 'text-faint')} />
          <div>
            <div className="text-[14px] font-medium">
              {keys ? 'Unlocked — keys are in memory' : 'Locked — no key material exists right now'}
            </div>
            <p className="mt-0.5 max-w-xl text-[12.5px] leading-relaxed text-muted">
              {keys
                ? 'Derived in this browser from your passkey. Nothing was sent anywhere, and locking zeroes them.'
                : 'There is no stored seed to steal. The keys below come into existence when the passkey is presented, and not before.'}
            </p>
          </div>
        </div>
        {keys ? (
          <button
            onClick={lock}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-muted hover:text-ink"
          >
            <Lock className="h-3 w-3" /> Lock
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => void unlock(hasCredential ? 'unlock' : 'create')}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg disabled:opacity-50"
            >
              {busy === 'unlock' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Fingerprint className="h-3.5 w-3.5" />}
              {hasCredential ? 'Unlock with passkey' : 'Create a passkey'}
            </button>
            <button
              onClick={() => void unlock(hasCredential ? 'create' : 'unlock')}
              disabled={busy !== null}
              className="text-[12px] text-faint hover:text-muted"
            >
              {hasCredential ? 'New passkey' : 'I have one'}
            </button>
          </div>
        )}
      </Card>

      {error ? (
        <div className="rounded-lg border border-deny/40 bg-deny/[0.06] px-3 py-2 text-[12.5px] text-deny">
          {error}
        </div>
      ) : null}

      <Card className="overflow-hidden p-0">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line bg-surface">
              {['Key', 'Derivation path', 'Address', 'State', ''].map((h, i) => (
                <th key={i} className="label px-4 py-2 text-left">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line/60">
              <td className="px-4 py-2.5">
                <span className="flex items-center gap-2 font-medium">
                  <KeyRound className="h-3.5 w-3.5 text-chain" /> Owner
                </span>
              </td>
              <td className="px-4 py-2.5"><Mono>{OWNER_PATH}</Mono></td>
              <td className="px-4 py-2.5">
                <Mono className="text-ink">{keys ? shortHash(keys.owner.address, 8, 6) : '········'}</Mono>
              </td>
              <td className="px-4 py-2.5">
                {keys ? (
                  ownerMatches ? (
                    <Badge tone="allow">Your sign-in identity</Badge>
                  ) : (
                    <Badge>Not this session&apos;s identity</Badge>
                  )
                ) : (
                  <Mono className="text-faint">locked</Mono>
                )}
              </td>
              <td />
            </tr>

            {agents.map((a) => {
              const key = keys?.agents[a.id];
              const bound = key && a.walletAddress?.toLowerCase() === key.address.toLowerCase();
              const proof = proofs[a.id];
              return (
                <tr key={a.id} className="border-b border-line/60 align-top">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{a.name}</div>
                    <Mono className="text-[11.5px] text-faint">{a.id}</Mono>
                  </td>
                  <td className="px-4 py-2.5"><Mono>{agentPath(a.derivationIndex)}</Mono></td>
                  <td className="px-4 py-2.5">
                    <Mono className="text-ink">{key ? shortHash(key.address, 8, 6) : '········'}</Mono>
                    {proof ? (
                      <div className="mt-1 flex items-center gap-1.5 text-[11.5px]">
                        {proof.recovered ? <Check className="h-3 w-3 text-allow" /> : null}
                        <span className={proof.recovered ? 'text-allow' : 'text-deny'}>
                          {proof.recovered ? 'signature verifies against this address' : 'signature did NOT verify'}
                        </span>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5">
                    {!key ? (
                      <Mono className="text-faint">locked</Mono>
                    ) : bound ? (
                      <Badge tone="chain">Bound as wallet</Badge>
                    ) : a.walletAddress ? (
                      <Badge tone="warn">Wallet is a different key</Badge>
                    ) : (
                      <Badge>Not bound</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {key ? (
                      <span className="inline-flex gap-1.5">
                        <button
                          onClick={() => void prove(a.id)}
                          disabled={busy !== null}
                          className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11.5px] text-muted hover:text-ink disabled:opacity-50"
                        >
                          <PenLine className="h-3 w-3" /> Sign a test
                        </button>
                        {!bound ? (
                          <button
                            onClick={() => void bind(a.id)}
                            disabled={busy !== null}
                            className="rounded-md border border-chain/40 bg-chain/10 px-2 py-1 text-[11.5px] text-chain disabled:opacity-50"
                          >
                            {busy === `bind-${a.id}` ? 'Binding…' : 'Bind as wallet'}
                          </button>
                        ) : null}
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <div>
        <Label>Why the server trusts a binding</Label>
        <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-muted">
          It does not take the address on faith. The derived key signs a message naming both the
          address and the agent, and the server verifies that signature before it stores anything —
          so an owner cannot bind a key they do not hold, and a signature from one binding is useless
          for another.
        </p>
      </div>
    </div>
  );
}
