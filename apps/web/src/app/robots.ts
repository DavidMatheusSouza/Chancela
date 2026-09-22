import type { MetadataRoute } from 'next';

/**
 * What a crawler -- or a model's retrieval fetch -- is invited to read.
 *
 * The landing page explains the product and is meant to be found. Everything
 * else is either behind a session, a one-deployment view of somebody's agents,
 * or an API answering machines that do not read robots.txt anyway.
 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.PUBLIC_BASE_URL ?? 'https://chancela.xyz';
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/dashboard', '/agents', '/policies', '/audit', '/activity', '/approvals', '/keys', '/settings', '/trust', '/integrations', '/login'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
