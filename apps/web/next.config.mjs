/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@chancela/shared', '@chancela/policy-engine', '@chancela/ai'],
  poweredByHeader: false,
  /**
   * Privy's React SDK reaches for Farcaster and Solana adapters that this
   * product has no use for -- an owner here is an Ethereum address. They are
   * optional peers, so webpack fails on the import rather than skipping it.
   * Resolving them to false drops the branch instead of pulling the whole
   * Solana stack into a bundle that would never call it.
   */
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@farcaster/mini-app-solana': false,
    };
    return config;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};
export default nextConfig;
