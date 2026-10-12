import { isRouteErrorResponse, useRouteError } from 'react-router';
import { Button } from '@/components/ui/Button';
import { NotFoundPage } from './NotFoundPage';

/**
 * Router-level error boundary. A rendering bug in one page shows this recovery
 * screen instead of blanking the whole application.
 */
export function RouteErrorPage() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFoundPage />;
  }

  const message = error instanceof Error ? error.message : 'An unexpected error occurred.';

  return (
    <main className="grid min-h-dvh place-items-center px-4" role="alert">
      <div className="max-w-md text-center">
        <p className="font-mono text-sm text-danger">Application error</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">Something went wrong</h1>
        <p className="mt-2 text-sm text-fg-muted">{message}</p>
        <Button className="mt-6" onClick={() => window.location.reload()}>
          Reload the page
        </Button>
      </div>
    </main>
  );
}
