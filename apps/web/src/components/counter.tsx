'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Counts up to a real number when it scrolls into view.
 *
 * The value is measured server-side and passed in; nothing here invents it.
 * The easing decelerates into the figure, and the final frame is set to
 * `value` itself rather than to an interpolation -- landing one off would be a
 * fabricated statistic, which is the one thing this product cannot ship.
 */
export function Counter({
  value,
  durationMs = 900,
  className = '',
}: {
  value: number;
  durationMs?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const frameRef = useRef<number>();
  const [display, setDisplay] = useState(value === 0 ? 0 : null as number | null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // No motion, no observer, or nothing to count: show the true value at once.
    if (reduced || typeof IntersectionObserver === 'undefined' || value === 0) {
      setDisplay(value);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();

        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / durationMs);
          if (t >= 1) {
            setDisplay(value);
            return;
          }
          setDisplay(Math.round(value * (1 - Math.pow(1 - t, 3))));
          frameRef.current = requestAnimationFrame(tick);
        };
        frameRef.current = requestAnimationFrame(tick);
      },
      { threshold: 0.3 },
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    };
  }, [durationMs, value]);

  // Before the observer fires, render the true value so the figure is correct
  // for anyone reading the HTML directly, and never shows a misleading zero.
  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {display ?? value}
    </span>
  );
}
