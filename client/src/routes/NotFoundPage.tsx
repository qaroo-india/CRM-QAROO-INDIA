import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-md text-center">
        <p className="font-mono text-sm text-primary">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">Page not found</h1>
        <p className="mt-2 text-sm text-fg-muted">
          The page you are looking for does not exist or has moved.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex h-10 items-center gap-2 rounded-control border border-border-strong bg-surface-raised px-4 text-sm font-medium text-fg transition-colors hover:border-primary/50"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back to status
        </Link>
      </div>
    </main>
  );
}
