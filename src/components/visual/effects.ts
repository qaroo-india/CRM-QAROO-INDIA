/**
 * App-wide feel: inertial smooth scrolling (Lenis) and the cursor spotlight /
 * 3D tilt on cards. Both are off under "reduce motion", and the spotlight only
 * runs for a real mouse.
 */

import Lenis from 'lenis';
import { useEffect } from 'react';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** The running smooth-scroll instance, so helpers scroll through it instead of fighting it. */
let lenisInstance: Lenis | null = null;

/** Glide back to the top of the page. */
export function scrollToTop(): void {
  if (lenisInstance) lenisInstance.scrollTo(0, { duration: 1.1 });
  else window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
}

/** Smooth, inertial page scrolling. Scroll areas, dialogs and menus keep native scrolling. */
export function useSmoothScroll(): void {
  useEffect(() => {
    if (reducedMotion()) return;
    const lenis = new Lenis({
      autoRaf: false,
      lerp: 0.12,
      smoothWheel: true,
      allowNestedScroll: true,
      prevent: (node) => Boolean(node.closest('[role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [cmdk-list]')),
    });
    lenisInstance = lenis;
    let frame = 0;
    const loop = (time: number) => {
      // Radix dialogs lock the page; keep Lenis from scrolling behind them.
      if (document.body.hasAttribute('data-scroll-locked')) lenis.stop();
      else lenis.start();
      lenis.raf(time);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
      lenisInstance = null;
    };
  }, []);
}

/**
 * Cards marked data-spotlight get a soft light that follows the cursor
 * (--mx/--my, --spot); data-spotlight="tilt" also leans the card towards it
 * (--rx/--ry). One listener for the whole app, at most one update per frame.
 */
export function useCardSpotlight(): void {
  useEffect(() => {
    if (reducedMotion() || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
    let active: HTMLElement | null = null;
    let pending: PointerEvent | null = null;
    let frame = 0;

    const reset = (el: HTMLElement) => {
      el.style.setProperty('--spot', '0');
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    };
    const apply = () => {
      frame = 0;
      const e = pending;
      if (!e) return;
      const target = (e.target as Element | null)?.closest?.<HTMLElement>('[data-spotlight]') ?? null;
      if (active && active !== target) reset(active);
      active = target;
      if (!target) return;
      const box = target.getBoundingClientRect();
      const x = e.clientX - box.left;
      const y = e.clientY - box.top;
      target.style.setProperty('--mx', `${x}px`);
      target.style.setProperty('--my', `${y}px`);
      target.style.setProperty('--spot', '1');
      if (target.dataset.spotlight === 'tilt') {
        target.style.setProperty('--rx', `${((0.5 - y / box.height) * 5).toFixed(2)}deg`);
        target.style.setProperty('--ry', `${((x / box.width - 0.5) * 5).toFixed(2)}deg`);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      pending = e;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      if (active) reset(active);
      active = null;
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, []);
}
