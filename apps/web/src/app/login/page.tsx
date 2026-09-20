import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { SignIn } from './sign-in';
import { PrivySignIn } from './privy-sign-in';

export const dynamic = 'force-dynamic';

export default function LoginPage({ searchParams }: { searchParams: { next?: string } }) {
  const demoOwner = process.env.DEMO_OWNER_ADDRESS ?? '';
  const devSignIn = process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_SIGNIN === 'true';
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';

  return (
    <div className="flex min-h-screen flex-col">
      <div className="grid-bg pointer-events-none absolute inset-0 h-80" />

      <header className="relative px-6 py-5">
        <Link href="/" className="inline-flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-chain" />
          <span className="font-semibold tracking-tight">Chancela</span>
        </Link>
      </header>

      <main className="relative flex flex-1 items-center justify-center px-6 pb-20">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-2">
            <h1 className="text-[26px] font-semibold tracking-tight">Sign in</h1>
            <p className="text-[13.5px] leading-relaxed text-muted">
              Prove control of the address that owns your agents. Chancela grants
              administration only for agents whose ERC-8004 identity you hold on-chain.
            </p>
          </div>

          <SignIn next={searchParams.next ?? '/dashboard'} demoOwner={demoOwner} devSignIn={devSignIn} />

          {privyAppId ? (
            <>
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-line" />
                <span className="text-[11px] uppercase tracking-wider text-faint">or</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <PrivySignIn appId={privyAppId} next={searchParams.next ?? '/dashboard'} />
            </>
          ) : null}

          <p className="text-[12px] leading-relaxed text-faint">
            Signing costs no gas and authorises no transaction. It proves key control, nothing more.
          </p>
        </div>
      </main>
    </div>
  );
}
