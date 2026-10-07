import Link from 'next/link';

const REPO = 'https://github.com/DavidMatheusSouza/Chancela';

/**
 * The footer the public, sessionless pages share: who runs the site, what it
 * keeps, and where to report a problem, one click from any page a stranger
 * can land on.
 */
export function PublicFooter() {
  return (
    <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-xs text-faint">
      <span>Chancela is open source (MIT), built by David Matheus Souza.</span>
      <nav className="flex flex-wrap items-center gap-4">
        <Link href="/privacy" className="hover:text-ink">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-ink">
          Terms
        </Link>
        <a href={`${REPO}/blob/main/docs/SECURITY.md`} target="_blank" rel="noreferrer" className="hover:text-ink">
          Security
        </a>
        <a href={REPO} target="_blank" rel="noreferrer" className="hover:text-ink">
          GitHub
        </a>
        <a href={`${REPO}/issues`} target="_blank" rel="noreferrer" className="hover:text-ink">
          Contact
        </a>
      </nav>
    </footer>
  );
}
