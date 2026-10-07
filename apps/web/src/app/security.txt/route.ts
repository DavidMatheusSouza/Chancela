const REPO = 'https://github.com/DavidMatheusSouza/Chancela';

/**
 * RFC 9116 contact file. Its proper home is `/.well-known/security.txt`, but the
 * proxy in front of this deployment refuses dot-directories, so it is served
 * from the top level, which the RFC allows as the legacy location.
 */
export function GET() {
  const base = process.env.PUBLIC_BASE_URL ?? 'https://chancela.xyz';
  const body = [
    `Contact: ${REPO}/security/advisories/new`,
    'Expires: 2027-10-01T00:00:00.000Z',
    'Preferred-Languages: en, pt',
    `Canonical: ${base}/security.txt`,
    `Policy: ${REPO}/blob/main/docs/SECURITY.md`,
    '',
  ].join('\n');
  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
}
