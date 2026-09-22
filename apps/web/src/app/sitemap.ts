import type { MetadataRoute } from 'next';

/** One public page, listed honestly. The rest of the site needs a session. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.PUBLIC_BASE_URL ?? 'https://chancela.xyz';
  return [{ url: base, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 }];
}
