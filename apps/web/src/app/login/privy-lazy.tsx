'use client';

import dynamic from 'next/dynamic';

/**
 * Load the Privy sign-in only once the page is on screen.
 *
 * `@privy-io/react-auth` carries wallet connectors for a long list of wallets,
 * and importing it statically put roughly 650 kB into the first load of
 * `/login` -- for every visitor, including the majority who sign in with a
 * passkey or walk into the demo and never touch it.
 *
 * `ssr: false` because the provider reaches for `window` as it initialises.
 * The placeholder holds the button's space so the column does not jump when
 * the chunk arrives.
 */
export const PrivySignInLazy = dynamic(
  () => import('./privy-sign-in').then((m) => m.PrivySignIn),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-10 w-full animate-pulse rounded-lg border border-line bg-surface"
        aria-label="Loading the Privy sign-in option"
      />
    ),
  },
);
