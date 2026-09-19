'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Reveals its children once, when they first scroll into view.
 *
 * Once, deliberately: content that re-animates every time it re-enters the
 * viewport turns reading into a slideshow. The observer disconnects after
 * firing, so scrolling back up costs nothing.
 *
 * Anyone who has asked their system not to animate gets the content
 * immediately, handled in CSS rather than here so there is no flash of hidden
 * text before hydration.
 */
export function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // No observer (older browsers, some test runners) means show it, never hide it.
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.disconnect();
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${shown ? 'is-in' : ''} ${className}`}
      style={{ '--reveal-delay': `${delay}ms` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
