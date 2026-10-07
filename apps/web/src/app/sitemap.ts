import type { MetadataRoute } from 'next';

/** The public pages, listed honestly. The rest of the site needs a session. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.PUBLIC_BASE_URL ?? 'https://chancela.xyz';
  return [
    { url: base, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/live`, lastModified: new Date(), changeFrequency: 'hourly', priority: 0.8 },
    { url: `${base}/pitch`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.6 },
    { url: `${base}/privacy`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.3 },
    { url: `${base}/terms`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.3 },
  ];
}
