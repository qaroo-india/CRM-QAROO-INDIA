import { ArrowLeft, Compass } from 'lucide-react';
import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-4">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-backdrop-glow" />
      <div className="stagger relative max-w-md text-center">
        <p data-text="404" className="glitch font-mono text-7xl font-bold tracking-tight text-fg sm:text-8xl">
          404
        </p>
        <h1 className="text-gradient mt-4 text-2xl font-semibold tracking-tight">This page is off the map</h1>
        <p className="mt-2 text-sm text-fg-muted">The page you are looking for does not exist or has moved.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link
            to="/"
            className="inline-flex h-10 items-center gap-2 rounded-control bg-primary px-4 text-sm font-medium text-primary-fg transition-[filter,box-shadow] hover:shadow-glow hover:brightness-110"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Back home
          </Link>
          <Link
            to="/status"
            className="inline-flex h-10 items-center gap-2 rounded-control border border-border-strong bg-surface-raised px-4 text-sm font-medium text-fg transition-colors hover:border-primary/50"
          >
            <Compass aria-hidden className="size-4" />
            System status
          </Link>
        </div>
      </div>
    </main>
  );
}
