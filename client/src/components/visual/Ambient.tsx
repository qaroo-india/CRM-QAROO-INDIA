/**
 * The app's atmosphere and small navigation helpers:
 *   AmbientBackground -- drifting aurora light, a faint grid and a glow that
 *                        follows the pointer, behind every page;
 *   RouteProgress     -- a thin light bar that sweeps the top on page changes;
 *   BackToTop         -- appears after scrolling down a long page.
 * Everything is decorative (aria-hidden) except the button, and still under
 * "reduce motion".
 */

import { ArrowUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { cn } from '@/lib/cn';
import { scrollToTop } from './effects';

export function AmbientBackground() {
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = layer.current;
    if (!el || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    let x = 0;
    let y = 0;
    const apply = () => {
      frame = 0;
      el.style.setProperty('--px', `${x}px`);
      el.style.setProperty('--py', `${y}px`);
    };
    const onMove = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  return (
    <div ref={layer} aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-grid opacity-50" />
      <div className="aurora-blob -top-[20vmax] -left-[15vmax] [--blob-color:var(--color-primary)]" />
      <div className="aurora-blob -right-[18vmax] top-[10vmax] [--blob-color:var(--color-violet)] [animation-delay:-9s] [animation-duration:34s]" />
      <div className="aurora-blob -bottom-[25vmax] left-[25vmax] [--blob-color:var(--color-accent)] [animation-delay:-17s] [animation-duration:40s]" />
      <div className="absolute inset-0 [background:radial-gradient(520px_circle_at_var(--px,-999px)_var(--py,-999px),color-mix(in_oklch,var(--color-primary)_8%,transparent),transparent_70%)]" />
    </div>
  );
}

export function RouteProgress() {
  const location = useLocation();
  const first = useRef(true);
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setRun((n) => n + 1);
  }, [location.pathname]);
  if (run === 0) return null;
  return <div key={run} aria-hidden className="route-progress" />;
}

export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 640);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="Back to top"
      tabIndex={show ? 0 : -1}
      className={cn(
        'glass fixed right-5 bottom-5 z-30 grid size-11 place-items-center rounded-full border text-primary',
        'transition-[opacity,translate,box-shadow] duration-300 ease-out-expo hover:shadow-glow',
        show ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0',
      )}
    >
      <ArrowUp aria-hidden className="size-5" />
    </button>
  );
}
